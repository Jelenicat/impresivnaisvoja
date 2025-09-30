// src/pages/AdminFinance.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection, query, where, onSnapshot,
  addDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { Serbian } from "flatpickr/dist/l10n/sr.js";
import { useNavigate } from "react-router-dom";

/* ---- helpers ---- */
const toJsDate = (x) =>
  x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : new Date(x));
const startOfDay = (d) => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x=new Date(d); x.setHours(23,59,59,999); return x; };
const asDateInput = (d) => (d ? new Date(d).toISOString().slice(0,10) : "");
const fmtMoney = (n) => Number(n||0).toLocaleString("sr-RS");

const isMobile = () => (typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)").matches : false);

export default function AdminFinance({
  role = localStorage.getItem("role") || "admin",
  currentUsername = localStorage.getItem("employeeId") || null
}){
  const nav = useNavigate();   // ⬅️ OVO OVDE

  /* State */
  const today = startOfDay(new Date());
  const [from, setFrom] = useState(role==="salon" ? today : startOfDay(new Date()));
  const [to, setTo]     = useState(role==="salon" ? endOfDay(new Date()) : endOfDay(new Date()));

  const [appointments, setAppointments] = useState([]);
  const [servicesMap, setServicesMap]   = useState(new Map());
  const [employees, setEmployees]       = useState([]);
  const [expenses, setExpenses]         = useState([]);

  // unos troškova (samo admin)
  const [expAmt, setExpAmt]   = useState("");
  const [expNote, setExpNote] = useState("");

  // mobilno: harmonike — po difoltu ZATVORENE na mobilnom
  const mobileDefaultClosed = isMobile();
  const [openServices, setOpenServices]   = useState(!mobileDefaultClosed);
  const [openEmployees, setOpenEmployees] = useState(!mobileDefaultClosed);
  const [openExpenses, setOpenExpenses]   = useState(!mobileDefaultClosed);

  /* Desktop: detaljni panel */
  const [detailKey, setDetailKey] = useState(null); // "split" | "worker" | "net" | "services" | "employees" | "expenses"
  const [detailTitle, setDetailTitle] = useState("");
  const openDetail = (key, title) => {
    if (isMobile()) return;
    setDetailKey(key);
    setDetailTitle(title);
  };
  const closeDetail = () => { setDetailKey(null); setDetailTitle(""); };

  /* Load data */
  useEffect(() => {
    const base = collection(db,"appointments");
    const qy = role==="worker"
      ? query(base, where("employeeUsername","==", currentUsername))
      : base;

    const unsub = onSnapshot(qy, snap => {
      setAppointments(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return () => unsub && unsub();
  }, [role, currentUsername]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db,"services"), snap=>{
      const m=new Map(); snap.docs.forEach(d=>m.set(d.id,{id:d.id,...d.data()}));
      setServicesMap(m);
    });
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db,"employees"), snap=>{
      setEmployees(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db,"expenses"), snap=>{
      setExpenses(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
    return () => unsub && unsub();
  }, []);

  /* === ACTUELNA CENA IZ USLUGA === */
  const apptValue = useCallback((a) => {
    // Ako termin ima listu usluga → saberi njihove trenutne cene iz servicesMap
    const ids = Array.isArray(a?.services) ? a.services : null;
    if (ids && ids.length) {
      return ids.reduce((sum, id) => {
        const svc = servicesMap.get(id);
        return sum + Number(svc?.priceRsd || 0);
      }, 0);
    }
    // Fallback za stare termine bez services polja
    return Number(a?.priceRsd) || 0;
  }, [servicesMap]);

  /* Derived */
  const paidInRange = useMemo(() => {
    const s=from, e=to;
    return appointments.filter(a=>{
      const t=toJsDate(a.start);
      return a.paid && t>=s && t<=e;
    });
  }, [appointments, from, to]);

  const splitTotals = useMemo(() => {
    let cash=0, card=0, bank=0, total=0;
    paidInRange.forEach(a=>{
      const v = apptValue(a);
      total += v;
      if (a.paid==="cash") cash += v;
      if (a.paid==="card") card += v;
      if (a.paid==="bank") bank += v;
    });
    return { cash, card, bank, total };
  }, [paidInRange, apptValue]);

  // ✅ Usluge (broj izvršenja)
  const serviceCounter = useMemo(() => {
    const counts = new Map();
    for (const a of paidInRange) {
      for (const id of (a.services ?? [])) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    // Array.from(map) → [ [id, cnt], ... ]
    return Array.from(counts, ([id, cnt]) => ({
      id,
      cnt,
      name: servicesMap.get(id)?.name ?? "—",
    })).sort((a, b) => b.cnt - a.cnt);
  }, [paidInRange, servicesMap]);

  // ✅ Zarada po radnici (sa aktuelnim cenama iz usluga)
  const earningsByEmployee = useMemo(() => {
    const m = new Map();
    for (const a of paidInRange) {
      const key = a.employeeUsername || a.employeeId || "—";
      m.set(key, (m.get(key) || 0) + apptValue(a));
    }
    return Array.from(m.entries()).map(([username, total]) => {
      const emp = employees.find(e => e.username === username);
      const name = emp ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim() : username;
      return { username, name, total };
    }).sort((a, b) => b.total - a.total);
  }, [paidInRange, employees, apptValue]);

  const expensesTotal = useMemo(() => {
    return expenses
      .filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; })
      .reduce((s,x)=> s + (Number(x.amountRsd)||0), 0);
  }, [expenses, from, to]);

  const workerOwn = useMemo(() => {
    if (role!=="worker") return { total:0, count:0 };
    let total=0, count=0;
    paidInRange.forEach(a=>{
      total += apptValue(a);
      count += 1;
    });
    return { total, count };
  }, [role, paidInRange, apptValue]);

  /* Actions */
  async function addExpense(){
    if (!expAmt) return;
    await addDoc(collection(db,"expenses"),{
      amountRsd: Number(expAmt),
      note: (expNote||"").trim(),
      date: new Date(),
      createdAt: serverTimestamp()
    });
    setExpAmt(""); setExpNote("");
  }

  /* Permissions */
  const canPickRange     = role!=="salon";
  const canSeeSplit      = role==="admin" || role==="salon";
  const canSeeServices   = role==="admin" || role==="salon";
  const canSeeEmployees  = role==="admin";
  const canSeeExpenses   = role==="admin";
  const canSeeWorkerOnly = role==="worker";

  /* Helpers for detail panel lists */
  const formatEmpName = (username) => {
    const emp = employees.find(e=>e.username===username);
    return emp ? `${emp.firstName||""} ${emp.lastName||""}`.trim() : (username || "—");
  };
  const formatServices = (ids=[]) => ids.map(id=>servicesMap.get(id)?.name||"—").filter(Boolean).join(", ") || "—";

  return (
    <div className="fin-wrap">
      <style>{`
        /* ===== MOBILNI – BEZ IZMJENA ===== */
        .fin-wrap{
          min-height: 100vh;
          padding: 0;
          background:
            radial-gradient(1200px 800px at 10% 0%, #ffe6f5 0%, transparent 60%),
            radial-gradient(1200px 800px at 100% 100%, #e9e7ff 0%, transparent 60%),
            #faf7f4;
          overflow-x: hidden;
        }
        .fin-container{
          width:100%;
          max-width: 100%;
          margin:0;
          padding:50px;
          border-radius:0;
          position:relative;
          background: transparent;
          border:none;
          box-shadow: none;
          backdrop-filter: none;
          min-height: 100vh;
          overflow-y: auto;
        }
        .fin-title{
          font-size: 22px; font-weight: 900; letter-spacing:.2px; color:#2f2f33;
          text-align:center; margin:0 0 16px 0;
          padding: 50px 0;
          background: rgba(255,255,255,0.9);
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
/* ========== BASE (važi svuda) ========== */
/* ========== BASE (važi svuda) ========== */
.fin-header{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  position:relative;
}

.back-btn{
  /* poravnanje strelice i teksta */
  display:inline-flex;
  align-items:center;
  gap:6px;

  height:38px;
  padding:0 14px;
  border-radius:999px;
  font-size:14px;
  font-weight:700;
  cursor:pointer;

  background: linear-gradient(180deg, rgba(255,255,255,.9), rgba(255,255,255,.7));
  border:1px solid #e5ded7;
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 6px rgba(0,0,0,.06);
  -webkit-tap-highlight-color: transparent;
  transition: background .2s ease;
}
.back-btn:hover{ background:#f7f3ef; }

/* SVG ikonica – uvek u ravni sa tekstom */
.back-btn .chev,
.back-btn svg{
  width:18px; height:18px;
  line-height:1;
  display:block;
  flex-shrink:0;
}

.fin-title{
  font-weight:900;
  text-align:center;
}

/* ========== MOBILE (≤760px): Nazad iznad naslova, sve centrirano ========== */
@media (max-width: 760px){
  .fin-header{
    display: flex;
    flex-direction: column;   /* redosled: Nazad pa naslov */
    align-items: center;      /* centriraj naslov */
    gap: 8px;
    margin-bottom: 12px;

    position: sticky;         /* uvek pri vrhu pri scrollu */
    top: calc(env(safe-area-inset-top, 0px) + 6px);
    z-index: 120;
    background: #fdfdfd;      /* ista boja kao pozadina da ne preklapa */
    padding-top: 6px;
    padding-bottom: 6px;
  }

  .back-btn{
    align-self: flex-start;   /* dugme levo */
    margin-left: 12px;
    color:#fff;
  }

  .fin-title{
    font-size: 18px;
    font-weight: 800;
    text-align: center;
  }
}

/* ========== DESKTOP (≥641px): isti raspored kao mobilni, veće mere ========== */
@media (min-width: 641px){
  .fin-header{
    flex-direction: column;   /* Nazad gore, naslov ispod */
    align-items: center;      /* centrirano */
    gap: 12px;
    margin-bottom: 20px;
  }
  .back-btn{
    position: static;
    height: 40px;
    padding: 0 16px;
    font-size: 15px;
    font-weight: 600;
  }
  .fin-title{
    display:inline-block;
    padding: 12px 20px;
    background:#fff;
    border:1px solid #efe9e2;
    border-radius:12px;
    box-shadow:0 2px 8px rgba(0,0,0,.06);
    font-size:24px;
    font-weight:900;
    margin:0;
  }
}


/* Desktop ostaje kako je — ništa ne menjamo */

        .bar{
          display:flex; gap:8px; justify-content:center; align-items:center; margin-bottom:16px; flex-wrap:wrap;
          background: rgba(255,255,255,0.9);
          backdrop-filter: blur(12px);
          border-radius: 16px;
          padding: 12px;
          border: 1px solid #f0ebe4;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .bar .inp, .bar .btn{ height:38px; font-size: 14px; flex: 1 1 45%; min-width: 110px; }
        .inp{
          padding:6px 10px; border-radius:10px; border:1px solid #e8e2da; background:rgba(255,255,255,1);
          backdrop-filter: blur(6px); font-size: 14px;
        }
        .inp:focus{ outline: none; border-color: #f8b8d9; box-shadow: 0 0 0 2px rgba(248, 184, 217, 0.1); }
        .btn{
          padding:6px 10px; border-radius:10px; border:1px solid #e0d9cf; background:#fff; cursor:pointer;
          font-weight: 600; font-size: 13px; transition: all 0.2s ease;
        }
        .btn:hover{ background:#f6f2ed; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }

        .mobile-card{
          background: rgba(255,255,255,0.95);
          border:1px solid rgba(255,255,255,0.8);
          border-radius:12px; padding:14px; backdrop-filter: blur(10px);
          box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 12px; transition: all .3s cubic-bezier(.4,0,.2,1); overflow:hidden;
        }
        .mobile-card h3{ margin:0 0 10px; font-size:15px; font-weight:800; color:#3b3b40; }
        .big{ font-size:20px; font-weight:900; color:#242428; margin: 2px 0 4px; }
        .muted{ color:#666; font-size: 12px; margin-bottom: 6px; }

        .accordion{
          background: rgba(255,255,255,0.95);
          border:1px solid rgba(255,255,255,0.8);
          border-radius:12px; margin-bottom: 12px; overflow: hidden;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06); transition: all .3s cubic-bezier(.4,0,.2,1);
        }
        .acc-header{ padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;
          background: rgba(255,255,255,1); border-bottom: 1px solid #f0ebe4; transition: all .2s ease; user-select: none; }
        .acc-title{ font-weight:800; font-size:14px; color: #3b3b40; flex: 1; }
        .acc-indicator{ width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #f8b8d9, #f9d4e1);
          color: #6b3d6a; display:flex; align-items:center; justify-content:center; font-size: 10px; font-weight: 700; margin-left: 8px; transition: transform .3s ease; }
        .acc-header.open .acc-indicator{ transform: rotate(180deg); }

        .acc-content{ max-height: 0; overflow: hidden; transition: max-height .4s cubic-bezier(.4,0,.2,1), padding .4s ease; background: rgba(248, 245, 242, 0.8); }
        .acc-content.open{ max-height: 1500px; padding: 14px 16px; }

        .split-row{ display:flex; flex-direction: column; gap:6px; margin-top:6px; }
        .split-box{ border:1px solid #e8e2da; border-radius:10px; padding:10px; text-align:center; background: rgba(255,255,255,0.9);
          transition: all .2s ease; }
        .split-box:hover{ transform: scale(1.01); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .split-box .big{ font-size: 16px; }
        .split-box .muted{ font-size: 11px; }

        .services-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
        .service-item{ background: white; border: 1px solid #f0ebe4; border-radius: 8px; padding: 8px 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; transition: all .2s ease; }
        .service-item:hover{ transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .service-name{ font-size: 11px; font-weight: 600; color: #3b3b40; text-align: center; line-height: 1.2; max-height: 2.4em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .service-count{ width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #f8b8d9, #f9d4e1);
          color: #6b3d6a; font-size: 10px; font-weight: 800; display:flex; align-items:center; justify-content:center; }

        .emp-list{ list-style: none; margin: 0; padding: 0; }
        .emp-item{ display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0ebe4; transition: all .2s ease; }
        .emp-item:last-child{ border-bottom: none; }
        .emp-item:hover{ background: rgba(248, 184, 217, 0.05); border-radius: 6px; padding-left: 6px; padding-right: 6px; }
        .emp-name{ display:flex; align-items:center; gap:6px; font-weight:600; font-size: 13px; color: #3b3b40; }
        .emp-avatar{ width:20px; height:20px; border-radius:50%; background: linear-gradient(135deg, #f8b8d9, #f9d4e1); display:flex; align-items:center; justify-content:center;
          font-size:9px; font-weight:900; color:#6b3d6a; }
        .emp-amount{ font-weight: 700; color: #242428; font-size: 13px; min-width: 70px; text-align: right; }

        .expense-form{ display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
        .expense-inputs{ display: flex; gap: 6px; flex-wrap: wrap; }
        .expense-input{ flex: 1; padding: 6px 10px; border: 1px solid #e8e2da; border-radius: 8px; background: white; font-size: 13px; height: 34px; min-width: 80px; }
        .expense-input:focus{ outline: none; border-color: #f8b8d9; box-shadow: 0 0 0 2px rgba(248, 184, 217, 0.1); }
        .expense-btn{ width: 100%; padding: 10px 14px; background: linear-gradient(135deg, #f8b8d9, #f9d4e1); color: #6b3d6a; border: none; border-radius: 10px; font-weight: 600; font-size: 14px; height: 40px; cursor: pointer;
          transition: all .2s ease; box-shadow: 0 2px 6px rgba(248, 184, 217, 0.3); }
        .expense-btn:hover:not(:disabled){ transform: translateY(-1px); box-shadow: 0 4px 12px rgba(248, 184, 217, 0.4); background: linear-gradient(135deg, #f9d4e1, #f8b8d9); }
        .expense-btn:disabled{ opacity: .6; cursor: not-allowed; transform: none; box-shadow: 0 1px 3px rgba(248, 184, 217, 0.2); }

        .expense-total{ background: linear-gradient(135deg, #fff, #f8f9ff); border: 1px solid #e0d9cf; border-radius: 8px; padding: 10px; margin-bottom: 10px; text-align: center; font-size: 13px; }
        .expense-total .label{ color: #999; font-size: 11px; margin-bottom: 2px; }
        .expense-total .value{ font-weight: 700; color: #242428; font-size: 14px; }

        .expense-item{ display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f0ebe4; transition: all .2s ease; }
        .expense-item:last-child{ border-bottom: none; }
        .expense-item:hover{ background: rgba(248, 184, 217, 0.05); border-radius: 6px; padding-left: 6px; padding-right: 6px; }
        .expense-details{ flex: 1; }
        .expense-amount{ font-weight: 700; font-size: 14px; color: #242428; }
        .expense-note{ font-size: 11px; color: #666; margin-top: 2px; }
        .expense-date{ font-size: 11px; color: #999; text-align: right; min-width: 60px; }

        .empty-state{ text-align: center; padding: 20px 12px; color: #999; font-size: 13px; }

        .mobile-only{ display: block; }
        .desktop-only{ display: none; }
        @media(max-width: 760px){
          .desktop-only{ display: none !important; }
          .mobile-only{ display: block; }
        }
/* ===== MOBILE: uniform dugmad + bez plave i native strelica ===== */
@media (max-width: 760px){
  /* Raspored i osnovni stil za kontrole na vrhu */
  .bar{
    gap: 10px !important;
  }
  .bar .inp,
  .bar .btn{
    flex: 1 1 calc(50% - 6px) !important;
    height: 40px !important;
    border-radius: 10px !important;
    -webkit-tap-highlight-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }

  /* Date input kao dugme (Početak/Kraj) */
  .bar .inp[type="date"]{
    appearance: none !important;
    -webkit-appearance: none !important;
    -moz-appearance: none !important;

    background: #fff !important;
    border: 1px solid #e0d9cf !important;
    color: #1f1f1f !important;
    font-weight: 600 !important;
    cursor: pointer !important;

    /* naša kalendar ikonica desno */
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='%238a8378'><path d='M7 2v2H5a2 2 0 0 0-2 2v1h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm14 7H3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9zm-2 4H5v7h14v-7z'/></svg>");
    background-repeat: no-repeat !important;
    background-position: right 10px center !important;
    background-size: 14px !important;

    padding-right: 34px !important;
    padding-left: 12px !important;
  }

  /* Sakrij iOS/Android picker ikonu (plavi indikator) */
  .bar .inp[type="date"]::-webkit-calendar-picker-indicator{
    opacity: 0 !important;
    display: none !important;
    -webkit-appearance: none !important;
    appearance: none !important;
  }

  /* iOS poravnanja vrednosti */
  .bar .inp[type="date"]::-webkit-datetime-edit,
  .bar .inp[type="date"]::-webkit-date-and-time-value{
    text-align: left !important;
  }

  /* Dugmad Danas/Mjesec – bez plavog fokusa */
  .btn-group .btn{
    appearance: none !important;
    -webkit-appearance: none !important;
    outline: none !important;
    box-shadow: none !important;
    margin-top:20px;
    color:#000;
  }
}

/* Tighter layout ispod 600px: btn-group jednaka širina, bez plavog outline-a */
@media (max-width: 600px){
  .btn-group{
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  .btn-group .btn{
    flex: 1 1 0%;
    border-radius: 8px;
    padding: 10px;
    font-weight: 600;
    outline: none !important;
    box-shadow: none !important;
    margin-top:20px;
  }
}

/* Ukloni plavi outline kod klika — bilo gde gore */
.bar .btn-group button:focus,
.fin-top .btn-group button:focus,
.bar .btn:focus,
.bar .inp[type="date"]:focus{
  outline: none !important;
  box-shadow: none !important;
}

/* Globalni override (sigurnosno) — pobedi native stil svakako */
.fin-wrap .bar .inp[type="date"],
.fin-wrap .bar .btn{
  appearance: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
}



        /* ===== DESKTOP – ULEPŠANO ===== */
       @media (min-width: 641px) {
          .fin-wrap{ padding: 32px; overflow: visible; }
          .fin-container{ 
            width:min(1240px, 96vw);
            margin:auto; 
            padding:0; 
            border-radius:28px; 
            background: transparent; 
            border:none; 
            box-shadow:none; 
            backdrop-filter:none; 
            min-height: auto !important;
            height: auto !important;
          }
          .fin-title{ 
            font-size: 28px; 
            font-weight: 900; 
            letter-spacing:.2px;
            color:#2f2f33; 
            text-align:center; 
            margin-bottom:22px; 
            background:transparent; 
            box-shadow:none; 
            padding:0; 
          }

          /* top bar (desktop) */
          .bar{
            position: static; 
            background: #ffffffcc; 
            border: 1px solid #efe9e2; 
            box-shadow: 0 6px 26px rgba(0,0,0,.05); 
            backdrop-filter: blur(10px);
            padding: 10px 12px; 
            margin-bottom: 18px; 
            justify-content: flex-end;
            border-radius: 16px;
          }
          .bar .inp, .bar .btn{ height:42px; font-size:14px; flex:none; }
          .bar .inp{ flex:0 0 178px; padding:10px 12px; border-radius:12px; }
          .btn{ flex:0 0 120px; padding:10px 12px; border-radius:12px; }

          /* KPI ROW (3 kartice iste visine) */
         .kpi-row{
          .card.kpi:hover{ transform: translateY(-2px); box-shadow: 0 22px 44px rgba(0,0,0,.10); }
          .card.kpi h3{
            font-size: 15px;
            font-weight: 800;
            margin: 0 0 2px;
            letter-spacing:.2px;
          }
          .card.kpi .big{
            font-size: 22px;
            font-weight: 900;
            margin-bottom: 2px;
          }
          .card.kpi .muted{
            font-size: 12.5px;
            color:#6a6a73;
          }
          .card.kpi .split-row{
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 6px;
          }
          .card.kpi .split-box{
            padding: 8px;
            border-radius: 12px;
          }
          .card.kpi .split-box .big{
            font-size: 16px;
          }

          /* GRID: 2 kolone za glavni sadržaj */
          .grid{ 
            display:grid; 
            gap:18px; 
            grid-template-columns: repeat(2, 1fr); 
            align-items:start;
            min-height: 0 !important;
            height: auto !important;
          }
          .row-2{ grid-column: span 2; }

          /* Kartice (desktop) */
          .card{
            background: linear-gradient(180deg, #ffffffcc, #fffffff0);
            border:1px solid #efe9e2;
            border-radius:20px; 
            padding:14px 14px 12px;
            backdrop-filter: blur(12px);
            box-shadow: 0 24px 48px rgba(0,0,0,.08);
            overflow:hidden;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .card h3{ margin:0 0 6px; font-size:16px; font-weight:800; color:#2f2f33; letter-spacing:.2px; }

          /* Klikabilne kartice */
          .card.has-action{ cursor:pointer; outline: none; }
          .card.has-action:focus, .card.has-action:focus-visible{
            box-shadow: 0 0 0 3px rgba(248,184,217,.45), 0 24px 48px rgba(0,0,0,.08);
          }

          .big{ font-size:24px; font-weight:900; color:#1f2024; }
          .muted{ color:#6a6a73; }

          .split-row{ 
            display:grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap:12px; 
            margin-top:8px; 
          }
          .split-box{ 
            border:1px dashed #e7e1d9; 
            border-radius:12px; 
            padding:10px; 
            text-align:center; 
            background: #fff;
          }

          /* Scroll područja – lepši container oko tabela */
          .scroll-area{ 
            max-height: 58vh; 
            overflow:auto; 
            border:1px solid #efe9e2; 
            border-radius:14px; 
            background:#ffffff;
          }
          .svc-table{ width:100%; border-collapse:collapse; table-layout: fixed; font-size:14px; color:#2f2f33; }
          .svc-table th, .svc-table td{ padding:10px 12px; border-top:1px solid #f2ede6; vertical-align:top; }
          .svc-table thead th{ 
            position: sticky; top:0; z-index:1; 
            background:linear-gradient(180deg, #faf7f2, #f6f2ec);
            text-align:left; font-weight:800; color:#3f3f45; border-top:none; 
          }
          .svc-table tbody tr:nth-child(odd) td{ background: #faf8f5; }
          .svc-table tr:hover td{ background:#fdf9f5; }
          .svc-table .num{ text-align:right; white-space:nowrap; }
          .svc-table .name{ overflow:hidden; text-overflow:ellipsis; }

          /* Dugmad unutar kartica */
          .card .btn {
            background: linear-gradient(135deg, #f8b8d9, #f9d4e1);
            color: #6b3d6a;
            border: none;
            padding: 10px 16px;
            height: 42px;
            font-weight: 600;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(248,184,217,.25);
            flex-shrink: 0;
          }
          .card .btn:hover {
            background: linear-gradient(135deg, #f9d4e1, #f8b8d9);
            transform: translateY(-1px);
            box-shadow: 0 10px 18px rgba(248,184,217,.35);
          }

          /* Tabela u detail panelu */
          .tbl{ width:100%; border-collapse: collapse; font-size:14px; color:#2f2f33; }
          .tbl th, .tbl td{ padding:10px 12px; border-top:1px solid #eee5db; vertical-align: top; }
          .tbl thead th{ position: sticky; top: 0; background:linear-gradient(180deg,#faf7f2,#f6f2ec); z-index:1; text-align:left; font-weight:800; }
          .tbl tbody tr:nth-child(odd) td{ background:#faf8f5; }
          .tbl tr:hover td{ background:#fdf9f5; }
          .pill{ display:inline-block; padding:4px 10px; border-radius:999px; border:1px solid #e8e2da; background:#fff; font-size:12px; font-weight:700; }

          /* Desktop detail drawer */
          .detail-overlay{
            position: fixed; inset: 0; background: rgba(0,0,0,.10); 
            display: flex; justify-content: flex-end; z-index: 999;
          }
          .detail-panel{
            width: min(760px, 90vw);
            height: 100%;
            background: #ffffffee;
            backdrop-filter: blur(12px);
            border-left: 1px solid #efe9e2;
            box-shadow: -24px 0 48px rgba(0,0,0,.10);
            animation: slideIn .2s ease-out;
            display:flex; flex-direction:column; border-top-left-radius:16px; border-bottom-left-radius:16px;
          }
          @keyframes slideIn { from { transform: translateX(10px); opacity: .6; } to { transform: translateX(0); opacity:1; } }
          .detail-head{
            padding: 14px 16px; display:flex; align-items:center; justify-content:space-between;
            border-bottom:1px solid #efe9e2; background: #fff;
          }
          .detail-title{ font-size:18px; font-weight:800; color:#2f2f33; }
          .detail-close{
            border:none; background:#fff; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:700;
            border:1px solid #eee5db;
          }
          .detail-body{
            padding: 14px 16px; overflow:auto; flex:1;
          }

          .right{ text-align:right; }

          /* Lepši scrollbar */
          .scroll-area::-webkit-scrollbar,
          .detail-body::-webkit-scrollbar{
            width: 10px; height:10px;
          }
          .scroll-area::-webkit-scrollbar-track,
          .detail-body::-webkit-scrollbar-track{
            background: #ffffff00;
          }
          .scroll-area::-webkit-scrollbar-thumb,
          .detail-body::-webkit-scrollbar-thumb{
            background: linear-gradient(180deg, #e9e7ff, #ffe6f5);
            border-radius: 10px; border: 2px solid #ffffffa8;
          }

          .mobile-only{ display:none !important; }
          .desktop-only{ display:block; }
        }

        .right{ text-align:right; }
        .chip{ display:inline-block; padding:6px 12px; border-radius:20px; background:rgba(255,255,255,0.8); border:1px solid #e8e2da; font-weight:700; font-size: 13px; backdrop-filter: blur(6px); }
        @keyframes fadeInUp { from { opacity:0; transform: translateY(10px);} to { opacity:1; transform: translateY(0);} }
        .fade-in { animation: fadeInUp .3s ease forwards; }
        /* ===== Mobile: skini iOS/Android "plavu" i native UI sa date i dugmadi ===== */
@media (max-width: 760px){

  /* Ukloni tap highlight i fokus obrube */
  .bar .btn,
  .bar .inp{
    -webkit-tap-highlight-color: transparent;
    outline: none !important;
    box-shadow: none !important;
  }

  /* Date input: bez native strelice/boje, kao dugme */
  .bar .inp[type="date"]{
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;

    /* izgled kao dugme */
    background: #fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='%238a8378'><path d='M7 2v2H5a2 2 0 0 0-2 2v1h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm14 7H3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9zm-2 4H5v7h14v-7z'/></svg>") no-repeat right 10px center;
    background-size: 14px;

    border: 1px solid #e0d9cf;
    border-radius: 10px;
    height: 38px;
    padding: 6px 34px 6px 12px; /* mesto za ikonicu desno */
    font-weight: 600;
    color: #1f1f1f;
    cursor: pointer;
  }

  /* Ukloni plavi fokus na iOS */
  .bar .inp[type="date"]:focus{
    border-color: #e0d9cf !important;
    box-shadow: none !important;
  }

  /* Poravnaj tekst vrednosti unutra (Safari/iOS) */
  .bar .inp[type="date"]::-webkit-date-and-time-value{
    text-align: left;
  }

  /* Ujednači izgled dugmadi i date inputa – dva para kao "dugmići" */
  .bar{
    gap: 10px;
  }
  .bar .inp, .bar .btn{
    flex: 1 1 calc(50% - 6px); /* po dva u redu na mobilnom */
    height: 38px;
    border-radius: 10px;
  }

  /* Grupica „Danas / Mjesec” – već postoji, samo skidamo plavi fokus */
  .btn-group .btn{
    -webkit-appearance: none;
    appearance: none;
    outline: none !important;
    box-shadow: none !important;
  }
}

/* Globalno (sigurnosno) – ukloni native appearance sa dugmadi i inputa datuma */
.bar .btn,
.bar .inp[type="date"]{
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
}
  /* Globalni override – pobedi native stil i „plavi” fokus */
.fin-wrap .bar input.inp[type="date"],
.fin-wrap .bar .btn{
  appearance: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  outline: none !important;
  box-shadow: none !important;
}
/* Univerzalno: skini iOS/Android plavi akcenat i native appearance */
.fin-wrap .bar .btn,
.fin-wrap .bar .inp[type="date"]{
  appearance: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  -webkit-tap-highlight-color: transparent !important;
  text-decoration: none !important;
  outline: none !important;
  box-shadow: none !important;
  color: #1f1f1f !important;
  -webkit-text-fill-color: #1f1f1f !important;
  accent-color: #1f1f1f !important;  /* android */
  caret-color: #1f1f1f !important;
}

/* Dugmad Danas / Mjesec – bez plavog fokusa/aktivnog stanja */
.fin-wrap .bar .btn:focus,
.fin-wrap .bar .btn:focus-visible,
.fin-wrap .bar .btn:active {
  outline: none !important;
  box-shadow: none !important;
  color: #1f1f1f !important;
  -webkit-text-fill-color: #1f1f1f !important;
}

/* iOS date input unutrašnji delovi */
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit,
.fin-wrap .bar .inp[type="date"]::-webkit-date-and-time-value,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-fields-wrapper,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-text,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-month-field,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-day-field,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-year-field{
  color:#1f1f1f !important;
}

/* Sakrij native picker ikonicu (ostaje naša SVG) */
.fin-wrap .bar .inp[type="date"]::-webkit-calendar-picker-indicator{
  opacity:0 !important; display:none !important;
}

/* Raspored grupa: datumi u jednom redu, kao i dugmad, sa istim razmakom */
.fin-wrap .bar { --bar-gap: 10px; }
.fin-wrap .bar .date-group,
.fin-wrap .bar .btn-group{
  display: flex; gap: var(--bar-gap);
  width: 100%;
}

/* MOBILNI: po 2 u redu, iste širine */
@media (max-width: 760px){
  .fin-wrap .bar .date-group .inp,
  .fin-wrap .bar .btn-group .btn{
    flex: 1 1 calc(50% - var(--bar-gap)/2);
    height: 40px;
    border-radius: 10px;
     color: #1f1f1f;
  }

  /* izgled date polja kao dugmeta + naša ikona */
  .fin-wrap .bar .date-group .inp[type="date"]{
    background: #fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='%238a8378'><path d='M7 2v2H5a2 2 0 0 0-2 2v1h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm14 7H3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9zm-2 4H5v7h14v-7z'/></svg>") no-repeat right 10px center !important;
    background-size: 14px !important;
    padding-right: 34px !important;
    font-weight: 600;
    border: 1px solid #e0d9cf;
    color: #1f1f1f;
  }
}

/* DESKTOP: datumi u grupi, normalne širine */
@media (min-width: 761px){
  .fin-wrap .bar .date-group .inp{ flex: 0 0 178px; }
  .fin-wrap .bar .btn-group .btn{ flex: 0 0 120px; }
}
/* --- 2.1. Tvrdo fiksiraj boju teksta za Danas/Mjesec dugmad --- */
.fin-wrap .bar .btn,
.fin-wrap .bar .btn:link,
.fin-wrap .bar .btn:visited {
  color: #1f1f1f !important;
  -webkit-text-fill-color: #1f1f1f !important;
  text-decoration: none !important;
}

/* --- 2.2. Tvrdo fiksiraj boju vrednosti u date inputima --- */
.fin-wrap .bar .inp[type="date"],
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit,
.fin-wrap .bar .inp[type="date"]::-webkit-date-and-time-value,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-fields-wrapper,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-text,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-month-field,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-day-field,
.fin-wrap .bar .inp[type="date"]::-webkit-datetime-edit-year-field {
  color: #1f1f1f !important;
  -webkit-text-fill-color: #1f1f1f !important;
  caret-color: #1f1f1f !important;
}

/* --- 2.3. iOS-specifičan “šrafciger” (uzima prednost na Safari-ju) --- */
@supports (-webkit-touch-callout: none) {
  .fin-wrap .bar .btn,
  .fin-wrap .bar .btn * {
    color: #1f1f1f !important;
    -webkit-text-fill-color: #1f1f1f !important;
  }
  .fin-wrap .bar .inp[type="date"],
  .fin-wrap .bar .inp[type="date"] * {
    color: #1f1f1f !important;
    -webkit-text-fill-color: #1f1f1f !important;
  }
}
/* === FIX: vrati native date picker na AdminFinance === */
.fin-wrap .bar input.inp[type="date"]{
  appearance: auto !important;
  -webkit-appearance: auto !important;
  -moz-appearance: auto !important;
  cursor: text !important;   /* da se ponaša kao input, ne kao "dugme" */
  background-image: none !important; /* skloni našu custom ikonicu ako smeta */
}
.fin-wrap .bar input.inp[type="date"]::-webkit-calendar-picker-indicator{
  display: block !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
  


      `}</style>

      <div className="fin-container">
      <div className="fin-header">
  <button className="back-btn" onClick={()=>nav(-1)} aria-label="Nazad">
    <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
    Nazad
  </button>
  <div className="fin-title">Finansijski pregled</div>
</div>




        {/* Kontrole opsega - MOBILNI (NE DIRAJ) */}
      <div className="bar mobile-only">
  <div className="date-group">
    <label className="date-field">
      
      <Flatpickr
        className="inp"
        options={{ dateFormat: "Y-m-d", locale: Serbian, allowInput: true }}
        value={from}
        onChange={(dates)=> dates[0] && setFrom(startOfDay(dates[0]))}
        disabled={!canPickRange}
      />
    </label>

    <label className="date-field">
      
      <Flatpickr
        className="inp"
        options={{ dateFormat: "Y-m-d", locale: Serbian, allowInput: true }}
        value={to}
        onChange={(dates)=> dates[0] && setTo(endOfDay(dates[0]))}
        disabled={!canPickRange}
      />
    </label>
  </div>



  {canPickRange && (
    <div className="btn-group">
      <button className="btn" onClick={()=>{ setFrom(startOfDay(new Date())); setTo(endOfDay(new Date())); }}>
        Danas
      </button>
      <button className="btn" onClick={()=>{ const n=new Date(); const s=new Date(n.getFullYear(), n.getMonth(), 1); const e=endOfDay(new Date(n.getFullYear(), n.getMonth()+1, 0)); setFrom(s); setTo(e); }}>
        Mesec
      </button>
    </div>
  )}

  {!canPickRange && <span className="chip">Dnevni pazar</span>}
</div>


        {/* Kontrole opsega - DESKTOP */}
    <div className="bar desktop-only">
  <div className="date-group">
    <label className="date-field">
      
      <Flatpickr
        className="inp"
        options={{ dateFormat: "Y-m-d", locale: Serbian, allowInput: true }}
        value={from}
        onChange={(dates)=> dates[0] && setFrom(startOfDay(dates[0]))}
        disabled={!canPickRange}
      />
    </label>

    <label className="date-field">
      
      <Flatpickr
        className="inp"
        options={{ dateFormat: "Y-m-d", locale: Serbian, allowInput: true }}
        value={to}
        onChange={(dates)=> dates[0] && setTo(endOfDay(dates[0]))}
        disabled={!canPickRange}
      />
    </label>
  </div>


  {canPickRange && (
    <>
      <button className="btn" onClick={()=>{ setFrom(startOfDay(new Date())); setTo(endOfDay(new Date())); }}>
        Danas
      </button>
      <button className="btn" onClick={()=>{
        const n=new Date();
        const s=new Date(n.getFullYear(), n.getMonth(), 1);
        const e=endOfDay(new Date(n.getFullYear(), n.getMonth()+1, 0));
        setFrom(s); setTo(e);
      }}>
        Ovaj mesec
      </button>
    </>
  )}
  {!canPickRange && <span className="chip">Dnevni pazar</span>}
</div>

        {/* MOBILNI – BEZ IZMJENA */}
        <div className="mobile-only">
          {canSeeSplit && (
            <div className="mobile-card">
              <h3>Pregled naplate</h3>
              <div className="big">{fmtMoney(splitTotals.total)} RSD</div>
              <div className="muted">Ukupno plaćeno u periodu</div>
              <div className="split-row">
                <div className="split-box">
                  <div className="muted">Keš</div>
                  <div className="big">{fmtMoney(splitTotals.cash)} RSD</div>
                </div>
                <div className="split-box">
                  <div className="muted">Kartica</div>
                  <div className="big">{fmtMoney(splitTotals.card)} RSD</div>
                </div>
                <div className="split-box">
                  <div className="muted">Banka</div>
                  <div className="big">{fmtMoney(splitTotals.bank)} RSD</div>
                </div>
              </div>
            </div>
          )}

          {canSeeWorkerOnly && (
            <div className="mobile-card">
              <h3>Moj prihod</h3>
              <div className="big">{fmtMoney(workerOwn.total)} RSD</div>
              <div className="muted">Broj termina: {workerOwn.count}</div>
            </div>
          )}

          {role==="admin" && (
            <div className="mobile-card">
              <h3>Neto dobitak</h3>
              <div className="big">{fmtMoney(splitTotals.total - expensesTotal)} RSD</div>
              <div className="muted">
                Bruto {fmtMoney(splitTotals.total)} RSD - Troškovi {fmtMoney(expensesTotal)} RSD
              </div>
            </div>
          )}

          {canSeeServices && (
            <div className="accordion">
              <div 
                className={`acc-header ${openServices ? 'open' : ''}`} 
                onClick={()=>setOpenServices(s=>!s)}
              >
                <div className="acc-title">Usluge ({serviceCounter.length})</div>
                <div className="acc-indicator">▼</div>
              </div>
              <div className={`acc-content ${openServices ? 'open' : ''}`}>
                {serviceCounter.length ? (
                  <div className="services-grid">
                    {serviceCounter.map((r)=>(
                      <div className="service-item fade-in" key={r.id} title={r.name}>
                        <div className="service-name">{r.name}</div>
                        <div className="service-count">{r.cnt}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nema izvršenih usluga</div>
                )}
              </div>
            </div>
          )}

          {canSeeEmployees && (
            <div className="accordion">
              <div 
                className={`acc-header ${openEmployees ? 'open' : ''}`} 
                onClick={()=>setOpenEmployees(s=>!s)}
              >
                <div className="acc-title">Zarada po radnici ({earningsByEmployee.length})</div>
                <div className="acc-indicator">▼</div>
              </div>
              <div className={`acc-content ${openEmployees ? 'open' : ''}`}>
                {earningsByEmployee.length ? (
                  <ul className="emp-list">
                    {earningsByEmployee.map((r)=>{
                      const initials = r.name?.split(" ").filter(Boolean).map(x=>x[0]?.toUpperCase()).slice(0,2).join("") || "R";
                      return (
                        <li className="emp-item fade-in" key={r.username}>
                          <div className="emp-name">
                            <div className="emp-avatar">{initials}</div>
                            <span>{r.name}</span>
                          </div>
                          <div className="emp-amount">{fmtMoney(r.total)} RSD</div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="empty-state">Nema podataka o zaradama</div>
                )}
              </div>
            </div>
          )}

          {canSeeExpenses && (
            <div className="accordion">
              <div 
                className={`acc-header ${openExpenses ? 'open' : ''}`} 
                onClick={()=>setOpenExpenses(s=>!s)}
              >
                <div className="acc-title">Troškovi ({expenses.filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; }).length})</div>
                <div className="acc-indicator">▼</div>
              </div>
              <div className={`acc-content ${openExpenses ? 'open' : ''}`}>
                <div className="expense-form">
                  <div className="expense-inputs">
                    <input
                      type="number" 
                      className="expense-input"
                      placeholder="Iznos RSD" 
                      value={expAmt}
                      onChange={e=>setExpAmt(e.target.value)} 
                    />
                    <input
                      type="text" 
                      className="expense-input"
                      placeholder="Napomena" 
                      value={expNote}
                      onChange={e=>setExpNote(e.target.value)} 
                    />
                  </div>
                  <button className="expense-btn" onClick={addExpense} disabled={!expAmt}>
                    ➕ Dodaj trošak
                  </button>
                </div>

                <div className="expense-total">
                  <div className="label">Ukupno troškovi</div>
                  <div className="value">{fmtMoney(expensesTotal)} RSD</div>
                </div>

                {expenses.filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; }).length ? (
                  <div className="expense-list">
                    {expenses
                      .filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; })
                      .sort((a,b)=> toJsDate(b.date)-toJsDate(a.date))
                      .map((x)=>(
                      <div className="expense-item fade-in" key={x.id}>
                        <div className="expense-details">
                          <div className="expense-amount">{fmtMoney(x.amountRsd)} RSD</div>
                          <div className="expense-note">{x.note || "Bez napomene"}</div>
                        </div>
                        <div className="expense-date">{toJsDate(x.date).toLocaleDateString("sr-RS")}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nema troškova u ovom periodu</div>
                )}
              </div>
            </div>
          )}

          <div style={{height: "20px"}}></div>
        </div>

        {/* DESKTOP KPI RED */}
        <div className="kpi-row desktop-only">
          {canSeeSplit && (
            <div
              className="card kpi has-action"
              onClick={()=>openDetail("split","Pregled naplate")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("split","Pregled naplate"); }}}
              role="button" tabIndex={0}
              aria-label="Pregled naplate - detalji"
            >
              <h3>Pregled naplate</h3>
              <div className="big">{fmtMoney(splitTotals.total)} RSD</div>
              <div className="muted">Ukupno u periodu</div>
              <div className="split-row">
                <div className="split-box">
                  <div className="muted">Keš</div>
                  <div className="big">{fmtMoney(splitTotals.cash)} RSD</div>
                </div>
                <div className="split-box">
                  <div className="muted">Kartica</div>
                  <div className="big">{fmtMoney(splitTotals.card)} RSD</div>
                </div>
                <div className="split-box">
                  <div className="muted">Račun</div>
                  <div className="big">{fmtMoney(splitTotals.bank)} RSD</div>
                </div>
              </div>
            </div>
          )}

          {role==="admin" && (
            <div
              className="card kpi has-action"
              onClick={()=>openDetail("net","Neto (posle troškova)")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("net","Neto (posle troškova)"); }}}
              role="button" tabIndex={0}
              aria-label="Neto posle troškova - detalji"
            >
              <h3>Neto (posle troškova)</h3>
              <div className="big">{fmtMoney(splitTotals.total - expensesTotal)} RSD</div>
              <div className="muted">Bruto {fmtMoney(splitTotals.total)} – Troškovi {fmtMoney(expensesTotal)}</div>
            </div>
          )}

          {canSeeExpenses && (
            <div
              className="card kpi has-action"
              onClick={()=>openDetail("expenses","Troškovi")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("expenses","Troškovi"); }}}
              role="button" tabIndex={0}
              aria-label="Troškovi - detalji"
            >
              <h3>Troškovi</h3>
              <div className="bar" style={{marginBottom:6, background:"#ffffffdd", padding:8, borderRadius:12}}>
                <input
                  type="number" placeholder="Iznos (RSD)" value={expAmt}
                  onChange={e=>setExpAmt(e.target.value)} className="inp" style={{flex:"1 1 120px"}}
                  onClick={e=>e.stopPropagation()}
                />
                <input
                  type="text" placeholder="Napomena" value={expNote}
                  onChange={e=>setExpNote(e.target.value)} className="inp" style={{flex:"2 1 180px"}}
                  onClick={e=>e.stopPropagation()}
                />
                <button className="btn" onClick={(e)=>{ e.stopPropagation(); addExpense(); }}>Dodaj</button>
              </div>
              <div className="muted">Ukupno: <b>{fmtMoney(expensesTotal)} RSD</b></div>
            </div>
          )}
        </div>

        {/* DESKTOP GRID (2 kolone) */}
        <div className="grid desktop-only">
          {canSeeWorkerOnly && (
            <div
              className="card has-action"
              onClick={()=>openDetail("worker","Moj prihod")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("worker","Moj prihod"); }}}
              role="button" tabIndex={0}
              aria-label="Moj prihod - detalji"
            >
              <h3>Moj prihod</h3>
              <div className="big">{fmtMoney(workerOwn.total)} RSD</div>
              <div className="muted">Broj plaćenih termina: {workerOwn.count}</div>
            </div>
          )}

          {canSeeServices && (
            <div
              className={`card ${role!=="admin" ? "row-2" : ""} has-action`}
              onClick={()=>openDetail("services","Usluge (broj izvršenja)")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("services","Usluge (broj izvršenja)"); }}}
              role="button" tabIndex={0}
              aria-label="Usluge - detalji"
            >
              <h3>Usluge (broj izvršenja)</h3>
              {serviceCounter.length ? (
                <div className="scroll-area">
                  <table className="svc-table">
                    <colgroup>
                      <col />
                      <col style={{ width: "96px" }} />
                    </colgroup>
                    <thead>
                      <tr><th>Usluga</th><th className="num">Broj</th></tr>
                    </thead>
                    <tbody>
                      {serviceCounter.map(r=>(
                        <tr key={r.id}>
                          <td className="name" title={r.name}>{r.name}</td>
                          <td className="num">{r.cnt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="muted">Nema podataka u odabranom periodu.</div>}
            </div>
          )}

          {canSeeEmployees && (
            <div
              className="card row-2 has-action"
              onClick={()=>openDetail("employees","Zarada po radnici")}
              onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDetail("employees","Zarada po radnici"); }}}
              role="button" tabIndex={0}
              aria-label="Zarada po radnici - detalji"
            >
              <h3>Zarada po radnici</h3>
              {earningsByEmployee.length ? (
                <div className="scroll-area">
                  <table className="svc-table">
                    <colgroup><col /><col style={{width:"140px"}}/></colgroup>
                    <thead>
                      <tr><th>Radnica</th><th className="num">Iznos (RSD)</th></tr>
                    </thead>
                    <tbody>
                      {earningsByEmployee.map(r=>(
                        <tr key={r.username}>
                          <td className="name">{r.name}</td>
                          <td className="num">{fmtMoney(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="muted">Nema podataka.</div>}
            </div>
          )}
        </div>

        {/* DESKTOP: Detaljni panel */}
        {detailKey && (
          <div className="detail-overlay desktop-only" onClick={closeDetail}>
            <div className="detail-panel" onClick={(e)=>e.stopPropagation()}>
              <div className="detail-head">
                <div className="detail-title">{detailTitle}</div>
                <button className="detail-close" onClick={closeDetail}>Zatvori</button>
              </div>
              <div className="detail-body">
                {/* Sadržaj po tipu kartice */}
                {detailKey==="split" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Ukupno: <b>{fmtMoney(splitTotals.total)} RSD</b> &nbsp;•&nbsp; 
                      Keš: <span className="pill">{fmtMoney(splitTotals.cash)} RSD</span> &nbsp; 
                      Kartica: <span className="pill">{fmtMoney(splitTotals.card)} RSD</span> &nbsp; 
                      Račun: <span className="pill">{fmtMoney(splitTotals.bank)} RSD</span>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Klijent</th>
                          <th>Usluge</th>
                          <th>Radnica</th>
                          <th className="right">Iznos</th>
                          <th>Metod</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paidInRange
                          .sort((a,b)=>toJsDate(b.start)-toJsDate(a.start))
                          .map(a=>(
                          <tr key={a.id}>
                            <td>{toJsDate(a.start).toLocaleString("sr-RS")}</td>
                            <td>{a.clientName || "—"}</td>
                            <td>{formatServices(a.services)}</td>
                            <td>{formatEmpName(a.employeeUsername || a.employeeId)}</td>
                            <td className="right">{fmtMoney(apptValue(a))} RSD</td>
                            <td><span className="pill">{a.paid}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {detailKey==="worker" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Moj prihod: <b>{fmtMoney(workerOwn.total)} RSD</b> • Termina: <b>{workerOwn.count}</b>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Klijent</th>
                          <th>Usluge</th>
                          <th className="right">Iznos</th>
                          <th>Metod</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paidInRange
                          .filter(a=>(a.employeeUsername||a.employeeId)===currentUsername)
                          .sort((a,b)=>toJsDate(b.start)-toJsDate(a.start))
                          .map(a=>(
                          <tr key={a.id}>
                            <td>{toJsDate(a.start).toLocaleString("sr-RS")}</td>
                            <td>{a.clientName || "—"}</td>
                            <td>{formatServices(a.services)}</td>
                            <td className="right">{fmtMoney(apptValue(a))} RSD</td>
                            <td><span className="pill">{a.paid}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {detailKey==="net" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Bruto: <b>{fmtMoney(splitTotals.total)} RSD</b> • Troškovi: <b>{fmtMoney(expensesTotal)} RSD</b> • Neto: <b>{fmtMoney(splitTotals.total - expensesTotal)} RSD</b>
                    </div>
                    <h4 style={{margin:"6px 0 10px"}}>Troškovi u periodu</h4>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Napomena</th>
                          <th className="right">Iznos (RSD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses
                          .filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; })
                          .sort((a,b)=>toJsDate(b.date)-toJsDate(a.date))
                          .map(x=>(
                          <tr key={x.id}>
                            <td>{toJsDate(x.date).toLocaleDateString("sr-RS")}</td>
                            <td>{x.note || "Bez napomene"}</td>
                            <td className="right">{fmtMoney(x.amountRsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {detailKey==="services" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Ukupno različitih usluga: <b>{serviceCounter.length}</b>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Usluga</th>
                          <th className="right">Broj izvršenja</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceCounter.map(r=>(
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td className="right">{r.cnt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {detailKey==="employees" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Broj radnica: <b>{earningsByEmployee.length}</b>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Radnica</th>
                          <th className="right">Zarada (RSD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {earningsByEmployee.map(r=>(
                          <tr key={r.username}>
                            <td>{r.name}</td>
                            <td className="right">{fmtMoney(r.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {detailKey==="expenses" && (
                  <>
                    <div className="muted" style={{marginBottom:10}}>
                      Ukupno troškovi: <b>{fmtMoney(expensesTotal)} RSD</b>
                    </div>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Napomena</th>
                          <th className="right">Iznos (RSD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses
                          .filter(x=>{ const d=toJsDate(x.date); return d>=from && d<=to; })
                          .sort((a,b)=>toJsDate(b.date)-toJsDate(a.date))
                          .map(x=>(
                          <tr key={x.id}>
                            <td>{toJsDate(x.date).toLocaleDateString("sr-RS")}</td>
                            <td>{x.note || "Bez napomene"}</td>
                            <td className="right">{fmtMoney(x.amountRsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
