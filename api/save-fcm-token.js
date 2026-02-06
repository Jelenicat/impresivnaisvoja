// api/save-fcm-token.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* --- init firebase-admin --- */
function adminDb() {
  if (getApps().length) return getFirestore();

  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (svcJson) {
    try {
      const creds = JSON.parse(svcJson);
      if (creds.private_key) {
        creds.private_key = creds.private_key.replace(/\\n/g, "\n");
      }
      initializeApp({ credential: cert(creds) });
      return getFirestore();
    } catch (e) {
      console.error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", e);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars.");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });

  return getFirestore();
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { token, role = null, username = null, ownerId = null, reason = null, ts = null } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

    const db = adminDb();
    await db.collection("fcmTokens").doc(String(token)).set(
      {
        token: String(token),
        role,
        username,
        ownerId,
        reason,
        clientTs: typeof ts === "number" ? ts : null,
        userAgent: req.headers["user-agent"] || null,
        lastSeenAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save-fcm-token error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
