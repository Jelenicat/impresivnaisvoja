// api/sendReminders24h.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

/* --- init firebase-admin iz ENV --- */
function initAdmin() {
  if (getApps().length) return;
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars.");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

/* --- helper za CORS i debug --- */
function ok(res, data) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({ ok: true, ...data });
}
function err(res, e) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(500).json({ ok: false, error: String(e?.message || e) });
}

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

    // light health check
    if ("debug" in (req.query || {})) {
      return ok(res, {
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
        hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
        hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
        runtime: "nodejs",
      });
    }

    /* ===================== PROZOR ZA 24h PODSETNIKE =====================
       Umesto uskog intervala (24h do 24h+5min), koristimo centar "now + 24h"
       i simetričan jastuk ±padMin (minuta).
       - ?padMin=60  -> 24h ± 60 min
       - REM24_PAD_MIN ENV var služi kao default (ako nema query param), podrazumevano 30
       ================================================================== */
    const now = new Date();
    const center = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const padMin = Number(
      req.query?.padMin ?? process.env.REM24_PAD_MIN ?? 30
    );
    const from = new Date(center.getTime() - padMin * 60 * 1000);
    const to   = new Date(center.getTime() + padMin * 60 * 1000);

    // Dohvati termine koji upadaju u prozor
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

      if (!appt.clientId) {
        inspected.push({ id: d.id, reason: "no client" });
        continue;
      }
      if (!force && appt.remind24hSent) {
        inspected.push({ id: d.id, reason: "already sent" });
        continue;
      }

      // client
      const clientDoc = await db.collection("clients").doc(appt.clientId).get();
      if (!clientDoc.exists) {
        inspected.push({ id: d.id, reason: "client missing" });
        continue;
      }

      // tokens (svi tokeni za tog klijenta - podrška za više uređaja)
      const tokensSnap = await db.collection("fcmTokens")
        .where("ownerId", "==", appt.clientId)
        .get();
      const tokens = tokensSnap.docs.map(x => x.get("token")).filter(Boolean);

      if (!tokens.length) {
        inspected.push({ id: d.id, reason: "no tokens" });
        continue;
      }

      const start = (appt.start?.toDate?.() || new Date(appt.start));
      const startLocal = new Date(start.getTime()); // samo za log

      const payload = {
        notification: {
          title: "Podsetnik za termin",
          body: `Sutra u ${start.toLocaleTimeString("sr-RS", {
            hour: "2-digit",
            minute: "2-digit"
          })} imate zakazan termin.`,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          appointmentId: String(appt.id),
        },
      };

      const resp = await messaging.sendEachForMulticast({ tokens, ...payload });

      await d.ref.set({
        remind24hSent: true,
        remind24hAt: FieldValue.serverTimestamp()
      }, { merge: true });

      sent += resp.successCount;
      inspected.push({
        id: d.id,
        tokens: tokens.length,
        success: resp.successCount,
        fail: resp.failureCount,
        startISO: start.toISOString(),
        startLocal: startLocal.toString()
      });
    }

    return ok(res, {
      sent,
      window: {
        from: from.toISOString(),
        to: to.toISOString(),
        padMin
      },
      count: snap.size,
      inspected,
    });
  } catch (e) {
    console.error("sendReminders24h error:", e);
    return err(res, e);
  }
}
