// api/sendReminders2h.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

function initAdmin() {
  if (getApps().length) return;
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) throw new Error("Missing Firebase Admin env vars.");
  privateKey = privateKey.replace(/\\n/g, "\n");
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function ok(res, data)  { res.setHeader("Access-Control-Allow-Origin","*"); return res.status(200).json({ ok:true, ...data }); }
function err(res, e)    { res.setHeader("Access-Control-Allow-Origin","*"); return res.status(500).json({ ok:false, error:String(e?.message||e) }); }

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    initAdmin();
    const db = getFirestore();
    const messaging = getMessaging();

    if ("debug" in (req.query || {})) {
      return ok(res, {
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
      });
    }

    // prozor: sada + 2h do +2h + 5min
    const now = new Date();
    const from = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const to   = new Date(from.getTime() + 5 * 60 * 1000);

    const snap = await db.collection("appointments")
      .where("type", "==", "appointment")
      .where("status", "==", "booked")
      .where("start", ">=", Timestamp.fromDate(from))
      .where("start", "<",  Timestamp.fromDate(to))
      .get();

    const force = String(req.query?.force || "") === "1";
    let sent = 0;
    const inspected = [];

    for (const d of snap.docs) {
      const appt = { id: d.id, ...d.data() };

      if (!appt.clientId) { inspected.push({ id: d.id, reason: "no client" }); continue; }
      if (!force && appt.remind2hSent) { inspected.push({ id: d.id, reason: "already sent" }); continue; }

      const tokensSnap = await db.collection("fcmTokens").where("ownerId","==", appt.clientId).get();
      const tokens = tokensSnap.docs.map(x => x.get("token")).filter(Boolean);
      if (!tokens.length) { inspected.push({ id: d.id, reason: "no tokens" }); continue; }

      const start = (appt.start?.toDate?.() || new Date(appt.start));
      const payload = {
        notification: {
          title: "Podsetnik za termin",
          body: `Uskoro (${start.toLocaleString("sr-RS")}) imate zakazan termin.`,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          appointmentId: String(appt.id),
        },
      };

      const resp = await messaging.sendEachForMulticast({ tokens, ...payload });
      await d.ref.set({ remind2hSent: true, remind2hAt: FieldValue.serverTimestamp() }, { merge: true });

      sent += resp.successCount;
      inspected.push({ id: d.id, tokens: tokens.length, success: resp.successCount, fail: resp.failureCount });
    }

    return ok(res, {
      sent,
      window: { from: from.toISOString(), to: to.toISOString() },
      count: snap.size,
      inspected,
    });
  } catch (e) {
    console.error("sendReminders2h error:", e);
    return err(res, e);
  }
}
