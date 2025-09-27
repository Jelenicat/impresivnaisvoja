// api/sendNotification.js
import admin from "firebase-admin";

/* ------------ init firebase-admin iz ENV varijabli ------------ */
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars.");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");
  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

function chunk(arr, n = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ------------ target lookup: fcmTokens by role / owner ------------ */
async function collectTokensForTargets(db, { toRoles = [], toEmployeeId = null }) {
  const tokenSet = new Set();

  for (const role of Array.isArray(toRoles) ? toRoles : []) {
    const snap = await db.collection("fcmTokens").where("role", "==", role).get();
    snap.forEach((t) => t.get("token") && tokenSet.add(String(t.get("token"))));
  }

  if (toEmployeeId) {
    const snap = await db.collection("fcmTokens").where("ownerId", "==", toEmployeeId).get();
    snap.forEach((t) => t.get("token") && tokenSet.add(String(t.get("token"))));
  }

  return Array.from(tokenSet);
}

/* ------------ slanje jedne notifikacije (data-only) ------------ */
async function sendNow(db, messaging, notifDocRef, notifData) {
  const tokens = await collectTokensForTargets(db, {
    toRoles: notifData.toRoles,
    toEmployeeId: notifData.toEmployeeId,
  });

  // ništa za slanje
  if (!tokens.length) {
    await notifDocRef.set({
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      targetCount: 0,
      info: "No recipients",
    }, { merge: true });
    return { successCount: 0, failureCount: 0, targetCount: 0, invalidTokens: [] };
  }

  // data-only payload (nema notification sekcije — sprečava duple)
  const payload = {
    data: {
      title:  notifData.title || "Obaveštenje",
      body:   notifData.body  || "",
      url:    notifData.data?.url || "",
      screen: notifData.data?.screen || "/admin",
      appointmentId: String(notifData.data?.appointmentIds?.[0] || ""),
      employeeId: String(notifData.data?.employeeId || notifData.toEmployeeId || ""),
      employeeUsername: String(notifData.data?.employeeUsername || ""),
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      // možeš dodati još polja po potrebi…
    },
  };

  const groups = chunk(tokens, 500);
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  for (const g of groups) {
    const resp = await messaging.sendEachForMulticast({ tokens: g, ...payload });
    successCount += resp.successCount;
    failureCount += resp.failureCount;

    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r?.error?.errorInfo?.code || r?.error?.code || r?.error?.message || "";
        if (String(code).includes("registration-token-not-registered")) {
          invalidTokens.push(g[idx]);
        }
      }
    });
  }

  await notifDocRef.set({
    sent: true,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    targetCount: tokens.length,
    successCount,
    failCount: failureCount,
  }, { merge: true });

  // očisti nevažeće tokene (docId = token)
  if (invalidTokens.length) {
    const uniq = Array.from(new Set(invalidTokens));
    const batch = db.batch();
    uniq.forEach((tk) => batch.delete(db.collection("fcmTokens").doc(tk)));
    await batch.commit();
  }

  return { successCount, failureCount, targetCount: tokens.length };
}

/* ----------------------------- API handler ----------------------------- */
export default async function handler(req, res) {
  try {
    // (opciono) CORS za preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    initAdmin();
    const db = admin.firestore();
    const messaging = admin.messaging();

    // Očekujemo oblik:
    // { title, body, toRoles, toEmployeeId, data: { screen, url, appointmentIds, employeeId, employeeUsername, ... }, kind? }
    const body = req.body || {};
    const notif = {
      kind: body?.kind || "generic",
      title: body?.title || "Obaveštenje",
      body: body?.body || "",
      toRoles: Array.isArray(body?.toRoles) ? body.toRoles : ["admin", "salon"],
      toEmployeeId: body?.toEmployeeId || null,
      data: {
        screen: "/admin",
        ...(body?.data || {}),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false,
    };

    // kreiraj dokument u "notifications" (da postoji trag/istorija)
    const ref = await db.collection("notifications").add(notif);

    // odmah pošalji
    const result = await sendNow(db, messaging, ref, notif);

    return res.status(200).json({
      ok: true,
      notifId: ref.id,
      ...result,
    });
  } catch (e) {
    console.error("sendNotification error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
