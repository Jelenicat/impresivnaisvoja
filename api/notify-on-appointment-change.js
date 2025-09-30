import admin from "firebase-admin";

/* ------------ init firebase-admin iz ENV ------------ */
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

const db = () => admin.firestore();

/* ------------ helpers za tokene ------------ */
async function tokensByRoles(roles = []) {
  if (!roles.length) return [];
  const out = new Set();
  for (const role of roles) {
    const snap = await db().collection("fcmTokens").where("role", "==", role).get();
    snap.forEach(d => { const t = d.get("token"); if (t) out.add(t); });
  }
  return [...out];
}

async function tokensByEmployeeUsername(employeeUsername) {
  if (!employeeUsername) return [];
  const snap = await db().collection("fcmTokens").where("owner", "==", employeeUsername).get();
  const out = new Set();
  snap.forEach(d => { const t = d.get("token"); if (t) out.add(t); });
  return [...out];
}

async function sendMulticast(tokens, notification, data = {}) {
  if (!tokens?.length) return;
  const MAX = 500;
  for (let i = 0; i < tokens.length; i += MAX) {
    const slice = tokens.slice(i, i + MAX);
    await admin.messaging().sendEachForMulticast({
      tokens: slice,
      notification,
      data, // po želji: deep-link parametri
    });
  }
}

function fmt(dt) {
  try {
    const x = dt?.toDate ? dt.toDate() : new Date(dt);
    return x.toLocaleString("sr-RS", { dateStyle: "medium", timeStyle: "short" });
  } catch { return ""; }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    initAdmin();

    const { apptId, actorRole = "", actorUsername = "", prev, next } = req.body || {};
    if (!apptId || !prev || !next) return res.status(400).json({ error: "Missing apptId/prev/next" });

    const movedEmployee = prev.employeeUsername !== next.employeeUsername;
    const movedTime =
      (new Date(prev.start).getTime() !== new Date(next.start).getTime()) ||
      (new Date(prev.end).getTime()   !== new Date(next.end).getTime());
    const isMoved = movedEmployee || movedTime;

    if (!isMoved) return res.json({ ok: true, skipped: "not moved" });

    const role = (actorRole || "").toLowerCase();

    // === Ako admin ili salon pomeri ===
    if (role === "admin" || role === "salon") {
      if (!movedEmployee) {
        // ista radnica -> obavesti tu radnicu
        const empTokens = await tokensByEmployeeUsername(next.employeeUsername);
        await sendMulticast(empTokens, {
          title: "Termin je pomeren",
          body: `Vaš termin je pomeren: ${fmt(prev.start)} → ${fmt(next.start)}.`,
        }, { kind: "emp_moved_time", apptId, employeeUsername: next.employeeUsername });
      } else {
        // druga radnica -> obavesti samo novu radnicu
        const empTokens = await tokensByEmployeeUsername(next.employeeUsername);
        await sendMulticast(empTokens, {
          title: "Novi termin",
          body: `Dodeljen vam je novi termin: ${fmt(next.start)}.`,
        }, { kind: "emp_assigned", apptId, employeeUsername: next.employeeUsername });
      }
      return res.json({ ok: true });
    }

    // === Ako radnica pomeri -> obavesti admin
    // (po želji: dodaj "slavija" u listu ako želiš da i slavija dobija admin notifikacije)
    const adminTokens = await tokensByRoles(["admin", "salon"]);
    await sendMulticast(adminTokens, {
      title: "Termin je pomeren",
      body: `Radnica ${actorUsername || "?"} je pomerila termin na ${fmt(next.start)}.`,
    }, { kind: "admin_changed_by_worker", apptId, employeeUsername: next.employeeUsername });

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
