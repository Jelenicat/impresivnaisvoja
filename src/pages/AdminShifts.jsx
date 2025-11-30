// src/pages/AdminShifts.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  collection, query, orderBy, onSnapshot,
  addDoc, serverTimestamp,
  where, getDocs, limit,
  doc, updateDoc
} from "firebase/firestore";
import { db } from "../firebase";

/* ====== Podešavanja šablona ====== */
const PATTERNS = [
  { key: "1w", label: "1 nedelja", weeks: 1 },
  { key: "2w", label: "2 nedelje", weeks: 2 },
  { key: "3w", label: "3 nedelje", weeks: 3 },
  { key: "4w", label: "4 nedelje", weeks: 4 },
];
const DAYS = ["Ponedeljak","Utorak","Sreda","Četvrtak","Petak","Subota","Nedelja"];
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// helper: JS 0=nedelja...6=subota → mi 0=pon...6=ned
const weekdayIndexFromDate = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  return (d.getDay() + 6) % 7;
};

/* ====== Jedan dan ====== */
function DayRow({ value, onChange, label }) {
  const closed = !!value.closed;
  return (
    <div className="day-row">
      <div className="day-label">{label}</div>

      {/* POČETAK – KRAJ */}
      <div className="time-grid">
        <input
          className="time time--from"
          type="time"
          step="300"
          value={value.from || ""}
          onChange={(e)=>onChange({ ...value, from: e.target.value })}
        />
        <span className="dash">–</span>
        <input
          className="time time--to"
          type="time"
          step="300"
          value={value.to || ""}
          onChange={(e)=>onChange({ ...value, to: e.target.value })}
        />
      </div>

      {/* ZATVORENO */}
      <label className="day-closed">
        <input
          type="checkbox"
          checked={closed}
          onChange={(e)=>onChange({ ...value, closed: e.target.checked })}
        />
        Zatvoreno
      </label>
    </div>
  );
}


