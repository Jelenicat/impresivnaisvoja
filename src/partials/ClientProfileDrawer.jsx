// src/partials/ClientProfileDrawer.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, query, where, orderBy, setDoc
} from "firebase/firestore";
import { db } from "../firebase";

/* ---------- helpers ---------- */
function toJsDate(x){
  return x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : (x ? new Date(x) : null));
}
function fmtDateTime(d){
  const x = toJsDate(d);
  if (!x || isNaN(x)) return "—";
  return x.toLocaleString("sr-RS", { dateStyle: "medium", timeStyle: "short" });
}
function normPhone(p){ return String(p||"").replace(/\D+/g, ""); }
function prettyPhone(s){
  const d = normPhone(s);
  if (!d) return "—";
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.startsWith("381")) return "+" + d;
  return d;
}
function initials(c){
  const f = (c?.firstName||"").trim();
  const l = (c?.lastName||"").trim();
  return ((f[0]||"") + (l[0]||"")).toUpperCase();
}

/**
 * Props:
 *  - client (object)  { id, firstName, lastName, phone/phoneNumber, email, blocked, createdAt, updatedAt, notes }
 *  - role ("admin" | "salon" | "worker")
 *  - onClose()
 *  - onDelete()          // poziva AdminClients parent
 *  - onToggleBlock()     // poziva AdminClients parent
 *
 * Napomena za termine:
 *  - Pokušavamo da nađemo termine po clientId ILI po clientPhone.
 *  - Kolekcija pretpostavljena: "appointments"
 *  - Polja koja očekujemo (best-effort): startAt, endAt, employeeName, employeeId, serviceName, status, clientId, clientPhone
 */
