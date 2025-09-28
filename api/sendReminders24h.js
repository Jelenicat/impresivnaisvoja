// /api/sendReminders24h.js
export const config = { runtime: "nodejs" };

import admin from "firebase-admin";

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

const adm = initAdmin();
const db = adm.firestore();

const ts = (d) => adm.firestore.Timestamp.fromDate(d);
const toDate = (v) => (typeof v?.toDate === "function" ? v.toDate() : new Date(v));

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok:false, error:"Method not allowed" });

    if (req.query.debug === "1") {
      return res.status(200).json({
        ok:true,
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        runtime:"nodejs",
      });
    }

    const force = req.query.force === "1";
    const now = new Date();
    const from = new Date(now.getTime() + 24*60*60*1000);
    const to   = new Date(from.getTime() + 10*60*1000); // prozor 10 min

    const snap = await db.collection("appointments")
      .where("type", "==", "appointment")
      .where("status", "==", "booked")
      .where("start", ">=", ts(from))
      .where("start", "<", ts(to))
      .get();

    let sent = 0;
    const inspected = [];

    for (const d of snap.docs) {
      const appt = { id: d.id, ...d.data() };

      if (!appt.clientId) {
        inspected.push({ id: appt.id, skipped: true, reason: "no clientId" });
        continue;
      }
      if (!force && appt.remind24hSent) {
        inspected.push({ id: appt.id, skipped: true, reason: "already sent" });
        continue;
      }

      const start = toDate(appt.start);
      if (!start || Number.isNaN(+start)) {
        inspected.push({ id: appt.id, skipped: true, reason: "invalid start" });
        continue;
      }

      const tokensSnap = await db.collection("fcmTokens")
        .where("ownerId", "==", appt.clientId).get();
      const tokens = tokensSnap.docs.map(t => t.get("token")).filter(Boolean);

      if (!tokens.length) {
        inspected.push({ id: appt.id, skipped: true, reason: "no tokens" });
        continue;
      }

      const timeTxt = start.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" });
      const notification = {
        title: "Podsetnik 24h ranije",
        body: `Sutra u ${timeTxt} imate zakazan termin.`,
      };

      const resp = await adm.messaging().sendEachForMulticast({
        tokens,
        notification,
        data: {
          appointmentId: String(appt.id),
          startISO: start.toISOString(),
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      });

      await d.ref.set({
        remind24hSent: true,
        remind24hAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      sent += resp.successCount;
      inspected.push({ id: appt.id, sent: true, tokens: tokens.length, success: resp.successCount, fail: resp.failureCount });
    }

    return res.status(200).json({ ok:true, sent, window:{from:from.toISOString(), to:to.toISOString()}, inspected });
  } catch (e) {
    console.error("sendReminders24h error:", e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
