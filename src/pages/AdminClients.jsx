// src/pages/AdminClients.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, query, orderBy, doc, deleteDoc, setDoc, writeBatch,
  getDocs, limit, startAfter, where
} from "firebase/firestore";
import { db } from "../firebase";
import ClientProfileDrawer from "../partials/ClientProfileDrawer";

/* ---------- helpers ---------- */
function normalizePhone(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/\D/g, "");
}
function prettyPhone(s) {
  const d = normalizePhone(s);
  if (!d) return "—";
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.startsWith("381")) return "+" + d;
  return d;
}
function normKey(k = "") {
  return k
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
function splitCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else { q = !q; }
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim());
}
function detectSeparator(headerLine) {
  if (headerLine.includes("\t")) return "\t";
  const commas = (headerLine.match(/,/g) || []).length;
  const semis  = (headerLine.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const sep = detectSeparator(lines[0]);
  const headerCells = splitCsvLine(lines[0], sep).map(normKey);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line, sep);
    const row = {};
    headerCells.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

// Debounce helper
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- component ---------- */
export default function AdminClients() {
  // UI state
  const [clients, setClients] = useState([]);
  const [qText, setQText] = useState("");
  const debouncedQ = useDebounced(qText, 300);
  const [sort, setSort] = useState("name"); // "name" | "created"
  const [selClient, setSelClient] = useState(null);

  // Paging state (samo kada nema pretrage)
  const PAGE_SIZE = 50;
  const lastDocRef = useRef(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  // Helper: napravi osnovni query za listanje
  function baseListQuery() {
    if (sort === "created") {
      return query(collection(db, "clients"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    }
    // default: ime
    return query(collection(db, "clients"), orderBy("firstName", "asc"), limit(PAGE_SIZE));
  }

  // Helper: napravi sledeću stranicu
  function nextPageQuery() {
    if (!lastDocRef.current) return null;
    if (sort === "created") {
      return query(
        collection(db, "clients"),
        orderBy("createdAt", "desc"),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE)
      );
    }
    return query(
      collection(db, "clients"),
      orderBy("firstName", "asc"),
      startAfter(lastDocRef.current),
      limit(PAGE_SIZE)
    );
  }

  // Učitavanje prve stranice ili promene sort-a / čišćenje pretrage
  async function loadFirstPage() {
    setLoading(true);
    setHasMore(true);
    lastDocRef.current = null;
    setClients([]);

    try {
      const qy = baseListQuery();
      const snap = await getDocs(qy);
      const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClients(arr);
      lastDocRef.current = snap.docs[snap.docs.length - 1] || null;
      setHasMore(snap.docs.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }

  // Učitavanje sledeće stranice
  async function loadMore() {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const qy = nextPageQuery();
      if (!qy) return;
      const snap = await getDocs(qy);
      const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClients(prev => [...prev, ...arr]);
      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;
      if (snap.docs.length < PAGE_SIZE) setHasMore(false);
    } finally {
      setLoading(false);
    }
  }

  // SERVER-SIDE pretraga (prefix) preko više polja – izvršava se kada ima teksta
  async function runSearch(text) {
    setLoading(true);
    setHasMore(false); // za pretragu ne nudimo paginaciju (pojednostavljeno)
    lastDocRef.current = null;

    const t = text.trim().toLowerCase();
    if (!t) { // ako se obriše pretraga, vrati se na listanje
      await loadFirstPage();
      return;
    }

    // Firestore ograničenja: prefix pretraga po jednom polju po upitu.
    // Napravićemo više upita i objediniti rezultate (dedupe po id).
    const results = new Map();

    const tasks = [];

    // Ime
    tasks.push((async () => {
      const q1 = query(
        collection(db, "clients"),
        orderBy("firstName"),
        where("firstName", ">=", t[0].toUpperCase() + t.slice(1)),
        where("firstName", "<=", t[0].toUpperCase() + t.slice(1) + "\uf8ff"),
        limit(PAGE_SIZE)
      );
      try {
        const s1 = await getDocs(q1);
        s1.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      } catch (_) {}
    })());

    // Prezime (ako postoji u šemi)
    tasks.push((async () => {
      const q2 = query(
        collection(db, "clients"),
        orderBy("lastName"),
        where("lastName", ">=", t[0].toUpperCase() + t.slice(1)),
        where("lastName", "<=", t[0].toUpperCase() + t.slice(1) + "\uf8ff"),
        limit(PAGE_SIZE)
      );
      try {
        const s2 = await getDocs(q2);
        s2.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      } catch (_) {}
    })());

    // Telefon – očekujemo normalizovan broj (samo cifre) u bazi
    const tDigits = t.replace(/\D+/g, "");
    if (tDigits.length >= 3) {
      tasks.push((async () => {
        const q3 = query(
          collection(db, "clients"),
          orderBy("phone"),
          where("phone", ">=", tDigits),
          where("phone", "<=", tDigits + "\uf8ff"),
          limit(PAGE_SIZE)
        );
        try {
          const s3 = await getDocs(q3);
          s3.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
        } catch (_) {}
      })());
    }

    // Email
    if (t.length >= 2) {
      tasks.push((async () => {
        const q4 = query(
          collection(db, "clients"),
          orderBy("email"),
          where("email", ">=", t),
          where("email", "<=", t + "\uf8ff"),
          limit(PAGE_SIZE)
        );
        try {
          const s4 = await getDocs(q4);
          s4.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
        } catch (_) {}
      })());
    }

    await Promise.all(tasks);

    // Ako i dalje malo rezultata, kao fallback dovuci 1 stranu pa filtriraj lokalno (robusnost)
    if (results.size === 0) {
      try {
        const snap = await getDocs(baseListQuery());
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtered = arr.filter(c => {
          const name = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
          const phone = String(c.phone ?? c.phoneNumber ?? "");
          const email = (c.email || "").toLowerCase();
          return name.includes(t) || phone.includes(tDigits) || email.includes(t);
        });
        filtered.forEach(c => results.set(c.id, c));
      } catch (_) {}
    }

    // Sortiranje po izboru
    const out = Array.from(results.values());
    if (sort === "created") {
      const ts = v => (v?.seconds ? v.seconds * 1000 : (v ? new Date(v).getTime() : 0));
      out.sort((a,b) => ts(b.createdAt) - ts(a.createdAt));
    } else {
      out.sort((a,b) =>
        (`${a.firstName || ""} ${a.lastName || ""}`)
        .localeCompare(`${b.firstName || ""} ${b.lastName || ""}`)
      );
    }

    setClients(out.slice(0, PAGE_SIZE)); // cap da lista ostane brza
    setLoading(false);
  }

  // Reaguj na sort/promenu i (ne)postojanje pretrage
  useEffect(() => {
    if (debouncedQ) {
      runSearch(debouncedQ);
    } else {
      loadFirstPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, debouncedQ]);

  /* --- akcije --- */
  async function handleDelete(c) {
    if (!c?.id) return;
    if (!window.confirm(`Obrisati klijenta ${c.firstName} ${c.lastName}?`)) return;
    await deleteDoc(doc(db, "clients", c.id));
    setSelClient(null);
    // nakon brisanja, osveži listu
    if (debouncedQ) {
      runSearch(debouncedQ);
    } else {
      loadFirstPage();
    }
  }

  async function handleToggleBlock(c) {
    const dref = doc(db, "clients", c.id);
    await setDoc(dref, { blocked: !c.blocked, updatedAt: new Date() }, { merge: true });
    // nema potrebe za dodatnim osvežavanjem — sledeće učitavanje će povući stanje
  }

  async function handleCsvImport(file) {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) { alert("CSV je prazan ili neprepoznatljiv."); return; }

    const phoneMap = new Map();
    const emailMap = new Map();
    for (const c of clients) {
      const np = normalizePhone(c.phone || "");
      const em = (c.email || "").toLowerCase();
      if (np) phoneMap.set(np, c.id);
      if (em) emailMap.set(em, c.id);
    }

    const nameKeys  = new Set(["ime","first name","firstname","first_name","name","ime i prezime"]);
    const lastKeys  = new Set(["prezime","last name","lastname","last_name"]);
    const phoneKeys = new Set([
      "telefon","broj telefona","br telefona","tel","phone","phone number","phonenumber",
      "mobile","mobile phone","mobilni","mob","gsm","telefon 1","telefon1","kontakt telefon","kontakt"
    ]);
    const mailKeys  = new Set(["email","e-mail","mail"]);
    const noteKeys  = new Set(["napomena","notes","note","beleska","beleška"]);

    const batch = writeBatch(db);
    let imported = 0;

    for (const r of rows) {
      const keys = Object.keys(r);
      const pick = (set) => {
        for (const k of keys) if (set.has(normKey(k))) return r[k];
        return "";
      };

      let firstName = pick(nameKeys);
      let lastName  = pick(lastKeys);
      if (!lastName && firstName && firstName.includes(" ")) {
        const parts = firstName.split(/\s+/);
        firstName = parts.shift() || "";
        lastName = parts.join(" ");
      }

      const phoneRaw = pick(phoneKeys);
      const emailRaw = pick(mailKeys);
      const notesRaw = pick(noteKeys);

      const normPhone = normalizePhone(phoneRaw);
      const email = (emailRaw || "").toLowerCase();

      const existingId =
        (normPhone && phoneMap.get(normPhone)) ||
        (email && emailMap.get(email)) || null;

      let ref;
      if (existingId) {
        ref = doc(db, "clients", existingId);
      } else if (normPhone) {
        ref = doc(db, "clients", normPhone);
      } else if (email) {
        ref = doc(db, "clients", email.replace(/[^a-z0-9_.-]/g, "_"));
      } else {
        ref = doc(collection(db, "clients"));
      }

      batch.set(ref, {
        firstName: (firstName || "").trim(),
        lastName : (lastName  || "").trim(),
        phone    : normPhone || null,
        email    : email || null,
        notes    : notesRaw || "",
        updatedAt: new Date(),
        createdAt: new Date()
      }, { merge: true });

      imported++;
    }

    await batch.commit();
    alert(`Uvezeno klijenata: ${imported}`);
    // nakon importa – refresh
    if (debouncedQ) {
      runSearch(debouncedQ);
    } else {
      loadFirstPage();
    }
  }

  /* --- render --- */
  return (
    <div className="admin-clients">
      <style>{`
        .admin-clients{
          padding: 0 0 90px;
          padding-top: env(safe-area-inset-top, 0px);
          background: #fdfaf7;
        }
        .clients-bar{
          position: sticky; top: 0; z-index: 3;
          display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
          padding: 12px 14px;
          background: linear-gradient(to bottom, rgba(255,255,255,.85), rgba(253,250,247,.9));
          -webkit-backdrop-filter: saturate(120%) blur(6px);
          backdrop-filter: saturate(120%) blur(6px);
          border-bottom: 1px solid #efe9e2;
        }
        .header{
          font-weight: 900; font-size: 20px; letter-spacing:.2px;
          color:#3f3f46; padding: 12px 14px 6px;
        }

        .pill{
          padding: 10px 12px; border-radius: 12px; border: 1px solid #ddd6cc; background:#fff;
          flex: 1 1 280px; font-size: 14px;
        }
        .btn{
          padding: 10px 12px; border-radius: 12px; border:1px solid #ddd6cc; background:#fff; cursor:pointer;
          font-weight:600;
        }
        .btn:hover{ background:#faf6f0; }
        .import-label{ display:inline-flex; align-items:center; gap:8px; }

        .clients-list{
          margin: 12px 14px;
          border:1px solid #e6e0d7; border-radius: 12px; background:#fff; overflow:hidden;
        }
        .clients-header{
          display:grid; grid-template-columns: 1fr 140px 1fr 100px; gap:10px;
          font-weight:700; background:#faf6f0; padding:10px 12px; color:#4b5563;
          border-bottom:1px solid #efe7dd;
        }

        .clients-row{
          display:grid; grid-template-columns: 1fr 140px 1fr 100px; gap:10px;
          padding: 12px 12px; border-top:1px solid #f1ede7; cursor:pointer; align-items:center;
          transition: background .2s ease;
        }
        .clients-row:hover{ background:#faf6f0; }
        .col-name{ font-weight:600; color:#374151; }
        .col-phone, .col-email{ color:#6b7280; font-size:14px; }
        .status-badge{
          justify-self:end;
          padding: 4px 10px; border-radius: 999px; border:1px solid #ddd6cc; font-size: 12px;
          background:#fff; color:#374151;
        }
        .status-badge.blocked{ color:#ef4444; border-color:#ef4444; }

        .loadmore-wrap{
          display:flex; justify-content:center; padding: 14px;
        }

        @media (max-width: 720px){
          .admin-clients{ padding-top: calc(env(safe-area-inset-top, 0px) + 40px); }
          .header{ font-size:18px; padding: 20px 14px 8px; }
          .clients-list{ border:none; background:transparent; margin: 8px 8px 60px; }
          .clients-header{ display:none; }
          .clients-row{
            grid-template-columns: 1fr;
            gap: 6px;
            margin: 10px 0;
            border: 1px solid #eee3d7;
            border-radius: 14px;
            background: #fff;
            box-shadow: 0 6px 16px rgba(0,0,0,.06);
          }
          .clients-row:hover{ background:#fff; }
         .col-name{
  font-size: 16px; font-weight: 800; color:#000;
  display:flex; align-items:center; justify-content:space-between; gap:8px;
}

          .col-phone{ font-size:14px; color:#4b5563; }
          .col-email{ font-size:13px; color:#6b7280; }
          .status-badge{ justify-self: start; font-size:12px; padding: 3px 8px; margin-top: 2px; }
        }
      `}</style>

      <div className="header">Klijenti</div>

      <div className="clients-bar">
        <input
          className="pill"
          placeholder="Pretraga po imenu, telefonu, e-mailu"
          value={qText}
          onChange={e=>setQText(e.target.value)}
        />
        <select className="pill" value={sort} onChange={e=>setSort(e.target.value)} style={{flex:"0 0 190px"}}>
          <option value="name">Sort: Ime</option>
          <option value="created">Sort: Datum kreiranja</option>
        </select>
        <label className="btn import-label">
          Uvezi CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={e=>handleCsvImport(e.target.files?.[0])}/>
        </label>
      </div>

      <div className="clients-list">
        <div className="clients-header">
          <div>Ime i prezime</div><div>Telefon</div><div>E-mail</div><div>Status</div>
        </div>

        {clients.map(c=>(
          <div key={c.id} className="clients-row" onClick={()=>setSelClient(c)}>
            <div className="col-name">
              <span>{c.firstName} {c.lastName}</span>
              <span className={`status-badge ${c.blocked ? "blocked" : ""}`}>
                {c.blocked ? "Blokiran" : "Aktivan"}
              </span>
            </div>
            <div className="col-phone">{prettyPhone(c.phone ?? c.phoneNumber ?? "")}</div>
            <div className="col-email">{c.email || "—"}</div>
          </div>
        ))}

        {/* Load more: samo kada nema pretrage */}
        {!debouncedQ && hasMore && (
          <div className="loadmore-wrap">
            <button className="btn" onClick={loadMore} disabled={loading}>
              {loading ? "Učitavam..." : "Učitaj još"}
            </button>
          </div>
        )}

        {/* Info poruke */}
        {loading && clients.length === 0 && (
          <div className="loadmore-wrap"><span>Učitavanje…</span></div>
        )}
        {!loading && clients.length === 0 && (
          <div className="loadmore-wrap"><span>Nema rezultata.</span></div>
        )}
      </div>

      {!!selClient && (
        <ClientProfileDrawer
          client={selClient}
          onClose={()=>setSelClient(null)}
          onDelete={()=>handleDelete(selClient)}
          onToggleBlock={()=>handleToggleBlock(selClient)}
        />
      )}
    </div>
  );
}
