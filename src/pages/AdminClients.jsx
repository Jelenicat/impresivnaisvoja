// src/pages/AdminClients.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection, query, orderBy, onSnapshot, doc, deleteDoc,
  setDoc, writeBatch
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

/* ---------- component ---------- */
export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [qText, setQText] = useState("");
  const [sort, setSort] = useState("name"); // "name" | "created"
  const [selClient, setSelClient] = useState(null);

  useEffect(() => {
    const qy = query(collection(db, "clients"), orderBy("firstName", "asc"));
    const unsub = onSnapshot(qy, snap => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub && unsub();
  }, []);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    let arr = !t ? clients : clients.filter(c => {
      const name = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
      const phone = String(c.phone ?? c.phoneNumber ?? "");
      const email = (c.email || "").toLowerCase();
      return name.includes(t) || phone.includes(t) || email.includes(t);
    });

    if (sort === "name") {
      arr = [...arr].sort((a, b) =>
        (`${a.firstName || ""} ${a.lastName || ""}`)
          .localeCompare(`${b.firstName || ""} ${b.lastName || ""}`)
      );
    } else if (sort === "created") {
      // noviji prvi; fallback ako nema createdAt
      const ts = v => (v?.seconds ? v.seconds * 1000 : (v ? new Date(v).getTime() : 0));
      arr = [...arr].sort((a,b) => (ts(b.createdAt) - ts(a.createdAt)));
    }
    return arr;
  }, [clients, qText, sort]);

  async function handleDelete(c) {
    if (!c?.id) return;
    if (!window.confirm(`Obrisati klijenta ${c.firstName} ${c.lastName}?`)) return;
    await deleteDoc(doc(db, "clients", c.id));
    setSelClient(null);
  }

  async function handleToggleBlock(c) {
    const dref = doc(db, "clients", c.id);
    await setDoc(dref, { blocked: !c.blocked, updatedAt: new Date() }, { merge: true });
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
  }

  return (
    <div className="admin-clients">
      <style>{`
        .admin-clients{
          /* dno je ostalo isto zbog donje navigacije */
          padding: 0 0 90px;
          /* blago spuštanje početka + iOS safe area */
          padding-top: env(safe-area-inset-top, 0px);
          background: #fdfaf7;
        }

        /* Sticky top bar */
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
          font-weight:500;
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

        /* Row content */
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

        /* ---------- MOBILE (≤720px): card-style rows + dodatni razmak gore ---------- */
        @media (max-width: 720px){
          /* dodatno spusti početak na telefonu */
          .admin-clients{
            padding-top: calc(env(safe-area-inset-top, 0px) + 40px);
          }

          .header{
            font-size:18px;
            /* više gornjeg prostora za naslov */
            padding: 20px 14px 8px;
          }

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
            font-size: 16px; font-weight: 800; color:#3f3f46;
            display:flex; align-items:center; justify-content:space-between; gap:8px;
          }
          .col-phone{ font-size:14px; color:#4b5563; }
          .col-email{ font-size:13px; color:#6b7280; }
          .status-badge{
            justify-self: start;
            font-size:12px; padding: 3px 8px; margin-top: 2px;
          }
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

        {filtered.map(c=>(
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
