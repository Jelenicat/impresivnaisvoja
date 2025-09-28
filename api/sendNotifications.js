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

  // Vercel/Node multiline key fix
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
async function collectTokensForTargets(
  db,
  { toRoles = [], toEmployeeId = null, toEmployeeUsername = null }
) {
  const tokenSet = new Set();

  // po roli
  for (const role of Array.isArray(toRoles) ? toRoles : []) {
    const snap = await db.collection("fcmTokens").where("role", "==", role).get();
    snap.forEach((t) => t.get("token") && tokenSet.add(String(t.get("token"))));
  }

  // po id/username
  const wantsOwner = toEmployeeId || toEmployeeUsername;
  if (wantsOwner) {
    const val = String(toEmployeeId || toEmployeeUsername);
    const [q1, q2] = await Promise.all([
      db.collection("fcmTokens").where("ownerId", "==", val).get(),
      db.collection("fcmTokens").where("ownerUsername", "==", val).get(),
    ]);
    [q1, q2].forEach((snap) => {
      snap.forEach((t) => t.get("token") && tokenSet.add(String(t.get("token"))));
    });
  }

  return Array.from(tokenSet);
}

/* ------------ slanje jedne notifikacije (data-only) ------------ */
async function sendNow(db, messaging, notifDocRef, notifData) {
  const tokens = await collectTokensForTargets(db, {
    toRoles: notifData.toRoles,
    toEmployeeId: notifData.toEmployeeId,
    toEmployeeUsername: notifData.data?.employeeUsername || null,
  });

  if (!tokens.length) {
    await notifDocRef.set(
      {
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        targetCount: 0,
        info: "No recipients",
      },
      { merge: true }
    );
    console.log("NOTIF DEBUG → nema tokena za slanje", notifData);
    return { successCount: 0, failureCount: 0, targetCount: 0, invalidTokens: [] };
  }

  const stringifiedExtras = Object.fromEntries(
    Object.entries(notifData?.data || {}).map(([k, v]) => [k, String(v ?? "")])
  );

  const payload = {
    data: {
      title: String(notifData.title || "Obaveštenje"),
      body: String(notifData.body || ""),
      url: String(notifData.data?.url || ""),
      screen: String(notifData.data?.screen || "/admin"),
      appointmentId: String(notifData.data?.appointmentIds?.[0] || ""),
      employeeId: String(notifData.data?.employeeId || notifData.toEmployeeId || ""),
      employeeUsername: String(notifData.data?.employeeUsername || ""),
      click_action: "FLUTTER_NOTIFICATION_CLICK",
      ...stringifiedExtras,
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
        const code =
          r?.error?.errorInfo?.code || r?.error?.code || r?.error?.message || "";
        if (String(code).includes("registration-token-not-registered")) {
          invalidTokens.push(g[idx]);
        }
      }
    });
  }

  await notifDocRef.set(
    {
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      targetCount: tokens.length,
      successCount,
      failCount: failureCount,
    },
    { merge: true }
  );

  // očisti nevažeće tokene
  if (invalidTokens.length) {
    const uniq = Array.from(new Set(invalidTokens));
    const batch = db.batch();
    for (const tk of uniq) {
      const qs = await db.collection("fcmTokens").where("token", "==", tk).get();
      qs.forEach((doc) => batch.delete(doc.ref));
    }
    await batch.commit();
  }

  console.log("NOTIF DEBUG → poslato", {
    targetCount: tokens.length,
    successCount,
    failureCount,
    title: notifData.title,
    body: notifData.body,
  });

  return { successCount, failureCount, targetCount: tokens.length };
}

/* ----------------------------- API handler ----------------------------- */
export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    initAdmin();
    const db = admin.firestore();
    const messaging = admin.messaging();

    const body = req.body || {};
    const notif = {
      kind: body?.kind || "generic",
      title: body?.title || "Obaveštenje",
      body: body?.body || "",
      toRoles: Array.isArray(body?.toRoles) ? body.toRoles : ["admin", "salon"],
      toEmployeeId: body?.toEmployeeId || null,
      data: {
        screen: "/admin",
        employeeUsername: body?.toEmployeeUsername || body?.data?.employeeUsername || "",
        ...(body?.data || {}),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false,
    };

    const ref = await db.collection("notifications").add(notif);
    const result = await sendNow(db, messaging, ref, notif);

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      ok: true,
      notifId: ref.id,
      ...result,
    });
  } catch (e) {
    console.error("sendNotification error:", e);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
