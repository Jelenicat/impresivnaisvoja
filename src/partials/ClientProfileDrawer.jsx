import React, { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, onSnapshot, doc, setDoc
} from "firebase/firestore";
import { db } from "../firebase";

function toJsDate(x){ return x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : new Date(x)); }
function fmtDateTime(d){ const x=toJsDate(d); return x.toLocaleString("sr-RS",{dateStyle:"medium",timeStyle:"short"}); }
function fmtDate(d){ return toJsDate(d).toLocaleDateString("sr-RS",{dateStyle:"medium"}); }
function fmtHM(d){ return toJsDate(d).toLocaleTimeString("sr-RS",{hour:"2-digit",minute:"2-digit"}); }
function addMinutes(date, m=0){ const d=new Date(toJsDate(date)); d.setMinutes(d.getMinutes()+(Number(m)||0)); return d; }
function fmtMoney(n){ return Number(n||0).toLocaleString("sr-RS"); }
function normPhone(p){ return String(p||"").replace(/\D+/g,""); }

export default function ClientProfileDrawer({
  client,
  role="admin",
  onClose,
  onDelete,
  onToggleBlock
}){
  const [clientLive,setClientLive]=useState(client);
  const [edit,setEdit]=useState(false);
  const [form,setForm]=useState({
    firstName:client.firstName||"",
    lastName:client.lastName||"",
    phone:client.phone||"",
    email:client.email||"",
    note:client.note||""
  });

  const [appts,setAppts]=useState([]);
  const [servicesMap,setServicesMap]=useState(new Map());
  const [categoriesMap,setCategoriesMap]=useState(new Map());

  function maskedName(c){ const f=c?.firstName||""; const l=c?.lastName||""; return role==="admin"?`${f} ${l}`.trim():`${f} ${l?(l[0].toUpperCase()+"."):""}`.trim(); }
  function maskedPhone(p){ const raw=(p||"").toString().replace(/\D/g,""); if(role==="admin") return p||"—"; if(!raw) return "—"; return `***${raw.slice(-3)}`; }
  const canSeePaymentBadge = role!=="worker";
  const canSeePriceBadge   = role!=="worker";

  useEffect(()=>{
    const ref=doc(db,"clients",client.id);
    const unsub=onSnapshot(ref,snap=>{
      const data={id:snap.id,...snap.data()};
      setClientLive(data);
      if(!edit){
        setForm({
          firstName:data.firstName||"",
          lastName:data.lastName||"",
          phone:data.phone||"",
          email:data.email||"",
          note:data.note||""
        });
      }
    });
    return ()=>unsub&&unsub();
  },[client.id,edit]);

  useEffect(()=>{
    const unsubS=onSnapshot(collection(db,"services"),snap=>{
      const m=new Map(); snap.docs.forEach(d=>m.set(d.id,{id:d.id,...d.data()})); setServicesMap(m);
    });
    const unsubC=onSnapshot(collection(db,"categories"),snap=>{
      const m=new Map(); snap.docs.forEach(d=>m.set(d.id,{id:d.id,...d.data()})); setCategoriesMap(m);
    });
    return ()=>{unsubS&&unsubS(); unsubC&&unsubC();};
  },[]);

  useEffect(()=>{
    const seen=new Map();
    const push=(snap)=>{
      snap.forEach(d=>{ const row={id:d.id,...d.data()}; seen.set(d.id,row); });
      const all=Array.from(seen.values()).sort((a,b)=>toJsDate(b.start)-toJsDate(a.start));
      setAppts(all);
    };
    const unsubs=[];
    if(client?.id){
      const q1=query(collection(db,"appointments"),where("clientId","==",client.id));
      unsubs.push(onSnapshot(q1,push));
    }
    const phoneN=normPhone(client?.phone);
    if(phoneN){
      const q2=query(collection(db,"appointments"),where("clientPhoneNorm","==",phoneN));
      unsubs.push(onSnapshot(q2,push));
    }
    return ()=>unsubs.forEach(u=>u&&u());
  },[client?.id,client?.phone]);

  const now=new Date();
  const future=useMemo(()=>appts.filter(a=>toJsDate(a.start)>now).sort((a,b)=>toJsDate(a.start)-toJsDate(b.start)),[appts]);
  const past=useMemo(()=>appts.filter(a=>toJsDate(a.start)<=now).sort((a,b)=>toJsDate(b.start)-toJsDate(a.start)),[appts]);
  const totalEarned=useMemo(()=>appts.reduce((s,a)=>{const n=Number(a.priceRsd??a.totalAmountRsd??0); return s+(isFinite(n)?n:0);},0),[appts]);
  const nextAppt=future[0]||null;
  const noShowCount=useMemo(()=>appts.filter(a=>a.noShow).length,[appts]);

  async function save(){
    const ref=doc(db,"clients",client.id);
    await setDoc(ref,{
      firstName:(form.firstName||"").trim(),
      lastName:(form.lastName||"").trim(),
      phone:(form.phone||"").trim(),
      email:(form.email||"").trim(),
      note:(form.note||""),
      updatedAt:new Date()
    },{merge:true});
    setEdit(false);
  }

  function serviceNames(ids=[]){ return (ids||[]).map(id=>servicesMap.get(id)?.name||"—").filter(Boolean).join(", "); }
  function cardColor(ids=[]){ const first=servicesMap.get((ids||[])[0]); const col=first?categoriesMap.get(first.categoryId)?.color:null; return col||"#e9e5de"; }

  function AppointmentCard({a}){
    const col=cardColor(a.services);
    const priceVal=Number(a.priceRsd??a.totalAmountRsd??0);
    const price=priceVal?`${fmtMoney(priceVal)} RSD`:"—";
    const paid=a.paid?(a.paid==="cash"?"💵 keš":(a.paid==="card"?"💳 kartica":a.paid)):"nije naplaćeno";
    const src=a.source==="manual"?"Admin":(a.source||(a.isOnline?"Online":"—"));
    const emp=a.employeeName||a.employeeUsername||"—";
    const sNames=a.servicesLabel||serviceNames(a.services)||a.servicesFirstName||"—";
    const durMin=a.durationMin||a.duration||0;
    const endTime=a.end?toJsDate(a.end):addMinutes(a.start,durMin);
    const date=fmtDate(a.start);
    const timeRange=`${fmtHM(a.start)}–${fmtHM(endTime)}`;

    return (
      <div className="card" title={sNames||""}>
        <div className="stripe" style={{background:col}} />
        <div className="card-main">
          <div className="card-top">
            <div className="when">
              <span className="date">{date}</span>
              <span className="dot">·</span>
              <span className="time">{timeRange}</span>
            </div>
            <div className="spacer" />
            {canSeePriceBadge && <div className="price">{price}</div>}
          </div>
          <div className="card-subtop">
            <div className="emp">👩‍💼 {emp}</div>
            {durMin ? <div className="dur">⏱ {durMin} min</div> : null}
          </div>
          <div className="services clamp-3">🧾 {sNames}</div>
          <div className="meta">
            {canSeePaymentBadge && <span className="badge">{paid}</span>}
            {src && <span className="badge">📲 {src}</span>}
            {a.pickedEmployee && <span className="badge">⭐ izabrana radnica</span>}
            {a.noShow && <span className="badge danger">⚠️ NO-SHOW</span>}
          </div>
          {a.note && <div className="note clamp-3">📝 {a.note}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" onClick={(e)=>e.stopPropagation()}>
        <style>{`
          /* ---- Global spacing variables (gutter + safe area) ---- */
          .drawer{ --gutter: clamp(16px, 5vw, 24px); }

          .backdrop{ position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:1000; }
          .drawer{
            position:fixed; top:0; right:0; width:min(440px, 94vw); height:100%;
            background:#fdfaf7; border-left:1px solid #e6e0d7; box-shadow:-10px 0 20px rgba(0,0,0,0.1);
            display:flex; flex-direction:column; animation:slideIn .3s ease-out; z-index:1001;
          }
          @keyframes slideIn{ from{ transform:translateX(100%);} to{ transform:translateX(0);} }

          input, textarea, button{ color:#1f1f1f; -webkit-text-fill-color:#1f1f1f; }
          input:focus, textarea:focus{ border-color:#c7b299; outline:none; box-shadow:0 0 0 3px rgba(199,178,153,.2); }
          a, a:visited{ color:#1f1f1f; text-decoration:none; } a:hover{ color:#000; }

          /* ---- Header (sa leve/desne margine) ---- */
          .head{
            padding-top: calc(max(12px, env(safe-area-inset-top)));
            padding-bottom: 12px;
            padding-left: calc(var(--gutter) + env(safe-area-inset-left));
            padding-right: calc(var(--gutter) + env(safe-area-inset-right));
            display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px;
            border-bottom:1px solid #e6e0d7; background:#fff; position:sticky; top:0; z-index:10;
          }
          .title{ font-weight:900; font-size:20px; color:#1f1f1f; flex:1; min-width:60%; }
          .blocked{ color:#dc2626; font-weight:700; }
          .no-show{ font-size:13px; color:#6b6b6b; margin-left:6px; }
          .toolbar{ display:flex; gap:8px; flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; }
          .btn{ padding:8px 12px; border-radius:10px; border:1px solid #ddd6cc; background:#fff; font-weight:700; font-size:14px; min-height:36px; }
          .btn:hover{ background:#f5f0e8; } .btn.danger{ color:#dc2626; border-color:#dc2626; }

          /* ---- Body sa velikim unutrašnjim odmakom + container ---- */
          .body{
            flex:1; overflow-y:auto; background:#f7f2eb;
            padding-left: calc(var(--gutter) + env(safe-area-inset-left));
            padding-right: calc(var(--gutter) + env(safe-area-inset-right));
            padding-top: 14px;
            padding-bottom: calc(18px + env(safe-area-inset-bottom));
          }
          .container{
            max-width: 720px;   /* štiti od širenja i na tabletima / većim telefonima */
            margin: 0 auto;     /* centrirano unutar body-ja */
            display: grid; gap: 20px;
          }

          /* ---- Sekcije ---- */
          .section{ display:grid; gap:12px; }
          .section-head{
            display:flex; align-items:baseline; gap:8px;
            position:sticky; top:0; padding:6px 0; background:linear-gradient(#f7f2eb, #f7f2eb);
            z-index:5; border-bottom:1px solid #eadfce;
          }
          .section-title{ font-weight:900; font-size:16px; color:#1f1f1f; letter-spacing:.2px; }
          .section-count{ font-weight:700; font-size:13px; color:#6b6b6b; }

          /* ---- Kartice ---- */
          .cards{ display:grid; gap:12px; }
          .card{
            display:grid; grid-template-columns:8px 1fr; border:1px solid #eee3d7; border-radius:16px; overflow:hidden; background:#fff;
            box-shadow:0 1px 0 rgba(0,0,0,.02);
          }
          .stripe{ width:8px; }
          .card-main{ padding:12px; display:grid; gap:8px; }
          .card-top{ display:flex; align-items:center; gap:8px; font-size:13px; color:#1f1f1f; }
          .when{ font-weight:700; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
          .when .dot{ opacity:.5; }
          .spacer{ flex:1; }
          .price{ background:#faf6f0; border:1px solid #e6e0d7; border-radius:999px; padding:2px 8px; font-weight:800; font-size:12px; white-space:nowrap; }
          .card-subtop{ display:flex; gap:10px; align-items:center; font-size:12px; color:#3a3a3a; }
          .emp{ font-weight:600; }
          .dur{ opacity:.85; }
          .services{ font-size:13px; font-weight:500; color:#1f1f1f; line-height:1.4; }
          .meta{ display:flex; gap:6px; flex-wrap:wrap; font-size:11px; }
          .badge{ padding:3px 8px; border-radius:999px; border:1px solid #ddd6cc; background:#fdfaf7; color:#1f1f1f; white-space:nowrap; }
          .badge.danger{ color:#dc2626; border-color:#dc2626; }
          .note{ background:#fafafa; border:1px solid #e5e7eb; padding:8px; border-radius:10px; font-size:12px; color:#1f1f1f; }

          /* ---- Info panel ---- */
          .panel{ background:#fff; border:1px solid #e6e0d7; border-radius:16px; padding:12px; display:grid; gap:8px; box-shadow:0 1px 0 rgba(0,0,0,.02); }
          .grid{ display:grid; grid-template-columns:1fr; gap:12px; }
          .line b{ color:#1f1f1f; }
          .muted{ color:#6b6b6b; }
          .input,.textarea{ width:100%; padding:10px; border-radius:12px; border:1px solid #ddd6cc; background:#fff; font-size:14px; }
          .textarea{ min-height:80px; resize:vertical; }

          /* ---- Responsive ---- */
          @media (min-width:720px){
            .drawer{ width:min(760px, 80vw); }
            .cards{ grid-template-columns:repeat(2,1fr); }
            .title{ font-size:22px; }
          }
          @media (max-width:480px){
            .drawer{ width:100vw; }
            .title{ font-size:18px; }
            .toolbar .btn{ padding:6px 10px; font-size:12px; min-height:32px; border-radius:9px; }
            .card-main{ padding:12px; }
            .card-top{ font-size:12px; }
            .price{ font-size:11px; padding:2px 6px; }
            .services{ font-size:12px; }
            .meta{ font-size:10px; gap:4px; }
            .badge{ padding:2px 6px; }
            .note{ font-size:11px; padding:6px; }
          }

          .clamp-3{ display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
        `}</style>

        <div className="head">
          <div className="title">
            {maskedName(clientLive)}
            {clientLive.blocked && <span className="blocked"> · BLOKIRAN</span>}
            <span className="no-show">No-Show: {noShowCount}</span>
          </div>
          <div className="toolbar">
            {!edit ? (
              <>
                <button className="btn" onClick={()=>setEdit(true)}>Izmeni</button>
                <button className="btn" onClick={onToggleBlock}>{clientLive.blocked ? "Odblokiraj":"Blokiraj"}</button>
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
          <div className="container">
            {/* Naredni termini */}
            <div className="section">
              <div className="section-head">
                <div className="section-title">Naredni termini</div>
                <div className="section-count">({future.length})</div>
              </div>
              <div className="cards">
                {future.length ? future.map(a => <AppointmentCard key={a.id} a={a} />) : <div className="muted">Nema budućih termina.</div>}
              </div>
            </div>

            {/* Prošli termini */}
            <div className="section">
              <div className="section-head">
                <div className="section-title">Prošli termini</div>
                <div className="section-count">({past.length})</div>
              </div>
              <div className="cards">
                {past.length ? past.map(a => <AppointmentCard key={a.id} a={a} />) : <div className="muted">Nema prošlih termina.</div>}
              </div>
            </div>

            {/* Info o klijentu */}
            {!edit ? (
              <div className="panel">
                <div className="line"><b>Telefon:</b> {maskedPhone(clientLive.phone)}</div>
                <div className="line"><b>E-mail:</b> {role==="admin" ? (clientLive.email || "—") : "—"}</div>
                <div className="line"><b>Beleška:</b> {clientLive.note || "—"}</div>
                {role==="admin" && <div className="line"><b>Ukupno zarađeno:</b> {fmtMoney(totalEarned)} RSD</div>}
                {nextAppt && (
                  <div className="line"><b>Naredni termin:</b> {fmtDateTime(nextAppt.start)} · {nextAppt.employeeName || nextAppt.employeeUsername || ""}</div>
                )}
              </div>
            ) : (
              <div className="grid">
                <input className="input" placeholder="Ime" value={form.firstName} onChange={e=>setForm(s=>({...s,firstName:e.target.value}))}/>
                <input className="input" placeholder="Prezime" value={form.lastName} onChange={e=>setForm(s=>({...s,lastName:e.target.value}))}/>
                <input className="input" placeholder="Telefon" value={form.phone} onChange={e=>setForm(s=>({...s,phone:e.target.value}))}/>
                <input className="input" placeholder="E-mail" value={form.email} onChange={e=>setForm(s=>({...s,email:e.target.value}))}/>
                <div style={{gridColumn:"1 / -1"}}>
                  <textarea className="textarea" placeholder="Beleška o klijentu…" value={form.note} onChange={e=>setForm(s=>({...s,note:e.target.value}))}/>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
