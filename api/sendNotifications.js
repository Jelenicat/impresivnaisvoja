// api/sendNotifications.js
import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return admin.app();
  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey   = process.env.FIREBASE_PRIVATE_KEY;
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

async function sendOne(db, messaging, notifSnap) {
  const notif = notifSnap.data() || {};
  const tokens = await collectTokensForTargets(db, {
    toRoles: notif.toRoles,
    toEmployeeId: notif.toEmployeeId,
  });

  if (!tokens.length) {
    await notifSnap.ref.set({
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      targetCount: 0,
      info: "No recipients",
    }, { merge: true });
    return { successCount: 0, failureCount: 0, targetCount: 0, invalidTokens: [] };
  }

  // ⬇️ DORADA: prosledi i url i oba identifikatora zaposlenog
  const payload = {
  // notification: { ... }  // <- izbaci
  data: {
    title: notif.title || "Obaveštenje",
    body:  notif.body  || "",
    url:   notif.data?.url || "",
    screen: notif.data?.screen || "/admin",
    appointmentId: String(notif.data?.appointmentIds?.[0] || ""),
    employeeId: String(notif.data?.employeeId || notif.toEmployeeId || ""),
    employeeUsername: String(notif.data?.employeeUsername || ""),
    click_action: "FLUTTER_NOTIFICATION_CLICK",
  },
};


  const batches = chunk(tokens, 500);
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  for (const group of batches) {
    const resp = await messaging.sendEachForMulticast({ tokens: group, ...payload });
    successCount += resp.successCount;
    failureCount += resp.failureCount;

    resp.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r?.error?.errorInfo?.code || r?.error?.code || r?.error?.message || "";
        // ⬇️ DORADA: tolerantniji detektor "not registered"
        if (String(code).includes("registration-token-not-registered")) {
          invalidTokens.push(group[idx]);
        }
      }
    });
  }

  await notifSnap.ref.set({
    sent: true,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    targetCount: tokens.length,
    successCount,
    failCount: failureCount,
  }, { merge: true });

  return { successCount, failureCount, targetCount: tokens.length, invalidTokens };
}

async function cleanupInvalidTokens(db, invalidTokens) {
  const uniq = Array.from(new Set(invalidTokens));
  if (!uniq.length) return 0;
  const batch = db.batch();
  uniq.forEach((tk) => batch.delete(db.collection("fcmTokens").doc(tk))); // docId = token
  await batch.commit();
  return uniq.length;
}

export default async function handler(req, res) {
  try {
    // ⬇️ (opciono) dozvoli preflight ako zoveš sa drugog origin-a
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    initAdmin();
    const db = admin.firestore();
    const messaging = admin.messaging();

    if (req.method === "POST") {
      const { notifId } = req.body || {};
      if (!notifId) return res.status(400).json({ ok: false, error: "Missing notifId" });

      const snap = await db.collection("notifications").doc(String(notifId)).get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: "Notification not found" });

      const r = await sendOne(db, messaging, snap);
      const deleted = await cleanupInvalidTokens(db, r.invalidTokens);
      return res.status(200).json({
        ok: true,
        mode: "single",
        processed: 1,
        totalTargets: r.targetCount,
        successCount: r.successCount,
        failCount: r.failureCount,
        invalidTokensDeleted: deleted,
      });
    }

    // GET = batch slanje
    const lim = Math.max(1, Math.min(Number(req.query.limit || 20), 100));
    const q = await db
      .collection("notifications")
      .where("sent", "==", false)
      .orderBy("createdAt", "asc")
      .limit(lim)
      .get();

    if (q.empty) {
      return res.status(200).json({ ok: true, mode: "batch", processed: 0, message: "Nema novih notifikacija." });
    }

    let processed = 0;
    let totalTargets = 0;
    let allInvalid = [];
    for (const docSnap of q.docs) {
      const r = await sendOne(db, messaging, docSnap);
      processed += 1;
      totalTargets += r.targetCount;
      allInvalid = allInvalid.concat(r.invalidTokens);
    }
    const deleted = await cleanupInvalidTokens(db, allInvalid);

    return res.status(200).json({ ok: true, mode: "batch", processed, totalTargets, invalidTokensDeleted: deleted });
  } catch (e) {
    console.error("sendNotifications error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
