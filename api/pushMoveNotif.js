// ==========================================
// api/pushMoveNotif.js  (FINAL, no-dupes, deep-link OK)
// ==========================================
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

/* === konfiguracija domena za apsolutne linkove === */
const ORIGIN = process.env.PUBLIC_WEB_ORIGIN || "https://impresivnaisvoja.vercel.app";

/* --- init firebase-admin --- */
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

/* --- helpers: čitanje iz fcmTokens --- */
async function getTokensForEmployee(db, username) {
  if (!username) return [];
  const qs = await db.collection("fcmTokens").where("username", "==", username).get();
  const out = new Set();
  qs.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });
  return [...out];
}

async function getTokensForAdmins(db) {
  const out = new Set();
  const byRole  = await db.collection("fcmTokens").where("role", "==", "admin").get();
  byRole.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });
  const byUname = await db.collection("fcmTokens").where("username", "==", "admin").get();
  byUname.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });
  return [...out];
}

/* --- util: sve vrednosti u string --- */
function stringifyData(obj = {}) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) flat[k] = typeof v === "string" ? v : JSON.stringify(v);
  return flat;
}

/* --- util: formatiranje tela poruke --- */
function buildRichBody(msg) {
  const info = msg.info || {};
  const line = (s) => (s && String(s).trim()) ? String(s).trim() : null;

  const clientName = info.clientName && info.clientName.trim() ? `Klijent: ${info.clientName.trim()}` : null;

  let servicesLine = null;
  try {
    const names = Array.isArray(info.serviceNames) ? info.serviceNames : [];
    if (names.length) servicesLine = `Usluga: ${names.join(", ")}`;
  } catch {}

  const price = info.priceRsd && Number(info.priceRsd) > 0 ? `Cena: ${Number(info.priceRsd)} RSD` : null;
  const emp   = info.employeeName && info.employeeName.trim() ? `Radnica: ${info.employeeName.trim()}` : null;

  let when = msg.body && msg.body.trim() ? msg.body.trim() : null;
  if (!when) {
    try {
      const s = info.startIso ? new Date(info.startIso) : null;
      const e = info.endIso ? new Date(info.endIso) : null;
      if (s && e && !isNaN(s) && !isNaN(e)) {
        const dd = (n) => String(n).padStart(2, "0");
        const fmt = (d) => `${dd(d.getDate())}.${dd(d.getMonth()+1)}.${d.getFullYear()}. ${dd(d.getHours())}:${dd(d.getMinutes())}`;
        when = `${fmt(s)}–${fmt(e)}`;
      }
    } catch {}
  }

  const parts = [line(when), line(clientName), line(servicesLine), line(price), line(emp)].filter(Boolean);
  return parts.join("\n");
}

/* --- dedupe prozor (2 sekunde) da sprečimo brze duple sa istim tag-om --- */
const LAST_TAGS = globalThis.__notif_last_tags__ || new Map();
globalThis.__notif_last_tags__ = LAST_TAGS;

function makeTag(msg) {
  const reason = msg.reason || "GEN";
  const apptId = msg?.info?.apptId || "";
  const empU   = msg.employeeUsername || "";
  return `${reason}:${apptId}:${empU}`;
}

/* --- util: napravi REL i ABS URL koji vode baš na termin --- */
function buildTargetUrl(msg = {}) {
  const defBase = msg.kind === "toEmployee" ? "/worker" : "/admin";
  let base = (msg.screen || defBase).trim();

  const info   = msg.info || {};
  const apptId = info.apptId || "";
  const emp    = info.newEmployeeUsername || info.employeeUsername || msg.employeeUsername || "";

  const isAbs   = /^https?:\/\//i.test(base);
  const absBase = isAbs ? base : new URL(base, ORIGIN).toString();

  const u = new URL(absBase);
  if (apptId) u.searchParams.set("appointmentId", apptId);
  if (emp)    u.searchParams.set("employeeId", emp);

  const absoluteLink = u.toString();
  const relativeLink = u.pathname + (u.search || "") + (u.hash || "");

  return { absoluteLink, relativeLink };
}

/* --- handler --- */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    initAdmin();
    const db  = getFirestore();
    const msg = req.body || {};
    // očekuje: { kind: "toEmployee"|"toAdmin", title, body?, screen, reason, employeeUsername?, info? }

    // Odredi mete
    let targetTokens = [];
    if (msg.kind === "toEmployee") {
      targetTokens = await getTokensForEmployee(db, (msg.employeeUsername || "").trim());
    } else if (msg.kind === "toAdmin") {
      targetTokens = await getTokensForAdmins(db);
    } else {
      return res.status(400).json({ ok: false, error: "Invalid 'kind' (expected toEmployee|toAdmin)" });
    }

    if (!targetTokens.length) return res.status(200).json({ ok: true, sent: 0, note: "no tokens (from fcmTokens)" });

    // Dedupe po tag-u u kratkom intervalu
    const tag = makeTag(msg);
    const last = LAST_TAGS.get(tag);
    const now  = Date.now();
    if (last && (now - last) < 2000) return res.status(200).json({ ok: true, skipped: "duplicate tag", tag });
    LAST_TAGS.set(tag, now);

    // Naslov i bogato telo poruke
    const title    = msg.title || "Obaveštenje";
    const richBody = buildRichBody(msg);

    // URL-ovi koji vode baš na termin
    const { absoluteLink, relativeLink } = buildTargetUrl(msg);

    // DATA payload (za SW/app logiku i navigaciju)
    const info  = msg.info || {};
    const empId = info.newEmployeeUsername || info.employeeUsername || msg.employeeUsername || "";

    const baseData = {
      title,
      body: richBody,
      screen: relativeLink,   // relativni – za internu navigaciju
      url: absoluteLink,      // apsolutni – za fcmOptions.link i direktno otvaranje
      reason: msg.reason || "APPT_MOVED",
      ts: String(Date.now()),
      appointmentId: info.apptId || "",
      employeeId: empId
    };
    const infoData    = stringifyData(info);
    const dataPayload = { ...baseData, ...infoData };

    // Slanje – uz webpush.notification + fcmOptions.link (apsolutni)
    const r = await getMessaging().sendEachForMulticast({
      tokens: targetTokens,
      data: dataPayload,
      webpush: {
        fcmOptions: { link: absoluteLink },
        notification: {
          title,
          body: richBody,
          tag,          // konsoliduje istu notifikaciju
          renotify: false
        }
      },
      android: {
        collapseKey: tag,
        priority: "high",
        notification: { tag }
      },
      apns: { headers: { "apns-collapse-id": tag } }
    });

    // --- Čišćenje loših tokena (sprečava "duple" sa više starih tokena) ---
    const responses = r.responses || [];
    await Promise.all(responses.map(async (resp, i) => {
      if (!resp.success) {
        const code = resp.error?.code || "";
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          const badToken = targetTokens[i];
          const qs = await db.collection('fcmTokens').where('token','==',badToken).get();
          await Promise.all(qs.docs.map(d => d.ref.delete()));
        }
      }
    }));

    return res.status(200).json({ ok: true, successCount: r.successCount, failureCount: r.failureCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}


