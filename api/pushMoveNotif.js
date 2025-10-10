// api/pushMoveNotif.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

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
  const qs = await db.collection("fcmTokens")
    .where("username", "==", username)
    .get();
  const out = new Set();
  qs.forEach(d => {
    const t = d.data()?.token;
    if (t) out.add(t);
  });
  return [...out];
}

async function getTokensForAdmins(db) {
  const out = new Set();

  // role == admin
  const byRole = await db.collection("fcmTokens").where("role", "==", "admin").get();
  byRole.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });

  // username == admin (radi unazad kompatibilnosti)
  const byUname = await db.collection("fcmTokens").where("username", "==", "admin").get();
  byUname.forEach(d => { const t = d.data()?.token; if (t) out.add(t); });

  return [...out];
}

/* --- util: sve vrednosti u string --- */
function stringifyData(obj = {}) {
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    flat[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return flat;
}

/* --- util: formatiranje tela poruke --- */
function buildRichBody(msg) {
  // Ako je body već poslat iz fronta, bogati ga samo ako ima dodatne podatke.
  const info = msg.info || {};
  const line = (s) => (s && String(s).trim()) ? String(s).trim() : null;

  // Ljudsko ime klijenta (ako postoji)
  const clientName = info.clientName && info.clientName.trim() ? `Klijent: ${info.clientName.trim()}` : null;

  // Usluge: niz imena -> "Usluga: A, B"
  let servicesLine = null;
  try {
    const names = Array.isArray(info.serviceNames) ? info.serviceNames : [];
    if (names.length) servicesLine = `Usluga: ${names.join(", ")}`;
  } catch { /* ignore */ }

  // Cena
  const price = info.priceRsd && Number(info.priceRsd) > 0 ? `Cena: ${Number(info.priceRsd)} RSD` : null;

  // Radnica (korisno kad admin dobija obaveštenje)
  const emp = info.employeeName && info.employeeName.trim() ? `Radnica: ${info.employeeName.trim()}` : null;

  // Datum-vreme: koristi već formatiran body ako je stigao (npr. "dd.mm.yyyy. HH:MM–HH:MM"),
  // a ako nije, pokušaj sam da sastaviš iz startIso/endIso
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
    } catch { /* ignore */ }
  }

  const parts = [line(when), line(clientName), line(servicesLine), line(price), line(emp)].filter(Boolean);
  return parts.join("\n");
}

/* --- dedupe prozor (2 sekunde) da sprečimo brze duple isporuke sa istim tag-om --- */
const LAST_TAGS = globalThis.__notif_last_tags__ || new Map();
globalThis.__notif_last_tags__ = LAST_TAGS;

function makeTag(msg) {
  // Grupisanje po razlogu + ID termina + radnica, isto kao i u prethodnoj verziji
  const reason = msg.reason || "GEN";
  const apptId = msg?.info?.apptId || "";
  const empU   = msg.employeeUsername || "";
  return `${reason}:${apptId}:${empU}`;
}

/* --- handler --- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    initAdmin();
    const db  = getFirestore();
    const msg = req.body || {};
    // očekuje: { kind: "toEmployee"|"toAdmin", title, body?, screen, reason, employeeUsername?, info? }
    // referenca na tvoju postojeću implementaciju i očekivani payload sa fronta :contentReference[oaicite:2]{index=2}:contentReference[oaicite:3]{index=3}

    // Odredi mete
    let targetTokens = [];
    if (msg.kind === "toEmployee") {
      targetTokens = await getTokensForEmployee(db, (msg.employeeUsername || "").trim());
    } else if (msg.kind === "toAdmin") {
      targetTokens = await getTokensForAdmins(db);
    } else {
      return res.status(400).json({ ok: false, error: "Invalid 'kind' (expected toEmployee|toAdmin)" });
    }

    if (!targetTokens.length) {
      return res.status(200).json({ ok: true, sent: 0, note: "no tokens (from fcmTokens)" });
    }

    // Napravi tag i sprovedi soft dedupe (2s prozor)
    const tag = makeTag(msg);
    const last = LAST_TAGS.get(tag);
    const now  = Date.now();
    if (last && (now - last) < 2000) {
      // preskoči duplikat istog konteksta u kratkom intervalu
      return res.status(200).json({ ok: true, skipped: "duplicate tag", tag });
    }
    LAST_TAGS.set(tag, now);

    // Naslov i bogato telo poruke
    const title = msg.title || "Obaveštenje";
    const richBody = buildRichBody(msg);

    // DATA sekcija (za app logiku i klik navigaciju)
    const baseData = {
      title,
      body: richBody,
      screen: msg.screen || "/admin",
      reason: msg.reason || "APPT_MOVED",
      ts: String(Date.now()),
    };
    const infoData = stringifyData(msg.info || {});
    const dataPayload = { ...baseData, ...infoData };

    // Slanje – kombinujemo data + webpush.notification:
    // - data: za service worker / onMessage logiku u app-u
    // - webpush.notification: da browser prikaže notifikaciju čak i kad SW ne presretne (i da se spoje po tag-u)
    const r = await getMessaging().sendEachForMulticast({
      tokens: targetTokens,
      data: dataPayload,
      webpush: {
        notification: {
          title,
          body: richBody,
          tag,
          renotify: false, // ako stigne ista poruka sa istim tag-om, ne „blinkuje“ ponovo
        },
        fcmOptions: {
          link: msg.screen || "/admin",
        },
      },
      // Android / iOS opcioni hintovi za grupisanje (ne smetaju webu)
      android: {
        collapseKey: tag,
        priority: "high",
        notification: { tag }
      },
      apns: {
        headers: { "apns-collapse-id": tag }
      }
    });

    // Opcionalno: možeš čistiti nevažeće tokene (410/NotRegistered) – ovde samo prijavljujemo
    const result = {
      ok: true,
      successCount: r.successCount,
      failureCount: r.failureCount,
    };

    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