export default function ClientProfileDrawer({
  client,
  role = "admin",
  onClose,
  onDelete,
  onToggleBlock
}){
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(() => ({
    firstName: client?.firstName || "",
    lastName : client?.lastName  || "",
    phone    : client?.phone ?? client?.phoneNumber ?? "",
    email    : client?.email || "",
    notes    : client?.notes || ""
  }));

  // TERMMINI
  const [appointments, setAppointments] = useState([]);

  // Zaključavanje skrola pozadine dok je otvoren drawer
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Sync forme kad se promeni klijent
  useEffect(() => {
    setForm({
      firstName: client?.firstName || "",
      lastName : client?.lastName  || "",
      phone    : client?.phone ?? client?.phoneNumber ?? "",
      email    : client?.email || "",
      notes    : client?.notes || ""
    });
  }, [client]);

  // Učitaj termine — po clientId i (fallback) po telefonu
  useEffect(() => {
    if (!client) return;
    const subs = [];

    // 1) Po clientId
    if (client.id){
      const q1 = query(
        collection(db, "appointments"),
        where("clientId", "==", client.id),
        orderBy("startAt", "desc")
      );
      subs.push(onSnapshot(q1, snap => {
        setAppointments(prev => mergeAppts(prev, snap.docs));
      }));
    }

    // 2) Po clientPhone (fallback)
    const cp = normPhone(client.phone ?? client.phoneNumber);
    if (cp){
      const q2 = query(
        collection(db, "appointments"),
        where("clientPhone", "==", cp),
        orderBy("startAt", "desc")
      );
      subs.push(onSnapshot(q2, snap => {
        setAppointments(prev => mergeAppts(prev, snap.docs));
      }));
    }

    return () => subs.forEach(u => u && u());
  }, [client]);

  function mergeAppts(prev, docs){
    const incoming = docs.map(d => ({ id: d.id, ...d.data() }));
    const map = new Map(prev.map(a => [a.id, a]));
    for (const a of incoming) map.set(a.id, a);
    // sort desc by startAt
    const arr = Array.from(map.values());
    arr.sort((a,b) => {
      const ta = toJsDate(a.startAt)?.getTime() ?? 0;
      const tb = toJsDate(b.startAt)?.getTime() ?? 0;
      return tb - ta;
    });
    return arr;
  }

  // Grupisanje: budući / prošli
  const now = Date.now();
  const upcoming = useMemo(() => appointments.filter(a => (toJsDate(a.startAt)?.getTime() ?? 0) >= now), [appointments, now]);
  const past     = useMemo(() => appointments.filter(a => (toJsDate(a.startAt)?.getTime() ?? 0) <  now), [appointments, now]);

  const [tab, setTab] = useState("upcoming"); // "upcoming" | "past"
  useEffect(() => { setTab("upcoming"); }, [client?.id]);

  const isBlocked = !!client?.blocked;

  async function handleSave(){
    if (!client?.id) return;
    const dref = doc(db, "clients", client.id);
    await setDoc(dref, {
      firstName: (form.firstName||"").trim(),
      lastName : (form.lastName ||"").trim(),
      phone    : normPhone(form.phone) || null,
      email    : (form.email||"").trim() || null,
      notes    : (form.notes||"").trim(),
      updatedAt: new Date()
    }, { merge: true });
    setEdit(false);
  }

  function handleCancel(){
    setForm({
      firstName: client?.firstName || "",
      lastName : client?.lastName  || "",
      phone    : client?.phone ?? client?.phoneNumber ?? "",
      email    : client?.email || "",
      notes    : client?.notes || ""
    });
    setEdit(false);
  }

  return (
    <>
      {/* BACKDROP */}
      <div className="drawer-backdrop" onClick={onClose} />

      {/* DRAWER */}
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Profil klijenta">
        <style>{`
          /* ===== KREMASTI STIL (bez roze) ===== */
          :root{
            --cream-bg: #fdfaf7;
            --cream-card: #ffffff;
            --cream-soft: #faf6f0;
            --cream-line: #e6e0d7;
            --cream-line-2: #efe9e2;
            --text-1: #2f2f33;
            --text-2: #4b5563;
            --text-3: #6b7280;
            --btn-border: #ddd6cc;
            --danger: #b91c1c;
            --danger-bg: #fff5f5;
            --warn: #92400e;
            --warn-bg: #fffaf0;
            --badge: #374151;
            --shadow: 0 10px 30px rgba(0,0,0,.14);
          }

          .drawer{
            position: fixed;
            inset: 0 0 0 auto;
            width: min(760px, 100%);
            background: var(--cream-bg);
            border-left: 1px solid var(--cream-line);
            box-shadow: -20px 0 40px rgba(0,0,0,.18);
            display: grid;
            grid-template-rows: auto 1fr auto; /* header, content, footer */
            animation: slideIn .25s ease-out;
            z-index: 1000;
          }
          .drawer-backdrop{
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.35);
            backdrop-filter: blur(2px);
            z-index: 999;
          }
          @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

          /* Header (sticky) */
          .drv-header{
            position: sticky; top: 0; z-index: 1;
            display: flex; align-items: center; gap: 12px;
            padding: 12px 14px;
            background: linear-gradient(to bottom, rgba(255,255,255,.9), rgba(253,250,247,.95));
            -webkit-backdrop-filter: saturate(120%) blur(6px);
            backdrop-filter: saturate(120%) blur(6px);
            border-bottom: 1px solid var(--cream-line-2);
          }
          .avatar{
            width: 40px; height: 40px; border-radius: 10px;
            display: inline-flex; align-items:center; justify-content:center;
            font-weight: 800; color: var(--text-1);
            background: linear-gradient(135deg, #fff, #f7efe6);
            border: 1px solid var(--cream-line);
            box-shadow: 0 6px 12px rgba(0,0,0,.05);
            letter-spacing:.5px;
          }
          .title-wrap{ display:flex; flex-direction:column; gap:2px; }
          .title{
            font-size: 18px; font-weight: 900; color: var(--text-1);
            line-height: 1.15;
          }
          .subtitle{
            font-size: 12px; color: var(--text-3);
          }
          .status-badge{
            margin-left: auto;
            padding: 4px 10px; border-radius: 999px; border:1px solid var(--btn-border);
            font-size: 12px; background:#fff; color: var(--badge);
          }
          .status-badge.blocked{ color:#ef4444; border-color:#ef4444; }
          .x-btn{
            margin-left: 10px;
            width: 36px; height: 36px; border-radius: 10px; border:1px solid var(--btn-border);
            background:#fff; cursor:pointer; font-size:16px; line-height:0;
            display:flex; align-items:center; justify-content:center;
          }
          .x-btn:active{ transform: scale(.98); }

          /* Content */
          .drv-content{
            overflow: auto;
            padding: 14px;
          }
          .card{
            border:1px solid var(--cream-line); border-radius: 14px; background: var(--cream-card);
            padding: 12px; margin-bottom: 12px; box-shadow: 0 8px 22px rgba(0,0,0,.04);
          }
          .card h4{
            margin: 0 0 8px; font-size: 13px; letter-spacing:.3px;
            text-transform: uppercase; color: var(--text-3);
          }
          .field{ display:flex; flex-direction:column; gap:6px; }
          .field label{ font-size:13px; color: var(--text-3); }
          .field input, .field textarea{
            width:100%; padding:10px 12px; border-radius:12px;
            border:1px solid var(--btn-border); background:#fff; font-size:14px; color:#1f1f1f;
          }
          .field textarea{ min-height: 90px; resize: vertical; }
          .row{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
          .mono{ font-family: ui-monospace, Menlo, Consolas, monospace; }

          /* Tabs (budući / prošli) */
          .tabs{
            display:flex; gap:8px; align-items:center; flex-wrap:wrap;
            padding: 6px 0 10px;
          }
          .tab-btn{
            height:36px; padding:0 12px; border-radius:12px; border:1px solid var(--btn-border);
            background:#fff; cursor:pointer; font-weight:700; font-size:14px;
            display:inline-flex; align-items:center; gap:8px;
          }
          .tab-btn.active{
            background: var(--cream-soft);
            box-shadow: 0 6px 16px rgba(0,0,0,.04) inset;
          }
          .badge{
            min-width:22px; height:22px; padding:0 6px; border-radius:999px;
            font-size:12px; display:inline-flex; align-items:center; justify-content:center;
            background:#fff; border:1px solid var(--btn-border); color: var(--text-2);
          }

          .appt{
            border:1px solid var(--cream-line); border-radius:12px; background:#fff;
            padding:10px; display:grid; grid-template-columns: 1fr auto; gap:8px; align-items:center;
          }
          .appt + .appt{ margin-top:8px; }
          .appt-title{ font-weight:800; color: var(--text-1); }
          .appt-sub{ font-size:13px; color: var(--text-2); }
          .appt-meta{ font-size:12px; color: var(--text-3); }
          .appt-status{
            padding:3px 8px; border-radius:999px; border:1px solid var(--btn-border); background:#fff; font-size:12px;
            justify-self:end; white-space:nowrap; color: var(--text-2);
          }

          /* Footer (sticky) */
          .drv-footer{
            position: sticky; bottom: 0; z-index: 1;
            display: flex; gap: 8px; align-items:center; justify-content: space-between; flex-wrap: wrap;
            padding: 10px 14px;
            background: linear-gradient(to top, rgba(255,255,255,.92), rgba(253,250,247,.95));
            -webkit-backdrop-filter: saturate(120%) blur(6px);
            backdrop-filter: saturate(120%) blur(6px);
            border-top: 1px solid var(--cream-line-2);
          }
          .btn{
            height: 40px; padding: 0 12px; border-radius: 12px; border:1px solid var(--btn-border);
            background:#fff; cursor:pointer; font-weight:700; font-size:14px;
            display:inline-flex; align-items:center; gap:8px;
          }
          .btn:active{ transform: translateY(1px); }
          .btn-primary{
            background: linear-gradient(135deg, #fff, #f7efe6);
            color: var(--text-1); border: 1px solid var(--btn-border); box-shadow: var(--shadow);
          }
          .btn-danger{ border-color:#fca5a5; color: var(--danger); background: var(--danger-bg); }
          .btn-ghost{ background:#fff; }
          .btn-block{ border-color:#fbbf24; color: var(--warn); background: var(--warn-bg); }
          .btn.wide{ justify-content:center; }

          /* MOBILE */
          @media (max-width: 720px){
            .drawer{ inset: 0; width: 100%; border-left: none; box-shadow: none; }
            .drv-header{ padding-top: calc(env(safe-area-inset-top, 0px) + 40px); }
            .title{ font-size: 17px; }
            .x-btn{ width: 36px; height: 36px; }
            .drv-content{ padding: 12px; }
            .card{ padding: 12px; border-radius: 14px; }
            .row{ grid-template-columns: 1fr; }
            .drv-footer{
              gap: 8px;
              padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
            }
            .btn{ height: 40px; font-size: 14px; }
            .btn.wide{ flex: 1 1 auto; }
          }

          /* DESKTOP */
          @media (min-width: 721px){
            .btn.wide{ min-width: 140px; }
          }
        `}</style>

        {/* HEADER */}
        <div className="drv-header">
          <div className="avatar">{initials(client)}</div>
          <div className="title-wrap">
            <div className="title">{client?.firstName} {client?.lastName}</div>
            <div className="subtitle">
              Kreiran: {fmtDateTime(client?.createdAt)}{client?.updatedAt ? ` • Ažuriran: ${fmtDateTime(client?.updatedAt)}` : ""}
            </div>
          </div>
          <span className={`status-badge ${isBlocked ? "blocked" : ""}`}>
            {isBlocked ? "Blokiran" : "Aktivan"}
          </span>
          <button className="x-btn" aria-label="Zatvori" onClick={onClose}>✕</button>
        </div>

        {/* CONTENT */}
        <div className="drv-content">
          {/* Osnovni podaci */}
          <div className="card">
            <h4>Osnovno</h4>
            {!edit ? (
              <div className="row">
                <div className="field">
                  <label>Ime i prezime</label>
                  <div style={{fontWeight:800, fontSize:16, color:"#2f2f33"}}>
                    {client?.firstName} {client?.lastName}
                  </div>
                </div>
                <div className="field">
                  <label>Status</label>
                  <div>{isBlocked ? "Blokiran" : "Aktivan"}</div>
                </div>
              </div>
            ) : (
              <div className="row">
                <div className="field">
                  <label>Ime</label>
                  <input value={form.firstName} onChange={e=>setForm({...form, firstName:e.target.value})}/>
                </div>
                <div className="field">
                  <label>Prezime</label>
                  <input value={form.lastName} onChange={e=>setForm({...form, lastName:e.target.value})}/>
                </div>
              </div>
            )}
          </div>

          {/* Kontakt */}
          <div className="card">
            <h4>Kontakt</h4>
            {!edit ? (
              <div className="row">
                <div className="field">
                  <label>Telefon</label>
                  <div className="mono">{prettyPhone(client?.phone ?? client?.phoneNumber)}</div>
                </div>
                <div className="field">
                  <label>E-mail</label>
                  <div className="mono">{client?.email || "—"}</div>
                </div>
              </div>
            ) : (
              <div className="row">
                <div className="field">
                  <label>Telefon</label>
                  <input value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} placeholder="+3816..."/>
                </div>
                <div className="field">
                  <label>E-mail</label>
                  <input type="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} placeholder="email@domen.rs"/>
                </div>
              </div>
            )}
          </div>

          {/* Napomena */}
          <div className="card">
            <h4>Napomena</h4>
            {!edit ? (
              <div className="field">
                <div style={{whiteSpace:"pre-wrap"}}>{client?.notes || "—"}</div>
              </div>
            ) : (
              <div className="field">
                <textarea value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} placeholder="Unesi napomenu..."/>
              </div>
            )}
          </div>

          {/* Termini klijenta */}
          <div className="card">
            <h4>Termini</h4>
            <div className="tabs">
              <button
                className={`tab-btn ${tab === "upcoming" ? "active" : ""}`}
                onClick={()=>setTab("upcoming")}
              >
                Budući <span className="badge">{upcoming.length}</span>
              </button>
              <button
                className={`tab-btn ${tab === "past" ? "active" : ""}`}
                onClick={()=>setTab("past")}
              >
                Prošli <span className="badge">{past.length}</span>
              </button>
            </div>

            {(tab === "upcoming" ? upcoming : past).length === 0 ? (
              <div className="appt" style={{justifyContent:"center", gridTemplateColumns:"1fr"}}>
                Nema zapisa.
              </div>
            ) : (
              (tab === "upcoming" ? upcoming : past).map(a => {
                const start = toJsDate(a.startAt);
                const end   = toJsDate(a.endAt);
                return (
                  <div key={a.id} className="appt">
                    <div>
                      <div className="appt-title">{a?.serviceName || "Termin"}</div>
                      <div className="appt-sub">
                        {start ? start.toLocaleString("sr-RS", { dateStyle:"medium", timeStyle:"short" }) : "—"}
                        {end ? ` • do ${end.toLocaleTimeString("sr-RS", { timeStyle:"short" })}` : ""}
                      </div>
                      <div className="appt-meta">
                        {a?.employeeName ? `Izvođač: ${a.employeeName}` : (a?.employeeId ? `Zaposleni: ${a.employeeId}` : "")}
                      </div>
                    </div>
                    <div className="appt-status">{a?.status || "—"}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* FOOTER AKCIJE */}
        <div className="drv-footer">
          {!edit ? (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Zatvori</button>
              <div style={{display:"flex", gap:8, marginLeft:"auto", flexWrap:"wrap"}}>
                <button className="btn btn-block" onClick={onToggleBlock}>
                  {isBlocked ? "Skini blokadu" : "Blokiraj"}
                </button>
                <button className="btn btn-danger" onClick={onDelete}>Obriši</button>
                <button className="btn btn-primary wide" onClick={()=>setEdit(true)}>Uredi</button>
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={handleCancel}>Otkaži</button>
              <div style={{display:"flex", gap:8, marginLeft:"auto", flexWrap:"wrap"}}>
                <button className="btn btn-primary wide" onClick={handleSave}>Sačuvaj</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
