// src/partials/ClientProfileDrawer.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, onSnapshot, doc, setDoc
} from "firebase/firestore";
import { db } from "../firebase";

function toJsDate(x){ return x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : new Date(x)); }
function fmtDateTime(d){
  const x = toJsDate(d);
  return x.toLocaleString("sr-RS",{ dateStyle:"medium", timeStyle:"short" });
}
function fmtMoney(n){ return Number(n||0).toLocaleString("sr-RS"); }

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

  // === helpers za maskiranje po ulozi ===
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
  // admin i salon vide način plaćanja, worker ne
  const canSeePaymentBadge = role !== "worker";
  // admin i salon vide cenu; worker ne
  const canSeePriceBadge = role !== "worker";

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

  useEffect(()=>{
    const qy = query(collection(db,"appointments"), where("clientId","==", client.id));
    const unsub = onSnapshot(qy, snap=>{
      const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      rows.sort((a,b)=> toJsDate(b.start) - toJsDate(a.start));
      setAppts(rows);
    });
    return ()=>unsub && unsub();
  }, [client.id]);

  const now = new Date();
  const future = useMemo(()=> appts.filter(a=>toJsDate(a.start) > now).sort((a,b)=>toJsDate(a.start)-toJsDate(b.start)), [appts]);
  const past   = useMemo(()=> appts.filter(a=>toJsDate(a.start) <= now).sort((a,b)=>toJsDate(b.start)-toJsDate(a.start)), [appts]);

  const totalEarned = useMemo(()=> appts.reduce((s,a)=> s + (Number(a.priceRsd||0)||0), 0), [appts]);
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
    const price = Number(a.priceRsd||0) ? `${fmtMoney(a.priceRsd)} RSD` : "—";
    const paid  = a.paid ? (a.paid==="cash" ? "💵 keš" : (a.paid==="card" ? "💳 kartica" : a.paid)) : "nije naplaćeno";
    const src   = a.source === "manual" ? "Admin" : (a.source || "Online");
    const emp   = a.employeeName || a.employeeUsername || "";
    const sNames = serviceNames(a.services);

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

          <div className="services clamp-2">{sNames || "—"}</div>

          <div className="meta">
            {canSeePaymentBadge && <span className="badge">{paid}</span>}
            {a.noShow && <span className="badge danger">⚠️ NO-SHOW</span>}
            {a.pickedEmployee && <span className="badge">⭐ izabrana radnica</span>}
          </div>

          <div className="created muted clamp-1">Kreirano: {a.createdAt ? fmtDateTime(a.createdAt) : "—"} • Izvor: {src}</div>
          {a.note && <div className="note clamp-3">📝 {a.note}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <style>{`
        /* Base Styles */
        .drawer{
          position:fixed; inset:0 0 0 auto; width:min(760px,100%); background:rgba(253,250,247,.9);
          -webkit-backdrop-filter:saturate(120%) blur(6px); backdrop-filter:saturate(120%) blur(6px);
          border-left:1px solid #e6e0d7; box-shadow:-20px 0 40px rgba(0,0,0,.16);
          z-index:60; display:flex; flex-direction:column;
          transition: transform 0.3s ease-out; transform: translateX(0);
          animation: slideIn 0.25s ease-out;
        }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }

        .head{
          position:sticky; top:0; z-index:2;
          padding:12px 14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;
          border-bottom:1px solid #f1ede7;
          background:linear-gradient(to bottom, rgba(255,255,255,.7), rgba(253,250,247,.7));
          -webkit-backdrop-filter:saturate(120%) blur(6px); backdrop-filter:saturate(120%) blur(6px);
        }
        .title{
          font-weight:900; font-size:22px; letter-spacing:.2px; color:#3f3f46;
          text-shadow:0 1px 1px rgba(0,0,0,0.05);
          display:flex; align-items:center; gap:8px;
        }
        .blocked{ color:#ef4444; font-weight:800; }

        .toolbar{ margin-left:auto; display:flex; gap:8px; align-items:center; overflow:auto; }
        .btn{
          padding:8px 12px; border-radius:999px; border:1px solid #ddd6cc; background:#fff;
          cursor:pointer; font-weight:600; transition:all .2s ease; white-space:nowrap;
          box-shadow:0 2px 4px rgba(0,0,0,0.05); font-size:14px;
        }
        .btn:hover{ background:#f5f0e8; box-shadow:0 4px 8px rgba(0,0,0,0.10); transform:translateY(-1px); }
        .btn.danger{ color:#ef4444; border-color:#ef4444; }
        .btn.danger:hover{ background:#fef2f2; }

        .body{
          padding:18px; overflow:auto; display:grid; gap:18px; background:#fdfaf7;
        }

        .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .panel{
          background:#f9f5f0; border:1px solid #e6e0d7; border-radius:16px;
          padding:14px; display:grid; gap:10px; box-shadow:0 4px 12px rgba(0,0,0,0.05);
          transition:box-shadow .3s ease;
        }
        .panel:hover{ box-shadow:0 6px 16px rgba(0,0,0,0.08); }
        .line{ display:flex; gap:8px; align-items:center; font-size:15px; line-height:1.3; }
        .line b{ color:#4b5563; }
        .muted{ color:#6b7280; font-size:14px; }

        .input,.textarea{
          width:100%; padding:12px 14px; border-radius:14px; border:1px solid #e6e0d7;
          background:#fff; transition:all .2s ease; box-shadow:inset 0 1px 3px rgba(0,0,0,0.05);
          font-size:15px;
        }
        .input:focus,.textarea:focus{ border-color:#c7b299; box-shadow:0 0 0 3px rgba(199,178,153,0.2); outline:none; }
        .textarea{ min-height:110px; resize:vertical; }

        .section-title{
          font-weight:900; font-size:15px; letter-spacing:.3px; color:#3f3f46;
          margin-bottom:10px; text-transform:uppercase; position:relative;
        }
        .section-title::after{
          content:''; position:absolute; bottom:-6px; left:0; width:40px; height:2px;
          background:linear-gradient(to right,#c7b299,#e9e5de);
        }

        .cards{ display:grid; gap:12px; }
        @media(min-width:980px){ .cards{ grid-template-columns:repeat(2,minmax(0,1fr)); } }

        /* Utils */
        .clamp-1{ display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden; }
        .clamp-2{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .clamp-3{ display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }

        /* Appointment Card */
        .card{
          display:grid; grid-template-columns:10px 1fr;
          border:1px solid #eee3d7; border-radius:14px; overflow:hidden; background:#fff;
          box-shadow:0 6px 16px rgba(0,0,0,.06); transition:all .25s ease;
        }
        .card:hover{ box-shadow:0 8px 20px rgba(0,0,0,.1); transform:translateY(-2px); }
        .stripe{ width:10px; opacity:.9; }
        .card-main{ padding:12px 14px; display:grid; gap:8px; }

        .card-top{
          display:flex; gap:8px; align-items:center; font-weight:600; font-size:14px; line-height:1.2;
          color:#374151; flex-wrap:wrap;
        }
        .card-subtop{ display:flex; align-items:center; gap:8px; color:#6b7280; font-weight:500; font-size:13px; }
        .when{ font-size:14px; display:flex; align-items:center; gap:4px; }
        .emp{ font-size:13px; }
        .spacer{ flex:1; }

        .price{
          background:linear-gradient(to bottom,#faf6f0,#f5f0e8); border:1px solid #e6e0d7; border-radius:999px;
          padding:4px 10px; font-weight:600; font-size:13px; white-space:nowrap; color:#4b5563;
        }
        .services{ font-size:14px; font-weight:500; line-height:1.3; color:#3f3f46; }
        .meta{ display:flex; gap:6px; flex-wrap:wrap; font-size:12px; }
        .badge{
          display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px;
          border:1px solid #ddd6cc; background:#fff; font-size:12px; color:#4b5563;
          box-shadow:0 1px 2px rgba(0,0,0,0.05);
        }
        .badge.danger{ color:#ef4444; border-color:#ef4444; background:#fff; }
        .created{ font-size:12px; color:#6b7280; }
        .note{
          background:#f9fafb; border:1px solid #e5e7eb; padding:8px 10px;
          border-radius:10px; font-size:13px; line-height:1.3; color:#374151;
        }

        /* ---- MOBILE TUNE-UPS ---- */
        @media (max-width: 720px){
          .drawer{ width:100%; border-left:none; }
          .title{ font-size:18px; }
          .toolbar{ gap:6px; }
          .btn{ padding:7px 10px; font-size:13px; }
          .body{ padding:14px; gap:14px; }
          .grid{ grid-template-columns:1fr; gap:10px; }
          .panel{ border-radius:14px; padding:12px; gap:8px; }

          .cards{ gap:10px; }
          .card-main{ padding:12px; gap:8px; }
          .card-top{ font-size:13px; }
          .when{ font-size:13px; }
          .emp{ font-size:12px; }
          .price{ padding:3px 8px; font-size:12px; }
          .services{ font-size:13px; }
          .note{ font-size:12.5px; }
        }
      `}</style>

      <div className="head">
        <div className="title">
          {maskedName(clientLive)}
          {clientLive.blocked && <span className="blocked">· BLOKIRAN</span>}
          <span style={{marginLeft:8, fontSize:14, color:"#6b7280"}}>No-Show: {noShowCount}</span>
        </div>

        <div className="toolbar">
          {!edit ? (
            <>
              <button className="btn" onClick={()=>setEdit(true)}>Izmeni</button>
              <button className="btn" onClick={onToggleBlock}>{clientLive.blocked ? "Odblokiraj" : "Blokiraj"}</button>
              <button className="btn danger" onClick={onDelete}>Obriši</button>
              <button className="btn" aria-label="Zatvori" onClick={onClose}>❌</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={save}>Sačuvaj</button>
              <button className="btn" onClick={()=>setEdit(false)}>Otkaži</button>
              <button className="btn" aria-label="Zatvori" onClick={onClose}>❌</button>
            </>
          )}
        </div>
      </div>

      <div className="body">
        {/* INFO / EDIT */}
        {!edit ? (
          <div className="panel" role="region" aria-label="Osnovni podaci o klijentu">
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
              <textarea className="textarea" placeholder="Beleška o klijentu…"
                value={form.note} onChange={e=>setForm(s=>({...s, note:e.target.value}))}/>
            </div>
          </div>
        )}

        {/* NAREDNI TERMINI */}
        <div>
          <div className="section-title">Naredni termini</div>
          <div className="cards">
            {future.length
              ? future.map(a => <AppointmentCard key={a.id} a={a} />)
              : <div className="muted">Nema budućih termina.</div>}
          </div>
        </div>

        {/* PROŠLI TERMINI */}
        <div>
          <div className="section-title">Prošli termini</div>
          <div className="cards">
            {past.length
              ? past.map(a => <AppointmentCard key={a.id} a={a} />)
              : <div className="muted">Nema prošlih termina.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
