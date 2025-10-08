// api/pushMoveNotif.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

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

function tokensFromDoc(data) {
  if (!data) return [];
  const one = data.fcmToken ? [data.fcmToken] : [];
  const many = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
  return [...new Set([...one, ...many])].filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok:false, error:"Method not allowed" });
    return;
  }
  try {
    initAdmin();
    const db = getFirestore();
    const msg = await req.body; // kind, title, body, screen, reason, employeeUsername?

    let targetTokens = [];

    if (msg.kind === "toEmployee") {
      const uname = (msg.employeeUsername || "").trim();
      if (uname) {
        const s = await db.collection("employees").doc(uname).get();
        targetTokens = tokensFromDoc(s.data());
      }
    } else if (msg.kind === "toAdmin") {
      // po zahtevu: admin. Ako želiš i salon, dodaš i "salon" doc ovde.
      const a = await db.collection("admins").doc("admin").get();
      targetTokens = tokensFromDoc(a.data());
    }

    if (!targetTokens.length) {
      res.status(200).json({ ok:true, sent:0, note:"no tokens" });
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
      }
    };

    // multicast
    const r = await getMessaging().sendEachForMulticast({
      tokens: targetTokens,
      ...payload
    });

    res.status(200).json({ ok:true, successCount: r.successCount, failureCount: r.failureCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
}
