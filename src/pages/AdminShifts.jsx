// src/pages/AdminShifts.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  collection, query, orderBy, onSnapshot,
  addDoc, serverTimestamp,
  where, getDocs, limit
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

/* ====== Jedan dan ====== */
function DayRow({ value, onChange, label }) {
  const closed = !!value.closed;
  return (
    <div className="day-row">
      <div className="day-label">{label}</div>

      {/* POČETAK – KRAJ (odvojene kolone) */}
      <div className="time-grid">
        <input
          className="time time--from"
          type="time"
          step="300"
          value={value.from || ""}
          onChange={(e)=>onChange({ ...value, from: e.target.value })}
          disabled={closed}
        />
        <span className="dash">–</span>
        <input
          className="time time--to"
          type="time"
          step="300"
          value={value.to || ""}
          onChange={(e)=>onChange({ ...value, to: e.target.value })}
          disabled={closed}
        />
      </div>

      {/* ZATVORENO (posebna kolona / red) */}
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
        const q = query(
          collection(db, "schedules"),
          where("employeeUsername", "==", selectedUser),
          orderBy("createdAt", "desc"),
          limit(1)
        );
        const snap = await getDocs(q);

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

  return (
    <div className="shifts-page">
      <style>{`
        *,*::before,*::after{ box-sizing:border-box; }
        /* >>> ključno: dozvoli da se stranica širi vertikalno */
        html,body,#root{ min-height:100%; height:auto; }
        html,body{ overflow-x:hidden; } /* samo X zatvoren */

        .shifts-page{
          padding:12px 8px;
          background:linear-gradient(180deg,#f7f4ef 0,#f0ebe4 100%);
          min-height:100vh;
          padding-bottom:80px;
          overflow-x:hidden;
          overflow-y:visible; /* >>> dozvoli Y */
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
          backdrop-filter:saturate(120%) blur(6px);
          border-radius:20px;
          box-shadow:0 8px 24px rgba(0,0,0,.06);
          padding:16px;
          border:1px solid #efe9df;
          max-width:100%;
          width:100%;
          overflow:visible; /* >>> nikad ne seci sadržaj */
        }
        .card h3{
          margin:0 0 16px;
          font-size:16px;
          font-weight:700;
          color:#2c261f;
          padding-bottom:8px;
          border-bottom:1px solid #f0ebe4;
        }

        .config-card{ position:static; max-height:none; overflow:visible; }

        .field{ margin-bottom:20px; }
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
          font-weight:600; font-size:13px; transition:all .2s; flex:1; min-width:80px; text-align:center;
        }
        .seg-btn.is-active{ background:#1f1f1f; color:#fff; border-color:#1f1f1f; box-shadow:0 4px 14px rgba(31,31,31,.18); }

        .hint{
          margin:12px 0; font-size:11px; color:#8a8378; line-height:1.4; padding:10px;
          background:#f8f6f2; border-radius:10px; border-left:3px solid #e6e0d7;
        }
        .actions{ display:flex; gap:10px; flex-direction:column; margin-top:20px; }
        .btn{ border:0; background:#1f1f1f; color:#fff; padding:14px 16px; border-radius:12px; cursor:pointer; font-weight:700; font-size:15px; width:100%; }
        .btn:hover:not(:disabled){ background:#333; }
        .btn:disabled{ opacity:.6; cursor:not-allowed; }
        .btn-ghost{ background:#fff; color:#1f1f1f; border:1px solid #ddd6cc; width:100%; }
        .btn-ghost:hover{ background:#f8f6f2; }

        input[type="time"]{ -webkit-appearance:none; appearance:none; min-width:0; }
        input[type="time"]::-webkit-calendar-picker-indicator{ padding:0; margin:0; }

        .weeks{
          display:flex; flex-direction:column; gap:16px;
          max-width:100%;
          overflow:visible; /* >>> važno */
          margin-bottom:8px;
        }
        .week-card{
          background:#fff; border:1px solid #eee; border-radius:16px;
          overflow:visible; /* >>> važno */
          box-shadow:0 2px 8px rgba(0,0,0,.04);
          max-width:100%;
        }
        .week-head{
          display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;
          padding:16px; background:#faf8f5; text-align:center;
        }
        .week-head .title{ font-weight:700; font-size:16px; color:#2c261f; width:100%; }
        .week-body{ padding:12px; display:grid; gap:12px; }

        /* === DayRow default (MOBILE-FIRST) === */
        .day-row{
          display:flex; flex-direction:column; gap:8px;
          padding:12px 0; border-bottom:1px solid #f5f3ef;
        }
        .day-row:last-child{ border-bottom:none; }

        .day-label{ font-weight:600; font-size:14px; color:#2c261f; }
        .time-grid{
          display:grid;
          grid-template-columns: 1fr 18px 1fr; /* from | – | to */
          gap:8px;
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
          .shifts-page{ padding:8px 0 84px; }
          .card{ padding:12px; border-radius:16px; }
            .card--bleed{
    border-left:0; border-right:0; border-radius:0;
    margin-left:max(-12px,-env(safe-area-inset-left));
    margin-right:max(-12px,-env(safe-area-inset-right));
    width:100vw; max-width:100vw;
  }
  /* da "Početak / Kraj" ne sabija polja u jedan red */
  .field.two{ flex-direction:column; gap:10px !important; }
}
          h1{ font-size:20px; margin:8px 0 12px; }
          .card h3{ font-size:14px; margin-bottom:10px; padding-bottom:6px; }

          .day-label{ font-size:13px; }
          .time{ height:38px; font-size:13px; }
          .day-closed{ font-size:12px; }
        }

        /* VEOMA USKI (≤380px) */
        @media(max-width:380px){
          .time{ height:36px; font-size:12.5px; }
          .dash{ font-size:12px; }
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
          .time-grid{ display:contents; } /* ubaci decu direktno u grid kolone */
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
        <div className="card config-card card--bleed">

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

          <div className="field two" style={{display:"flex", gap:12}}>
            <div style={{flex:1}}>
              <label className="label">Početak</label>
              <input
                className="input tall"
                type="date"
                value={startDate}
                onChange={e=>setStartDate(e.target.value)}
              />
            </div>

            <div style={{flex:1}}>
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
        </div>

        {/* DESNO – nedelje i dani */}
        <div className="card card--bleed">
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
