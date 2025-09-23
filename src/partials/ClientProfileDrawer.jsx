// src/partials/ClientProfileDrawer.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, onSnapshot, doc, setDoc
} from "firebase/firestore";
import { db } from "../firebase";

/* ---------- helpers ---------- */
function toJsDate(x){ return x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : new Date(x)); }
function fmtDateTime(d){
  const x = toJsDate(d);
  return x.toLocaleString("sr-RS",{ dateStyle:"medium", timeStyle:"short" });
}
function fmtMoney(n){ return Number(n||0).toLocaleString("sr-RS"); }
function normPhone(p){ return String(p||"").replace(/\D+/g, ""); }

export default function ClientProfileDrawer({
  client,
  role = "admin",               // "admin" | "salon" | "worker"
  onClose,
  onDelete,
  onToggleBlock
}){
  const [clientLive, setClientLive] = useState(client);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    firstName: client.firstName || "",
    lastName: client.lastName || "",
    phone: client.phone || "",
    email: client.email || "",
    note: client.note || ""
  });

  const [appts, setAppts] = useState([]);
  const [servicesMap, setServicesMap] = useState(new Map());
  const [categoriesMap, setCategoriesMap] = useState(new Map());

  function maskedName(c){
    const f = c?.firstName || "";
    const l = c?.lastName || "";
    if (role === "admin") return `${f} ${l}`.trim();
    return `${f} ${l ? (l[0].toUpperCase() + ".") : ""}`.trim();
  }
  function maskedPhone(p){
    const raw = (p || "").toString().replace(/\D/g,"");
    if (role === "admin") return p || "—";
    if (!raw) return "—";
    return `***${raw.slice(-3)}`;
  }
  const canSeePaymentBadge = role !== "worker";
  const canSeePriceBadge = role !== "worker";

  /* ---------- live client ---------- */
  useEffect(()=>{
    const ref = doc(db,"clients", client.id);
    const unsub = onSnapshot(ref, snap=>{
      const data = { id: snap.id, ...snap.data() };
      setClientLive(data);
      if(!edit){
        setForm({
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          phone: data.phone || "",
          email: data.email || "",
          note: data.note || ""
        });
      }
    });
    return ()=>unsub && unsub();
  }, [client.id, edit]);

  /* ---------- mape ---------- */
  useEffect(()=>{
    const unsubS = onSnapshot(collection(db,"services"), snap=>{
      const m = new Map();
      snap.docs.forEach(d=> m.set(d.id, {id:d.id, ...d.data()}));
      setServicesMap(m);
    });
    const unsubC = onSnapshot(collection(db,"categories"), snap=>{
      const m = new Map();
      snap.docs.forEach(d=> m.set(d.id, {id:d.id, ...d.data()}));
      setCategoriesMap(m);
    });
    return ()=>{ unsubS && unsubS(); unsubC && unsubC(); };
  }, []);

  /* ---------- termini ---------- */
  useEffect(()=>{
    const seen = new Map();
    const push = (snap) => {
      snap.forEach(d => {
        const row = { id: d.id, ...d.data() };
        seen.set(d.id, row);
      });
      const all = Array.from(seen.values()).sort((a,b)=> toJsDate(b.start) - toJsDate(a.start));
      setAppts(all);
    };

    const unsubs = [];
    if (client?.id) {
      const q1 = query(collection(db,"appointments"), where("clientId","==", client.id));
      unsubs.push(onSnapshot(q1, push));
    }
    const phoneN = normPhone(client?.phone);
    if (phoneN) {
      const q2 = query(collection(db,"appointments"), where("clientPhoneNorm","==", phoneN));
      unsubs.push(onSnapshot(q2, push));
    }

    return ()=> unsubs.forEach(u=>u && u());
  }, [client?.id, client?.phone]);

  const now = new Date();
  const future = useMemo(()=> appts
    .filter(a=>toJsDate(a.start) > now)
    .sort((a,b)=>toJsDate(a.start)-toJsDate(b.start)), [appts]);

  const past   = useMemo(()=> appts
    .filter(a=>toJsDate(a.start) <= now)
    .sort((a,b)=>toJsDate(b.start)-toJsDate(a.start)), [appts]);

  const totalEarned = useMemo(()=> appts.reduce((s,a)=> {
    const n = Number(a.priceRsd ?? a.totalAmountRsd ?? 0);
    return s + (isFinite(n) ? n : 0);
  }, 0), [appts]);

  const nextAppt = future[0] || null;
  const noShowCount = useMemo(()=> appts.filter(a=>a.noShow).length, [appts]);

  async function save(){
    const ref = doc(db,"clients", client.id);
    await setDoc(ref, {
      firstName: (form.firstName||"").trim(),
      lastName: (form.lastName||"").trim(),
      phone: (form.phone||"").trim(),
      email: (form.email||"").trim(),
      note: (form.note||""),
      updatedAt: new Date()
    }, { merge:true });
    setEdit(false);
  }

  function serviceNames(ids=[]){
    return (ids||[]).map(id => servicesMap.get(id)?.name || "—").filter(Boolean).join(", ");
  }
  function cardColor(ids=[]){
    const first = servicesMap.get((ids||[])[0]);
    const col = first ? categoriesMap.get(first.categoryId)?.color : null;
    return col || "#e9e5de";
  }

  function AppointmentCard({ a }){
    const col = cardColor(a.services);
    const priceVal = Number(a.priceRsd ?? a.totalAmountRsd ?? 0);
    const price = priceVal ? `${fmtMoney(priceVal)} RSD` : "—";
    const paid  = a.paid ? (a.paid==="cash" ? "💵 keš" : (a.paid==="card" ? "💳 kartica" : a.paid)) : "nije naplaćeno";
    const src   = a.source === "manual" ? "Admin" : (a.source || (a.isOnline ? "Online" : "—"));
    const emp   = a.employeeName || a.employeeUsername || "";
    const sNames = a.servicesLabel || serviceNames(a.services) || a.servicesFirstName || "—";

    return (
      <div className="card" title={sNames || ""}>
        <div className="stripe" style={{background: col}} />
        <div className="card-main">
          <div className="card-top">
            <div className="when">{fmtDateTime(a.start)}</div>
            <div className="spacer" />
            {canSeePriceBadge && <div className="price">{price}</div>}
          </div>
          <div className="card-subtop">
            <div className="emp">{emp}</div>
          </div>
          <div className="services clamp-2">{sNames}</div>
          <div className="meta">
            {canSeePaymentBadge && <span className="badge">{paid}</span>}
            {a.noShow && <span className="badge danger">⚠️ NO-SHOW</span>}
            {a.pickedEmployee && <span className="badge">⭐ izabrana radnica</span>}
            {src && <span className="badge">{src}</span>}
          </div>
          {a.note && <div className="note clamp-3">📝 {a.note}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <style>{`
        .drawer{
          position:fixed; inset:0 0 0 auto; width:min(760px,100%);
          background:#fdfaf7;
          border-left:1px solid #e6e0d7; box-shadow:-20px 0 40px rgba(0,0,0,.16);
          display:flex; flex-direction:column;
          animation: slideIn 0.25s ease-out;
        }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

        /* Uklonjene default plave boje */
        input, textarea, button { color:#1f1f1f; }
        input:focus, textarea:focus {
          border-color:#c7b299;
          outline:none;
          box-shadow:0 0 0 3px rgba(199,178,153,0.2);
        }
        a, a:visited { color:#1f1f1f; text-decoration:none; }
        a:hover { color:#000; }

        .head{ padding:14px; display:flex; flex-wrap:wrap; align-items:center; border-bottom:1px solid #eee; background:#fff; }
        .title{ font-weight:900; font-size:22px; color:#1f1f1f; }
        .blocked{ color:#dc2626; font-weight:700; }

        .toolbar{ margin-left:auto; display:flex; gap:8px; }
        .btn{ padding:8px 12px; border-radius:10px; border:1px solid #ddd6cc; background:#fff; font-weight:600; cursor:pointer; }
        .btn:hover{ background:#f5f0e8; }
        .btn.danger{ color:#dc2626; border-color:#dc2626; }

        .body{
          padding:16px;
          overflow-y:auto;
          max-height:calc(100dvh - 60px);
          display:grid; gap:16px; background:#fdfaf7;
        }

        .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .panel{ background:#fff; border:1px solid #e6e0d7; border-radius:14px; padding:14px; display:grid; gap:10px; }

        .line b{ color:#1f1f1f; }
        .muted{ color:#6b6b6b; }

        .input,.textarea{
          width:100%; padding:12px; border-radius:12px; border:1px solid #ddd6cc;
          background:#fff; font-size:15px; color:#1f1f1f;
        }

        .section-title{ font-weight:700; font-size:15px; color:#1f1f1f; margin-bottom:8px; }

        .cards{ display:grid; gap:12px; }
        @media(min-width:980px){ .cards{ grid-template-columns:repeat(2,1fr); } }

        .card{ display:grid; grid-template-columns:6px 1fr; border:1px solid #eee3d7; border-radius:12px; overflow:hidden; background:#fff; }
        .stripe{ width:6px; }
        .card-main{ padding:12px; display:grid; gap:6px; }
        .card-top{ display:flex; align-items:center; font-size:14px; color:#1f1f1f; }
        .price{ background:#faf6f0; border:1px solid #e6e0d7; border-radius:999px; padding:2px 8px; font-weight:600; font-size:13px; color:#1f1f1f; }
        .services{ font-size:14px; font-weight:500; color:#1f1f1f; }
        .meta{ display:flex; gap:6px; flex-wrap:wrap; font-size:12px; }
        .badge{ padding:3px 8px; border-radius:999px; border:1px solid #ddd6cc; background:#fdfaf7; color:#1f1f1f; }
        .badge.danger{ color:#dc2626; border-color:#dc2626; }
        .note{ background:#fafafa; border:1px solid #e5e7eb; padding:8px; border-radius:8px; font-size:13px; color:#1f1f1f; }

        @media (max-width:720px){
          .title{ font-size:18px; }
          .body{ padding:12px; gap:12px; }
          .grid{ grid-template-columns:1fr; }
          .panel{ padding:10px; border-radius:10px; }
          .cards{ grid-template-columns:1fr !important; gap:10px; }
          .card-main{ padding:10px; }
          .card-top{ font-size:13px; }
          .price{ font-size:12px; }
          .services{ font-size:13px; }
        }
      `}</style>

      <div className="head">
        <div className="title">
          {maskedName(clientLive)}
          {clientLive.blocked && <span className="blocked"> · BLOKIRAN</span>}
          <span style={{marginLeft:8, fontSize:14, color:"#6b6b6b"}}>No-Show: {noShowCount}</span>
        </div>
        <div className="toolbar">
          {!edit ? (
            <>
              <button className="btn" onClick={()=>setEdit(true)}>Izmeni</button>
              <button className="btn" onClick={onToggleBlock}>{clientLive.blocked ? "Odblokiraj" : "Blokiraj"}</button>
              <button className="btn danger" onClick={onDelete}>Obriši</button>
              <button className="btn" onClick={onClose}>❌</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={save}>Sačuvaj</button>
              <button className="btn" onClick={()=>setEdit(false)}>Otkaži</button>
              <button className="btn" onClick={onClose}>❌</button>
            </>
          )}
        </div>
      </div>

      <div className="body">
        {!edit ? (
          <div className="panel">
            <div className="line"><b>Telefon:</b> {maskedPhone(clientLive.phone)}</div>
            <div className="line"><b>E-mail:</b> {role === "admin" ? (clientLive.email || "—") : "—"}</div>
            <div className="line"><b>Beleška:</b> {clientLive.note || "—"}</div>
            {role === "admin" && (
              <div className="line"><b>Ukupno zarađeno:</b> {fmtMoney(totalEarned)} RSD</div>
            )}
            {nextAppt && (
              <div className="line"><b>Naredni termin:</b> {fmtDateTime(nextAppt.start)} · {nextAppt.employeeName || nextAppt.employeeUsername || ""}</div>
            )}
          </div>
        ) : (
          <div className="grid">
            <input className="input" placeholder="Ime" value={form.firstName} onChange={e=>setForm(s=>({...s, firstName:e.target.value}))}/>
            <input className="input" placeholder="Prezime" value={form.lastName} onChange={e=>setForm(s=>({...s, lastName:e.target.value}))}/>
            <input className="input" placeholder="Telefon" value={form.phone} onChange={e=>setForm(s=>({...s, phone:e.target.value}))}/>
            <input className="input" placeholder="E-mail" value={form.email} onChange={e=>setForm(s=>({...s, email:e.target.value}))}/>
            <div style={{gridColumn:"1 / -1"}}>
              <textarea className="textarea" placeholder="Beleška o klijentu…" value={form.note} onChange={e=>setForm(s=>({...s, note:e.target.value}))}/>
            </div>
          </div>
        )}

        <div>
          <div className="section-title">Naredni termini</div>
          <div className="cards">
            {future.length ? future.map(a => <AppointmentCard key={a.id} a={a} />) : <div className="muted">Nema budućih termina.</div>}
          </div>
        </div>

        <div>
          <div className="section-title">Prošli termini</div>
          <div className="cards">
            {past.length ? past.map(a => <AppointmentCard key={a.id} a={a} />) : <div className="muted">Nema prošlih termina.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
