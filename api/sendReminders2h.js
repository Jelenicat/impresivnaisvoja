// api/sendReminders2h.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

/* ---------------- init admin ---------------- */
function initAdmin() {
  if (getApps().length) return;
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) throw new Error("Missing Firebase Admin env vars.");
  privateKey = privateKey.replace(/\\n/g, "\n");
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function ok(res, data) { res.setHeader("Access-Control-Allow-Origin","*"); return res.status(200).json({ ok:true, ...data }); }
function err(res, e)   { res.setHeader("Access-Control-Allow-Origin","*"); return res.status(500).json({ ok:false, error:String(e?.message||e) }); }

const dedup = (arr) => [...new Set(arr.filter(Boolean))];
const TZ = "Europe/Belgrade";

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin","*");
      res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers","Content-Type");
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

    const isPreview = String(req.query?.preview || "") === "1";
    const force     = String(req.query?.force   || "") === "1";

    // ===== prozor: 2h ± padMin =====
    const now    = new Date();
    const center = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const padMin = Number(req.query?.padMin ?? process.env.REM2H_PAD_MIN ?? 15); // default ±15 min
    const from   = new Date(center.getTime() - padMin * 60 * 1000);
    const to     = new Date(center.getTime() + padMin * 60 * 1000);

    // Dohvati termine statusa booked/confirmed u prozoru
    let snap;
    try {
      snap = await db.collection("appointments")
        .where("status", "in", ["booked", "confirmed"])
        .where("start", ">=", Timestamp.fromDate(from))
        .where("start", "<",  Timestamp.fromDate(to))
        .get();
    } catch {
      const [s1, s2] = await Promise.all([
        db.collection("appointments")
          .where("status", "==", "booked")
          .where("start", ">=", Timestamp.fromDate(from))
          .where("start", "<",  Timestamp.fromDate(to))
          .get(),
        db.collection("appointments")
          .where("status", "==", "confirmed")
          .where("start", ">=", Timestamp.fromDate(from))
          .where("start", "<",  Timestamp.fromDate(to))
          .get(),
      ]);
      const map = new Map();
      for (const d of [...s1.docs, ...s2.docs]) map.set(d.id, d);
      snap = { docs: [...map.values()], size: map.size };
    }

    let sent = 0;
    const inspected = [];

    for (const d of snap.docs) {
      const appt = { id: d.id, ...d.data() };

      if (!appt.clientId && !appt.clientPhoneNorm) {
        inspected.push({ id: d.id, reason: "no client identifiers" });
        continue;
      }
      if (!force && appt.remind2hSent) {
        inspected.push({ id: d.id, reason: "already sent" });
        continue;
      }

      // --- tokens: klijent ---
      let clientTokensSnap = await db.collection("fcmTokens")
        .where("ownerId", "==", appt.clientId || "__none__")
        .get();
      if (clientTokensSnap.empty && appt.clientPhoneNorm) {
        clientTokensSnap = await db.collection("fcmTokens")
          .where("ownerPhone", "==", appt.clientPhoneNorm)
          .get();
      }
      const clientTokens = clientTokensSnap.docs.map(x => x.get("token"));

      // ukupno (samo klijent)
      const tokens = dedup([...clientTokens]);

      if (!tokens.length) {
        inspected.push({ id: d.id, reason: "no client tokens" });
        continue;
      }

      const start = (appt.start?.toDate?.() || new Date(appt.start));
      const bodyTime = new Intl.DateTimeFormat("sr-RS", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: TZ,
      }).format(start);

      // iOS/Android collapse id da se ne dupliraju obaveštenja
      const collapseId = `appt-${d.id}-2h`;

      const payload = {
        notification: {
          title: "Podsetnik za termin",
          body: `Uskoro (u ${bodyTime}) imate zakazan termin.`,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          appointmentId: String(d.id),
          employeeId: appt.employeeId ? String(appt.employeeId) : "",
          type: "h120"
        },
        android: {
          collapseKey: collapseId,
          ttl: 3_600_000 // 1h
        },
        apns: {
          headers: { "apns-collapse-id": collapseId }
        }
      };

      if (isPreview) {
        inspected.push({
          id: d.id,
          startISO: start.toISOString(),
          who: { client: clientTokens.length },
          wouldSend: { title: payload.notification.title, body: payload.notification.body, tokens }
        });
        continue; // preview: ne šalji
      }

      // ===== CLAIM & SEND (dupe-protection + FINALNA PROVERA) =====
      const claim = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(d.ref);

        // 1) obrisan? STOP
        if (!freshSnap.exists) return { ok: false, reason: "deleted" };

        const fresh = freshSnap.data();

        // 2) soft delete / status
        if (fresh.deleted === true)        return { ok: false, reason: "soft-deleted" };
        if (!["booked", "confirmed"].includes(fresh.status)) {
          return { ok: false, reason: "status-not-active" };
        }

        // 3) i dalje u prozoru?
        const start2 = fresh.start?.toDate?.() || new Date(fresh.start);
        if (!(start2 >= from && start2 < to)) {
          return { ok: false, reason: "out-of-window" };
        }

        // 4) idempotencija
        if (fresh.remind2hSent && !force) {
          return { ok: false, reason: "already-sent" };
        }

        // 5) claim
        tx.set(d.ref, {
          remind2hSent: true,
          remind2hAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return { ok: true };
      });

      if (!claim.ok) {
        inspected.push({ id: d.id, reason: claim.reason });
        continue;
      }

      // stvarno slanje
      const resp = await messaging.sendEachForMulticast({ tokens, ...payload });
      sent += resp.successCount;

      // čišćenje loših tokena
      const badTokens = [];
      (resp.responses || []).forEach((r, i) => {
        if (!r.success) {
          const code = r.error?.code || "";
          if (code === "messaging/registration-token-not-registered" ||
              code === "messaging/invalid-registration-token") {
            badTokens.push(tokens[i]);
          }
        }
      });
      if (badTokens.length) {
        await Promise.all(badTokens.map(async (t) => {
          const q = await db.collection("fcmTokens").where("token", "==", t).get();
          await Promise.all(q.docs.map(doc => doc.ref.delete()));
        }));
      }

      inspected.push({
        id: d.id,
        tokens: tokens.length,
        success: resp.successCount,
        fail: resp.failureCount,
        messageIds: (resp.responses || []).map(r => r.messageId).filter(Boolean),
        startISO: start.toISOString(),
        who: { client: clientTokens.length }
      });
    }

    return ok(res, {
      sent,
      preview: isPreview,
      window: { from: from.toISOString(), to: to.toISOString(), padMin },
      count: snap.size,
      inspected,
    });
  } catch (e) {
    console.error("sendReminders2h error:", e);
    return err(res, e);
  }
}
