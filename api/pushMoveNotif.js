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
  // Sve admin uređaje (role == "admin"), plus fallback na username == "admin"
  const out = new Set();

  const byRole = await db.collection("fcmTokens")
    .where("role", "==", "admin")
    .get();
  byRole.forEach(d => {
    const t = d.data()?.token;
    if (t) out.add(t);
  });

  const byUname = await db.collection("fcmTokens")
    .where("username", "==", "admin")
    .get();
  byUname.forEach(d => {
    const t = d.data()?.token;
    if (t) out.add(t);
  });

  return [...out];
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
    const msg = req.body || {}; // { kind, title, body, screen, reason, employeeUsername? }

    let targetTokens = [];

    if (msg.kind === "toEmployee") {
      const uname = (msg.employeeUsername || "").trim();
      targetTokens = await getTokensForEmployee(db, uname);
    } else if (msg.kind === "toAdmin") {
      targetTokens = await getTokensForAdmins(db);
    }

    if (!targetTokens.length) {
      res.status(200).json({ ok: true, sent: 0, note: "no tokens (from fcmTokens)" });
      return;
    }

    const payload = {
      notification: {
        title: msg.title || "Obaveštenje",
        body:  msg.body  || "",
      },
      data: {
        screen: msg.screen || "/admin",
        reason: msg.reason || "APPT_MOVED",
        ts: String(Date.now()),
      },
    };

    const r = await getMessaging().sendEachForMulticast({
      tokens: targetTokens,
      ...payload,
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
