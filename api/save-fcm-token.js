// api/save-fcm-token.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* --- init firebase-admin --- */
function adminDb() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing Firebase Admin env vars.");
    }
    privateKey = privateKey.replace(/\n/g, "
");
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }
  return getFirestore();
}

export default async function handler(req, res) {
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
