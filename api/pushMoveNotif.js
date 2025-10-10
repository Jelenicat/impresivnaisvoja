// api/pushMoveNotif.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

/* --- init firebase-admin --- */
function initAdmin() {
  if (getApps().length) return;
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars.");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

/* --- helpers: čitanje iz fcmTokens --- */
async function getTokensForEmployee(db, username) {
  if (!username) return [];
  const qs = await db.collection("fcmTokens")
    .where("username", "==", username)
    .get();
  const out = new Set();
  qs.forEach(d => {
    const t = d.data()?.token;
    if (t) out.add(t);
  });
  return [...out];
}

async function getTokensForAdmins(db) {
  const out = new Set();
  const byRole = await db.collection("fcmTokens").where("role", "==", "admin").get();
  byRole.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });

  const byUname = await db.collection("fcmTokens").where("username", "==", "admin").get();
  byUname.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });

  return [...out];
}

/* --- util: sve vrednosti u string --- */
function stringifyData(obj = {}) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    flat[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return flat;
}

/* --- handler --- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    initAdmin();
    const db = getFirestore();
    const msg = req.body || {}; 
    // očekuje: { kind: "toEmployee"|"toAdmin", title, body, screen, reason, employeeUsername?, info? }

    let targetTokens = [];
    if (msg.kind === "toEmployee") {
      targetTokens = await getTokensForEmployee(db, (msg.employeeUsername || "").trim());
    } else if (msg.kind === "toAdmin") {
      targetTokens = await getTokensForAdmins(db);
    }

    if (!targetTokens.length) {
      res.status(200).json({ ok: true, sent: 0, note: "no tokens (from fcmTokens)" });
      return;
    }

    // === DATA-ONLY poruka (nema 'notification' da izbegnemo duple) ===
    const baseData = {
      title:  msg.title  || "Obaveštenje",
      body:   msg.body   || "",
      screen: msg.screen || "/admin",
      reason: msg.reason || "APPT_MOVED",
      ts: String(Date.now()),
    };

    // Bogatije info o terminu (sve mora u string)
    // npr. { apptId, startIso, endIso, employeeUsername, employeeName, clientName, serviceNames, priceRsd }
    const infoData = stringifyData(msg.info || {});
    const dataPayload = { ...baseData, ...infoData };

    const r = await getMessaging().sendEachForMulticast({
      tokens: targetTokens,
      data: dataPayload,
      // Dodatni webpush "tag" da se poruke sa istim kontekstom grupišu
      webpush: {
        notification: {
          // tag će spojiti obaveštenja istog termina/radnice/razloga
          tag: `${msg.reason || "GEN"}:${msg.info?.apptId || ""}:${msg.employeeUsername || ""}`,
          renotify: false,
        },
        fcmOptions: {
          link: msg.screen || "/admin",
        },
      },
    });

    res.status(200).json({
      ok: true,
      successCount: r.successCount,
      failureCount: r.failureCount,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
