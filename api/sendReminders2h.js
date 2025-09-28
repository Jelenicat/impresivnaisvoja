// /api/sendReminders2h.js
export const config = { runtime: "nodejs" };

import admin from "firebase-admin";

/* ---- init firebase-admin (isti stil kao tvoj sendNotification.js) ---- */
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

/* ---- helper ---- */
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

    const force = req.query.force === "1";          // ?force=1 za ručni test
    const now = new Date();
    const from = new Date(now.getTime() + 2*60*60*1000);
    const to   = new Date(from.getTime() + 5*60*1000); // prozor 5 min

    // termini koji kreću za ~2h
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
      if (!force && appt.remind2hSent) {
        inspected.push({ id: appt.id, skipped: true, reason: "already sent" });
        continue;
      }

      const start = toDate(appt.start);
      if (!start || Number.isNaN(+start)) {
        inspected.push({ id: appt.id, skipped: true, reason: "invalid start" });
        continue;
      }

      // FCM tokeni za klijenta
      const tokensSnap = await db.collection("fcmTokens")
        .where("ownerId", "==", appt.clientId).get();
      const tokens = tokensSnap.docs.map(t => t.get("token")).filter(Boolean);

      if (!tokens.length) {
        inspected.push({ id: appt.id, skipped: true, reason: "no tokens" });
        continue;
      }

      const notification = {
        title: "Podsetnik za termin",
        body: `Za oko 2 sata (${start.toLocaleString("sr-RS")}) imate zakazan termin.`,
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

      // markiraj
      await d.ref.set({
        remind2hSent: true,
        remind2hAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      sent += resp.successCount;
      inspected.push({ id: appt.id, sent: true, tokens: tokens.length, success: resp.successCount, fail: resp.failureCount });
    }

    return res.status(200).json({ ok:true, sent, window:{from:from.toISOString(), to:to.toISOString()}, inspected });
  } catch (e) {
    console.error("sendReminders2h error:", e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