/* ====== Jedna nedelja ====== */
function WeekCard({ index, value, onChange, onCopyFrom }) {
  return (
    <div className="week-card">
      <div className="week-head">
        <div className="title">Nedelja {index+1}</div>
        {index>0 && (
          <button className="pill" onClick={()=>onCopyFrom(index-1)}>
            Kopiraj iz nedelje {index}
          </button>
        )}
      </div>
      <div className="week-body">
        {DAYS.map((d, i) => (
          <DayRow
            key={i}
            label={d}
            value={value[i]}
            onChange={(next)=> {
              const arr = value.slice();
              arr[i] = next;
              onChange(arr);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ====== Glavna stranica ====== */
export default function AdminShifts() {
  const [employees, setEmployees] = useState([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [pattern, setPattern] = useState(PATTERNS[0]);

  const [startDate, setStartDate] = useState("");
  const [endMode, setEndMode] = useState("never"); // never | until
  const [endDate, setEndDate] = useState("");

  // weeks: Array(weeks).each -> Array(7) of {from,to,closed}
  const makeDay = () => ({ from: "09:00", to: "17:00", closed: false });
  const makeWeek = () => Array(7).fill(0).map(makeDay);
  const [weeks, setWeeks] = useState([makeWeek()]);

  const loadingFromDbRef = useRef(false);

  // ==== DODATO: izuzetak za jedan dan (state)
  const [oneDayDate, setOneDayDate] = useState("");   // YYYY-MM-DD
  const [oneDayFrom, setOneDayFrom] = useState("");   // HH:mm
  const [oneDayTo, setOneDayTo] = useState("");       // HH:mm

  // ==== DODATO: BLOKADA VIŠE DANA (state)
  const [blkStartDate, setBlkStartDate] = useState(""); // YYYY-MM-DD
  const [blkEndDate, setBlkEndDate]     = useState(""); // YYYY-MM-DD
  const [blkFrom, setBlkFrom]           = useState(""); // HH:mm
  const [blkTo, setBlkTo]               = useState(""); // HH:mm
  const [blkNote, setBlkNote]           = useState("");
  // 0=pon..6=ned
  const [blkWeekdays, setBlkWeekdays]   = useState([true,true,true,true,true,true,true]);

  // učitaj zaposlene
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,"employees"), orderBy("username")),
      s => setEmployees(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return () => unsub();
  }, []);

  // promena šablona → prilagodi broj nedelja (osim dok učitavamo iz baze)
  useEffect(() => {
    if (loadingFromDbRef.current) return;
    const n = pattern.weeks;
    setWeeks(prev => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(makeWeek());
      return next;
    });
  }, [pattern]);

  // validacija
  const canSave = useMemo(() => {
    if (!selectedUser || !startDate) return false;
    if (endMode === "until" && !endDate) return false;
    for (const w of weeks) {
      for (const d of w) {
        if (!d.closed) {
          if (!isTime(d.from) || !isTime(d.to)) return false;
          if ((d.from || "") >= (d.to || "")) return false;
        }
      }
    }
    return true;
  }, [selectedUser, startDate, endMode, endDate, weeks]);

  // normalizuj weeks iz objekta ili niza
  function normalizeWeeks(raw, desiredCount) {
    let arr;
    if (Array.isArray(raw)) arr = raw;
    else if (raw && typeof raw === "object") {
      arr = Object.keys(raw).sort((a,b)=>Number(a)-Number(b)).map(k => raw[k]);
    } else arr = [];

    arr = arr.slice(0, desiredCount);
    while (arr.length < desiredCount) arr.push(makeWeek());

    arr = arr.map(week => {
      const w = Array.isArray(week) ? week.slice(0,7) : [];
      while (w.length < 7) w.push(makeDay());
      return w.map(d => ({
        from: d?.from ?? "09:00",
        to: d?.to ?? "17:00",
        closed: !!d?.closed
      }));
    });
    return arr;
  }

  // izabran korisnik → učitaj POSLEDNJU smenu
  useEffect(() => {
    if (!selectedUser) return;
    (async () => {
      try {
        loadingFromDbRef.current = true;
        const qy = query(
          collection(db, "schedules"),
          where("employeeUsername", "==", selectedUser),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const snap = await getDocs(qy);

        if (snap.empty) {
          setPattern(PATTERNS[0]);
          setStartDate("");
          setEndMode("never");
          setEndDate("");
          setWeeks([makeWeek()]);
          return;
        }

        const data = snap.docs[0].data();
        const foundPattern = PATTERNS.find(p => p.key === data.pattern) || PATTERNS[0];
        setPattern(foundPattern);

        setStartDate(data.startDate || "");
        if (data.endDate) { setEndMode("until"); setEndDate(data.endDate || ""); }
        else { setEndMode("never"); setEndDate(""); }

        setWeeks(normalizeWeeks(data.weeks, foundPattern.weeks));
      } catch (e) {
        console.error("Greška pri učitavanju smene:", e);
      } finally {
        setTimeout(() => { loadingFromDbRef.current = false; }, 0);
      }
    })();
  }, [selectedUser]);

  // snimi
  async function saveSchedule() {
    if (!canSave) return;
    const weeksObj = Object.fromEntries(
      weeks.map((weekArr, i) => [
        String(i),
        weekArr.map(d => ({ from: d.from, to: d.to, closed: !!d.closed }))
      ])
    );

    const payload = {
      employeeUsername: selectedUser,
      pattern: pattern.key,
      startDate,
      endDate: endMode === "never" ? null : (endDate || null),
      weeks: weeksObj,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await addDoc(collection(db, "schedules"), payload);
      alert("Smena je sačuvana.");
    } catch (e) {
      console.error(e);
      alert("Greška pri čuvanju smene.");
    }
  }

  function copyWeek(target, from) {
    setWeeks(prev => {
      const next = prev.slice();
      next[target] = JSON.parse(JSON.stringify(prev[from]));
      return next;
    });
  }

  // ==== DODATO: snimi izuzetak za tačno jedan dan (update postojeceg dokumenta, ne kreira novi)
  async function saveOneDayOverride() {
    if (!selectedUser) return alert("Izaberi radnicu.");
    if (!oneDayDate) return alert("Izaberi dan.");
    if (!isTime(oneDayFrom) || !isTime(oneDayTo) || oneDayFrom >= oneDayTo) {
      return alert("Unesi ispravno vreme (od < do).");
    }

    try {
      // Nađi POSLEDNJI (bazni) raspored te radnice
      const qy = query(
        collection(db, "schedules"),
        where("employeeUsername", "==", selectedUser),
        orderBy("createdAt", "desc"),
        limit(1)
      );
      const snap = await getDocs(qy);
      if (snap.empty) {
        return alert("Nema baznog rasporeda za ovu radnicu. Sačuvaj prvo raspored.");
      }
      const baseDoc = snap.docs[0];
      const docRef = doc(db, "schedules", baseDoc.id);

      // Updejt: upiši overrides.<YYYY-MM-DD> = { from, to, closed:false } – ne dira ništa drugo
      await updateDoc(docRef, {
        [`overrides.${oneDayDate}`]: { from: oneDayFrom, to: oneDayTo, closed: false },
        updatedAt: serverTimestamp(),
      });

      alert("Postavljena smena za izabrani dan (izuzetak). Ostali dani ostaju isti.");
      setOneDayDate("");
      setOneDayFrom("");
      setOneDayTo("");
    } catch (e) {
      console.error(e);
      alert("Greška pri čuvanju izuzetka za dan.");
    }
  }

  /* ====== HELPERI ZA BLOKADU VIŠE DANA ====== */
  function ymdToDate(ymd){ return ymd ? new Date(`${ymd}T00:00:00`) : null; }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function weekdayIdx(d){ return (d.getDay()+6)%7; } // 0=pon..6=ned
  function makeDateWithTime(d, hhmm){
    const [h,m] = (hhmm||"").split(":").map(Number);
    const x = new Date(d);
    x.setHours(h||0, m||0, 0, 0);
    return x;
  }

  // ==== KREIRANJE BLOKADA VIŠE DANA (appointments, type:"block")
  async function createMultiDayBlocks() {
    if (!selectedUser) return alert("Izaberi radnicu.");
    if (!blkStartDate || !blkEndDate) return alert("Unesi datum od–do.");
    if (!isTime(blkFrom) || !isTime(blkTo) || blkFrom >= blkTo) {
      return alert("Unesi ispravno vreme (od < do).");
    }

    const fromD = ymdToDate(blkStartDate);
    const toD   = ymdToDate(blkEndDate);
    if (!fromD || !toD || toD < fromD) return alert("Datum DO mora biti posle OD.");

    // lista dana filtrirana po izabranim danima u nedelji
    const days = [];
  for (let d = new Date(fromD); d <= toD; d = addDays(d,1)) {
  days.push(new Date(d)); // svaki dan u opsegu, bez filtriranja po nedelji
}

    if (days.length === 0) return alert("Nema dana za blokiranje (proveri izbor dana u nedelji).");

    if (!window.confirm(`Kreirati ${days.length} blokada za ${selectedUser}?`)) return;

    try {
      for (const d of days) {
        const start = makeDateWithTime(d, blkFrom);
        const end   = makeDateWithTime(d, blkTo);

        const payload = {
          type: "block",
          employeeUsername: selectedUser,
          start,
          end,
          note: blkNote || "",
          source: "manual",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await addDoc(collection(db, "appointments"), payload);
      }
      alert(`Gotovo. Kreirano: ${days.length} blokada.`);
      // (po želji reset polja)
      // setBlkNote("");
    } catch (e) {
      console.error(e);
      alert("Greška pri upisu blokada.");
    }
  }

  return (
    <div className="shifts-page">
      <style>{`
        *,*::before,*::after{ box-sizing:border-box; }
        html,body,#root{ min-height:100%; height:auto; }
        html,body{ overflow-x:hidden; }

        .shifts-page{
          padding:12px 8px;
          background:linear-gradient(180deg,#f7f4ef 0,#f0ebe4 100%);
          min-height:100vh;
          padding-bottom:80px;
          overflow-x:hidden;
          overflow-y:auto;
        }
        h1{
          font-family:"Playfair Display",serif;
          margin:12px 0 20px;
          font-size:24px;
          text-align:center;
          color:#2c261f;
          line-height:1.2;
        }

        .grid{ display:grid; gap:20px; grid-template-columns:1fr; min-width:0; }

        .card{
          background:rgba(255,255,255,0.95);
          border-radius:20px;
          box-shadow:0 8px 24px rgba(0,0,0,.06);
          padding:16px;
          border:1px solid #efe9df;
          width:100%;
          overflow:visible;
        }
        .card h3{
          margin:0 0 16px;
          font-size:16px;
          font-weight:700;
          color:#2c261f;
          padding-bottom:8px;
          border-bottom:1px solid #f0ebe4;
        }

        .config-card{ position:static; overflow:visible; }

        .field{ margin-bottom:16px; min-width:0; }
        .label{ display:block; font-size:13px; color:#5a544b; margin-bottom:8px; font-weight:600; }
        .input,.select{
          width:100%; padding:12px 14px; border-radius:14px; border:1px solid #e6e0d7; background:#fff; font-size:15px;
        }
        .input:focus,.select:focus{ outline:none; border-color:#1f1f1f; box-shadow:0 0 0 3px rgba(31,31,31,.05); }
        .input.tall,.select.tall{ height:46px; }

        .seg{ display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
        .seg.small .seg-btn{ padding:8px 10px; font-size:12px; }
        .seg-btn{
          padding:10px 12px; border-radius:12px; border:1px solid #ddd6cc; background:#fff; cursor:pointer;
          font-weight:600; font-size:13px; transition:all .2s; min-width:92px; text-align:center; color:#1f1f1f;
        }
        .seg-btn.is-active {
          background: #faf8f5;
          color: #1f1f1f;
          border-color: #ccc;
          box-shadow: 0 0 0 2px rgba(0,0,0,.05) inset, 0 4px 12px rgba(0,0,0,.05);
        }

        .seg-btn:hover{ background:#faf8f5; }

        .hint{
          margin:12px 0; font-size:11px; color:#8a8378; line-height:1.4; padding:10px;
          background:#f8f6f2; border-radius:10px; border-left:3px solid #e6e0d7;
        }
        .actions{ display:flex; gap:10px; flex-direction:column; margin-top:16px;COLOR: #fff}
        .btn{  border-color:#fff;  border:1px solid #875e24ff;border:0;  color:#000; padding:14px 16px; border-radius:12px; cursor:pointer; font-weight:700; font-size:15px; width:100%; }
        .btn:hover:not(:disabled){ background:#333; }
        .btn:disabled{ opacity:.6; cursor:not-allowed; }
        .btn-ghost{ background:#fff; color:#1f1f1f; border:1px solid #ddd6cc; width:100%; border-radius:12px; padding:14px 16px; cursor:pointer; font-weight:500; font-size:13px; }
        .btn-ghost:hover{ background:#f8f6f2; }

        input[type="time"]{ -webkit-appearance:none; appearance:none; min-width:0; }
        input[type="time"]::-webkit-calendar-picker-indicator{ padding:0; margin:0; }

        .weeks{
          display:flex; flex-direction:column; gap:16px;
          max-width:100%;
          overflow:visible;
          margin-bottom:8px;
        }
        .week-card{
          background:#fff; border:1px solid #eee; border-radius:16px;
          overflow:visible;
          box-shadow:0 2px 8px rgba(0,0,0,.04);
          max-width:100%;
        }
        .week-head{
          display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;
          padding:16px; background:#faf8f5; text-align:center;
        }
        .week-head .title{ font-weight:700; font-size:16px; color:#2c261f; width:100%; }
        .week-body{ padding:12px; display:grid; gap:12px; }

        /* === DayRow default (MOBILE-First) === */
        .day-row{
          display:flex; flex-direction:column; gap:6px;
          padding:8px 0;
          border-bottom:1px solid #f5f3ef;
        }
        .day-row:last-child{ border-bottom:none; }

        .day-label{ font-weight:600; font-size:14px; color:#2c261f; }
        .time-grid{
          display:grid;
          grid-template-columns: 1fr 18px 1fr; /* from | – | to */
          gap:6px;
          align-items:center;
        }
        .time{
          width:100%;
          padding:10px 8px;
          border:1px solid #e6e0d7;
          border-radius:10px;
          font-size:14px;
          background:#fff;
          height:42px;
        }
        .time:disabled{ background:#f8f6f2; opacity:.7; }
        .dash{ color:#8a8378; font-size:14px; font-weight:300; text-align:center; }
        .day-closed{ display:flex; align-items:center; gap:8px; color:#6f6b63; font-size:13px; }
        .day-closed input[type="checkbox"]{ width:16px; height:16px; accent-color:#1f1f1f; }

        /* ====== MOBILNI (≤768px) ====== */
        @media(max-width:768px){
          .shifts-page{ padding:8px 10px 84px; }
          .grid{ display:flex; flex-direction:column; gap:14px; }

          /* >>> KLJUČNO: konfiguraciona kartica bez bleed-a da ništa ne seče */
          .config-card{
            border-radius:16px;
            padding:12px;
            margin:0;
            width:100%;
            overflow:visible;
          }

          h1{ font-size:18px; margin:6px 0 10px; }

          .card h3{ font-size:13px; margin-bottom:10px; padding-bottom:6px; }
          .field{ margin-bottom:12px; }
          .label{ font-size:12.5px; margin-bottom:6px; }

          /* sve u stub, bez presecanja */
          .field.two{ display:flex !important; flex-direction:column !important; gap:10px !important; }
          .end-date-container{ display:block; min-width:0; }

          .input,.select{ height:40px; font-size:13px; padding:8px 10px; }
          .seg{ gap:6px; }
          .seg-btn{ padding:8px 10px; font-size:12.5px; min-width:96px; }
          .btn{ padding:12px 14px; font-size:14px; border-color:#fff;  border:1px solid #875e24ff;}

          /* ukloni plave naglaske na iOS/Android */
          input, select, button {
            color:#1f1f1f !important;
            -webkit-text-fill-color:#1f1f1f !important;
            accent-color:#1f1f1f !important;
          }
        }

        /* VEOMA USKI (≤380px) */
        @media(max-width:380px){
          .input,.select{ height:38px; font-size:12.5px; padding:7px 9px; }
          .seg-btn{ padding:7px 9px; font-size:12px; min-width:90px; }
        }

        /* ====== DESKTOP ====== */
        @media(min-width:1024px){
          .grid{
            grid-template-columns: 500px 1fr;
            gap:24px;
            align-items:start;
          }
          .config-card{ position: sticky; top: 20px; }

          .day-row{
            display:grid;
            grid-template-columns: 160px 140px 18px 140px 140px;
            align-items:center;
            gap:12px;
            padding:10px 0;
          }
          .day-label{ grid-column:1; margin:0; }
          .time-grid{ display:contents; }
          .time--from{ grid-column:2; height:40px; }
          .dash{ grid-column:3; text-align:center; }
          .time--to{ grid-column:4; height:40px; }
          .day-closed{ grid-column:5; justify-self:start; }
        }
        @media(min-width:1200px){
          .week-body{ padding:16px; }
        }

        .pill{
          background:#fff; border:1px solid #ddd6cc; color:#1f1f1f; padding:8px 12px; border-radius:999px;
          font-weight:600; font-size:12px; cursor:pointer; white-space:nowrap;
        }
        .pill:hover{ background:#f8f6f2; }
      `}</style>

      <h1>Smene</h1>

      <div className="grid">
        {/* LEVO – konfiguracija */}
        <div className="card config-card">
          <h3>Nova / postojeća smena</h3>

          <div className="field">
            <label className="label">Radnica</label>
            <select
              className="select tall"
              value={selectedUser}
              onChange={e=>setSelectedUser(e.target.value)}
            >
              <option value="">— Izaberi radnicu —</option>
              {employees.map(u => (
                <option key={u.username} value={u.username}>
                  {u.firstName} {u.lastName} ({u.username})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label">Šablon rasporeda</label>
            <div className="seg">
              {PATTERNS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`seg-btn ${p.key === pattern.key ? "is-active" : ""}`}
                  onClick={()=>setPattern(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field two">
            <div style={{flex:1, minWidth:0}}>
              <label className="label">Početak</label>
              <input
                className="input tall"
                type="date"
                value={startDate}
                onChange={e=>setStartDate(e.target.value)}
              />
            </div>

            <div style={{flex:1, minWidth:0}}>
              <label className="label">Kraj</label>
              <div className="end-date-container">
                <div className="seg small" style={{marginBottom:8}}>
                  <button
                    type="button"
                    className={`seg-btn ${endMode==="never" ? "is-active" : ""}`}
                    onClick={()=>setEndMode("never")}
                  >
                    Nikad
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${endMode==="until" ? "is-active" : ""}`}
                    onClick={()=>setEndMode("until")}
                  >
                    Datum
                  </button>
                </div>
                <input
                  className="input tall"
                  type="date"
                  value={endDate}
                  onChange={e=>setEndDate(e.target.value)}
                  disabled={endMode!=="until"}
                  style={{opacity: endMode==="until" ? 1 : .55}}
                />
              </div>
            </div>
          </div>

          <p className="hint">
            Kada izabereš radnicu, učitava se njena poslednja sačuvana smena. Možeš da je izmeniš i sačuvaš kao novu.
          </p>

          <div className="actions">
            <button className="btn" disabled={!canSave} onClick={saveSchedule}>Sačuvaj smenu</button>
            <button
              className="btn-ghost"
              onClick={()=>{ setWeeks(Array(pattern.weeks).fill(0).map(()=>makeWeek())); }}
            >
              Resetuj sate
            </button>
          </div>

          {/* ==== DODATO: izuzetak za jedan dan */}
          <div className="field" style={{marginTop:20}}>
            <h3 style={{marginTop:0}}>Izuzetak za jedan dan</h3>

            <label className="label">Dan</label>
            <input
              type="date"
              className="input"
              value={oneDayDate}
              onChange={(e)=>setOneDayDate(e.target.value)}
              disabled={!selectedUser}
            />

            <div style={{display:"flex", gap:8, marginTop:10}}>
              <div style={{flex:1}}>
                <label className="label">Od</label>
                <input
                  type="time"
                  className="input"
                  value={oneDayFrom}
                  onChange={(e)=>setOneDayFrom(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
              <div style={{flex:1}}>
                <label className="label">Do</label>
                <input
                  type="time"
                  className="input"
                  value={oneDayTo}
                  onChange={(e)=>setOneDayTo(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
            </div>

            <button
              className="btn"
              style={{marginTop:12}}
              onClick={saveOneDayOverride}
              disabled={!selectedUser || !oneDayDate || !oneDayFrom || !oneDayTo}
            >
              Postavi smenu za taj dan
            </button>

            <p className="hint" style={{marginTop:10}}>
              Ovo važi samo za izabrani dan i ne menja tvoj postojeći šablon — sve ostalo ostaje isto.
            </p>
          </div>
          {/* ==== /DODATO */}

          {/* ==== NOVO: BLOKADA VIŠE DANA ==== */}
          <div className="field" style={{marginTop:24}}>
            <h3 style={{marginTop:0}}>Blokiraj više dana</h3>

            <div style={{display:"grid", gap:8, gridTemplateColumns:"1fr 1fr"}}>
              <div>
                <label className="label">Od (datum)</label>
                <input
                  type="date"
                  className="input"
                  value={blkStartDate}
                  onChange={(e)=>setBlkStartDate(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
              <div>
                <label className="label">Do (datum)</label>
                <input
                  type="date"
                  className="input"
                  value={blkEndDate}
                  onChange={(e)=>setBlkEndDate(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
            </div>

            <div style={{display:"grid", gap:8, gridTemplateColumns:"1fr 1fr", marginTop:10}}>
              <div>
                <label className="label">Početak (vreme)</label>
                <input
                  type="time"
                  step="300"
                  className="input"
                  value={blkFrom}
                  onChange={(e)=>setBlkFrom(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
              <div>
                <label className="label">Kraj (vreme)</label>
                <input
                  type="time"
                  step="300"
                  className="input"
                  value={blkTo}
                  onChange={(e)=>setBlkTo(e.target.value)}
                  disabled={!selectedUser}
                />
              </div>
            </div>

          

            <div style={{marginTop:10}}>
              <label className="label">Beleška (opcionalno)</label>
              <input
                className="input"
                value={blkNote}
                onChange={(e)=>setBlkNote(e.target.value)}
                disabled={!selectedUser}
              />
            </div>

            <button
              className="btn"
              style={{marginTop:12}}
              onClick={createMultiDayBlocks}
              disabled={!selectedUser || !blkStartDate || !blkEndDate || !blkFrom || !blkTo}
            >
              Sačuvaj blokade
            </button>

            <p className="hint" style={{marginTop:10}}>
              Kreira pojedinačne „blok“ termine u kalendaru za izabrane dane — isto kao da si ručno dodala blokadu za svaki dan.
            </p>
          </div>
          {/* ==== /BLOKADA VIŠE DANA ==== */}
        </div>

        {/* DESNO – nedelje i dani */}
        <div className="card">
          <h3>Radno vreme po nedeljama</h3>
          <div className="weeks">
            {weeks.map((w, i) => (
              <WeekCard
                key={i}
                index={i}
                value={w}
                onChange={(arr)=>setWeeks(prev => { const n = prev.slice(); n[i]=arr; return n; })}
                onCopyFrom={(from)=>copyWeek(i, from)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
