import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  collection, query, where, orderBy, onSnapshot,
  deleteDoc, doc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";
import CalendarEventModal from "../partials/CalendarEventModal";

/* ---------- helpers ---------- */
function toJsDate(x){ if(!x) return null; if(x instanceof Date) return x; if(typeof x?.toDate==="function") return x.toDate(); return new Date(x); }
function startOfDay(d){ const x=new Date(toJsDate(d)||new Date()); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(toJsDate(d)||new Date()); x.setHours(23,59,59,999); return x; }
function isSameDay(a,b){ const x=startOfDay(a), y=startOfDay(b); return x.getTime()===y.getTime(); }
function fmtTime(d){ const x=toJsDate(d); if(!x) return ""; const hh=String(x.getHours()).padStart(2,"0"); const mm=String(x.getMinutes()).padStart(2,"0"); return `${hh}:${mm}`; }
function minsInDay(dt, dayStart){ const t = toJsDate(dt)?.getTime?.() ?? 0; return Math.round((t - dayStart.getTime())/60000); }
const fmtPrice = (n)=> (Number(n)||0).toLocaleString("sr-RS");

const DAY_START_MIN = 8*60, DAY_END_MIN = 22*60, PX_PER_MIN = 1.1;
const yFromMinutes=(m)=> (m-DAY_START_MIN)*PX_PER_MIN;
const weekdayIndex = (d) => (toJsDate(d).getDay() + 6) % 7; // Mon=0 ... Sun=6
function getPhone(c){ return (c?.phone ?? c?.phoneNumber ?? c?.mobile ?? "").toString(); }
function formatClient(c, role="admin"){
  if(!c) return "—";
  const phone = getPhone(c);
  if(role==="admin"){ return `${c.firstName || ""} ${c.lastName || ""}${phone ? ` · ${phone}` : ""}`.trim(); }
  const last3 = phone.replace(/\D/g,"").slice(-3);
  const initial = c.lastName ? `${c.lastName[0].toUpperCase()}.` : "";
  return `${c.firstName || ""} ${initial}${last3 ? ` · ***${last3}` : ""}`.trim();
}

/* ---- normalize services from appointment ----
   Vraća uvek: [{ id, name, categoryId, priceRsd }]
*/
function normalizeServices(a, services) {
  const svcMap = new Map((services||[]).map(s=>[s.id, s]));
  const raw = a?.services || [];
  if (!raw.length) return [];

  // Stari zapis: lista ID-eva (stringova)
  if (typeof raw[0] === "string") {
    return raw
      .map(id => {
        const base = svcMap.get(id);
        return base ? {
          id: base.id,
          name: base.name || "—",
          categoryId: base.categoryId || null,
          priceRsd: Number(base.priceRsd)||0
        } : { id, name: "—", categoryId: null, priceRsd: 0 };
      });
  }

  // Novi zapis: lista objekata
  if (typeof raw[0] === "object") {
    return raw.map(x=>{
      const id = x.serviceId || x.id;
      const base = id ? svcMap.get(id) : null;
      return {
        id: id || (base?.id ?? null),
        name: x.name || base?.name || "—",
        categoryId: x.categoryId || base?.categoryId || null,
        priceRsd: Number(x.priceRsd ?? base?.priceRsd ?? 0) || 0
      };
    });
  }

  return [];
}

/* ---- smene → OFF maske ---- */
function hmToMin(s){ if (typeof s !== "string") return null; const [h,m] = s.split(":").map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return null; return h*60 + m; }
function getWorkIntervalsFor(empUsername, dateObj, latestSchedules){
  const sch = latestSchedules.get(empUsername);
  if (!sch) return [];
  const d = startOfDay(dateObj);
  const dStr = d.toISOString().slice(0,10);
  const inRange = (!sch.startDate || sch.startDate <= dStr) && (!sch.endDate || sch.endDate >= dStr);
  if (!inRange) return [];
  const weeksCount = sch.pattern === "2w" ? 2 : sch.pattern === "3w" ? 3 : sch.pattern === "4w" ? 4 : 1;
  const start = sch.startDate ? new Date(sch.startDate) : d;
  const diffDays = Math.floor((d - startOfDay(start)) / (24*3600*1000));
  const weekIdx = ((Math.floor(diffDays/7) % weeksCount) + weeksCount) % weeksCount;
  const weeksArr = Array.isArray(sch.weeks) ? sch.weeks : Object.keys(sch.weeks || {}).sort((a,b)=>Number(a)-Number(b)).map(k=>sch.weeks[k]);
  const dayCfg = (weeksArr[weekIdx] || [])[weekdayIndex(d)];
  if (!dayCfg || dayCfg.closed) return [];
  const intervals = [];
  if (Array.isArray(dayCfg.ranges)) {
    for (const r of dayCfg.ranges) {
      let s = typeof r.start === "number" ? r.start : hmToMin(r.start);
      let e = typeof r.end   === "number" ? r.end   : hmToMin(r.end);
      if (s==null || e==null) continue;
      if (e > s) intervals.push([s,e]);
    }
  }
  const cand = [[dayCfg.from, dayCfg.to],[dayCfg.start, dayCfg.end],[dayCfg.startMin, dayCfg.endMin]];
  for (const [a,b] of cand) {
    let s = typeof a === "number" ? a : hmToMin(a);
    let e = typeof b === "number" ? b : hmToMin(b);
    if (s!=null && e!=null && e>s) intervals.push([s,e]);
  }
  intervals.sort((x,y)=>x[0]-y[0]);
  const merged=[];
  for (const [s,e] of intervals){
    if (!merged.length || s>merged[merged.length-1][1]) merged.push([s,e]);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], e);
  }
  return merged;
}
function getOffIntervals(workIntervals){
  const res=[]; let cur = DAY_START_MIN;
  for (const [s,e] of workIntervals){ if (s>cur) res.push([cur, Math.min(s,DAY_END_MIN)]); cur = Math.max(cur, e); }
  if (cur < DAY_END_MIN) res.push([cur, DAY_END_MIN]);
  return res;
}

const HEADER_H = 36;
const CONTENT_H = (DAY_END_MIN-DAY_START_MIN)*PX_PER_MIN;

function dateToInputValue(d){
  const x = toJsDate(d) || new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,"0");
  const dd = String(x.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}

/* ----- boja po prvoj usluzi ----- */
function apptColorFrom(items, categoriesMap){
  const first = items[0];
  const col = first ? (categoriesMap.get(first.categoryId)?.color || null) : null;
  return col || "#e6e0d7";
}

export default function AdminCalendar({ role = "admin", currentUsername = null }){
  const [day,setDay]=useState(()=>startOfDay(new Date()));
  const [employees,setEmployees]=useState([]);
  const [services,setServices]=useState([]);
  const [categories,setCategories]=useState([]);
  const [clients,setClients]=useState([]);
  const [appointments,setAppointments]=useState([]);
  const [employeeFilter,setEmployeeFilter]=useState("all");

  // schedules – poslednja po radnici
  const [latestSchedules, setLatestSchedules] = useState(new Map());

  // modal / chooser
  const [open,setOpen]=useState(false);
  const [modalValue,setModalValue]=useState({create:true,type:"appointment"});
  const [hover, setHover] = useState({ show:false, emp:null, top:0, text:"" });
  const [chooser, setChooser] = useState({ open:false, start:null, emp:null });

  // hover kartica
  const [hoverAppt, setHoverAppt] = useState(null);

  // resize
  const [tempEndMap, setTempEndMap] = useState(new Map());
  const resizingRef = useRef(null);
  const tempEndRef = useRef(new Map());
  const justResizedRef = useRef(false);

  // DND
  const draggingRef = useRef(null); // { id, durationMin, offsetY, empFrom, startMinInit }
  const [dragGhost, setDragGhost] = useState(null); // { id, emp, topMin }
  const dragGhostRef = useRef(null);
  const justDraggedRef = useRef(false);

  // optimistic end override
  const [overrideEndMap, setOverrideEndMap] = useState(new Map());
  const overrideTimersRef = useRef(new Map());

  // visine i skrol
  const columnsOuterRef = useRef(null);
  const [paneH, setPaneH] = useState(0);
  const gridWrapRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);

  // mapa kolona
  const colBodyRefs = useRef(new Map()); // empUsername -> HTMLElement

  // sada linija
  const [nowMinAbs, setNowMinAbs] = useState(0);

  // mape
  const serviceMap=useMemo(()=>new Map(services.map(s=>[s.id,s])),[services]);
  const categoriesMap = useMemo(()=>new Map(categories.map(c=>[c.id,c])),[categories]);
  const dayStart=useMemo(()=>startOfDay(day),[day]);
  const dayEnd=useMemo(()=>endOfDay(day),[day]);

  /* ---------- ko radi danas ---------- */
  useEffect(() => {
    const unsub = onSnapshot(collection(db,"schedules"), (snap) => {
      const perEmp = new Map();
      for (const d of snap.docs) {
        const data = { id:d.id, ...d.data() };
        const k = data.employeeUsername;
        const prev = perEmp.get(k);
        const created = data.createdAt?.toDate?.()?.getTime?.() || 0;
        if (!prev || created > (prev.createdAt?.toDate?.()?.getTime?.() || 0)) perEmp.set(k, data);
      }
      setLatestSchedules(perEmp);
    });
    return () => unsub && unsub();
  }, []);

  function worksThisDay(empUsername, dateObj){
    const sch = latestSchedules.get(empUsername);
    if (!sch) return false;
    const d = startOfDay(dateObj);
    const dStr = d.toISOString().slice(0,10);
    const inRange = (!sch.startDate || sch.startDate <= dStr) && (!sch.endDate || sch.endDate >= dStr);
    if (!inRange) return false;
    const weeksCount = sch.pattern === "2w" ? 2 : sch.pattern === "3w" ? 3 : sch.pattern === "4w" ? 4 : 1;
    const start = sch.startDate ? new Date(sch.startDate) : d;
    const diffDays = Math.floor((d - startOfDay(start)) / (24*3600*1000));
    const weekIdx = ((Math.floor(diffDays/7) % weeksCount) + weeksCount) % weeksCount;
    const weeksArr = Array.isArray(sch.weeks) ? sch.weeks : Object.keys(sch.weeks || {}).sort((a,b)=>Number(a)-Number(b)).map(k=>sch.weeks[k]);
    const dayCfg = (weeksArr[weekIdx] || [])[weekdayIndex(d)];
    if (!dayCfg || dayCfg.closed) return false;
    return true;
  }

  const employeesWorkingToday = useMemo(
    () => (employees || []).filter(e => worksThisDay(e.username, dayStart)),
    [employees, latestSchedules, dayStart]
  );

  // vidljive kolone
  const visibleEmployees=useMemo(()=>{
    let base = employeesWorkingToday;
    if (role === "worker" && currentUsername){
      base = base.filter(e => e.username === currentUsername); // worker vidi samo sebe
      return base;
    }
    if (employeeFilter==="all") return base;
    return base.filter(e=>e.username===employeeFilter);
  },[employeesWorkingToday,employeeFilter,role,currentUsername]);

  /* ---------- termini ---------- */
  const apptsForDay=useMemo(()=>{
    const s=dayStart.getTime(), e=dayEnd.getTime();
    return (appointments||[])
      .filter(a=>{ const t=toJsDate(a.start)?.getTime()??0; return t>=s && t<=e; })
      .sort((a,b)=>toJsDate(a.start)-toJsDate(b.start));
  },[appointments,dayStart,dayEnd]);

  const apptsByEmployee=useMemo(()=>{
    const m=new Map(); for(const emp of visibleEmployees) m.set(emp.username,[]);
    for(const a of apptsForDay){ if(!m.has(a.employeeUsername)) m.set(a.employeeUsername,[]); m.get(a.employeeUsername).push(a); }
    return m;
  },[apptsForDay,visibleEmployees]);

  /* ---------- load base ---------- */

  useEffect(()=>onSnapshot(collection(db,"clients"),snap=>{
    const rows = snap.docs
      .map(d => {
        const data = d.data();
        return data ? { id: d.id, ...data } : null;
      })
      .filter(Boolean);
    setClients(rows);
  }),[]);

  useEffect(()=>onSnapshot(collection(db,"employees"),snap=>{
    setEmployees(
      snap.docs.map(d => {
        const data = d.data();
        return data ? { id:d.id, ...data } : null;
      }).filter(Boolean)
    );
  }),[]);

  useEffect(()=>onSnapshot(collection(db,"services"),snap=>{
    setServices(
      snap.docs.map(d => {
        const data = d.data();
        return data ? { id:d.id, ...data } : null;
      }).filter(Boolean)
    );
  }),[]);

  useEffect(()=>onSnapshot(collection(db,"categories"),snap=>{
    setCategories(
      snap.docs.map(d => {
        const data = d.data();
        return data ? { id:d.id, ...data } : null;
      }).filter(Boolean)
    );
  }),[]);

  useEffect(()=>{
    const q=query(
      collection(db,"appointments"),
      where("start",">=",dayStart),
      where("start","<=",dayEnd),
      orderBy("start","asc")
    );
    const unsub=onSnapshot(q,snap=>{
      const docs = snap.docs.map(d=>({id:d.id,...d.data()}));
      console.log("Appointments updated:", docs.length, docs);
      setAppointments(docs);
      setOverrideEndMap(prev => {
        if (prev.size===0) return prev;
        const next = new Map(prev);
        for (const a of docs) {
          if (!next.has(a.id)) continue;
          const targetEndMin = next.get(a.id);
          const actualEndMin = Math.min(DAY_END_MIN, minsInDay(a.end, dayStart));
          if (actualEndMin === targetEndMin) {
            next.delete(a.id);
            const t = overrideTimersRef.current.get(a.id);
            if (t) { clearTimeout(t); overrideTimersRef.current.delete(a.id); }
          }
        }
        return next;
      });
    });
    return ()=>unsub&&unsub();
  },[dayStart,dayEnd]);

  /* ---------- actions ---------- */
  function openCreateAt(date,employeeUsername){
    const s=toJsDate(date)||new Date();
    const targetEmp = role==="worker" ? (currentUsername || employeeUsername) : (employeeUsername || (visibleEmployees[0]?.username||""));
    setModalValue({ create:true, type:"appointment", start:s, end:new Date(s.getTime()+30*60000),
      employeeUsername: targetEmp, services:[], priceRsd:0, paid:null, source:"manual", pickedEmployee:false, note:"" });
    setOpen(true);
  }
  function openBlock(employeeUsername,date){
    const s=date?toJsDate(date):new Date(dayStart);
    const targetEmp = role==="worker" ? (currentUsername || employeeUsername) : (employeeUsername || visibleEmployees[0]?.username || "");
    setModalValue({create:true,type:"block",start:s,end:new Date(s.getTime()+60*60000),employeeUsername:targetEmp,note:""});
    setOpen(true);
  }
  function openEdit(a){
    if (role==="worker" && a.employeeUsername !== currentUsername) return;
    const overrideMin = overrideEndMap.get(a.id) ?? tempEndMap.get(a.id) ?? null;
    let endDate = toJsDate(a.end);
    if (overrideMin != null) { const d = new Date(dayStart); d.setMinutes(overrideMin); endDate = d; }
    setModalValue({ ...a, create:false, start: toJsDate(a.start), end: endDate, manualEnd: true });
    setOpen(true);
  }
  async function handleDelete(id){
    if(!id) return;
    if(!window.confirm("Obrisati ovaj termin?")) return;
    await deleteDoc(doc(db,"appointments",id));
    setOpen(false);
  }

  function prevDay(){ const d=new Date(dayStart); d.setDate(d.getDate()-1); setDay(d); }
  function nextDay(){ const d=new Date(dayStart); d.setDate(d.getDate()+1); setDay(d); }
  function today(){ setDay(startOfDay(new Date())); }

  // SWIPE: levo/desno za promenu dana (samo telefon/tablet)
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let moved = false;

    function onTouchStart(e) {
      if (resizingRef.current || draggingRef.current) return; // ne tokom resize/drag
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      moved = false;
    }

    function onTouchMove(e) {
      if (resizingRef.current || draggingRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Ako je pokret više vertikalan — pusti skrol i izađi
      if (Math.abs(dy) > Math.abs(dx)) return;

      // Spriječi horizontalni “rubber band” dok klizi
      if (Math.abs(dx) > 10) {
        e.preventDefault(); // traži {passive:false} listener (dodajemo dole)
        moved = true;
      }
    }

    function onTouchEnd(e) {
      if (resizingRef.current || draggingRef.current) return;
      if (justResizedRef.current || justDraggedRef.current) return;

      if (!moved) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // opet: ignoriži ako je vertikala dominantna
      if (Math.abs(dy) > Math.abs(dx)) return;

      const THRESH = 80; // prag u pikselima
      if (dx <= -THRESH) {
        nextDay(); // swipe levo → sledeći dan
      } else if (dx >= THRESH) {
        prevDay(); // swipe desno → prethodni dan
      }
    }

    // Važno: passive:false zbog preventDefault u move handleru
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [dayStart, visibleEmployees]);

  /* ---------- HUD vreme ---------- */
  function handleColumnMove(e, empUsername){
    const body = colBodyRefs.current.get(empUsername);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + (body.scrollTop || 0);
    const minutesFromTop = Math.round(Math.max(0, offsetY) / PX_PER_MIN);
    let whenMin = DAY_START_MIN + minutesFromTop;
    whenMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, Math.round(whenMin/5)*5));
    const d = new Date(dayStart); d.setMinutes(whenMin);
    setHover({ show:true, emp:empUsername, top:yFromMinutes(whenMin), text:fmtTime(d) });

    // drag u toku → pomeraj ghost
    if (draggingRef.current) {
      const g = { id: draggingRef.current.id, emp: empUsername, topMin: whenMin };
      setDragGhost(g);
      dragGhostRef.current = g;
    }
  }
  function handleColumnLeave(){ setHover({ show:false, emp:null, top:0, text:"" }); }
  function handleColumnClick(e, empUsername){
    if (justResizedRef.current || justDraggedRef.current) return;
    const body = colBodyRefs.current.get(empUsername);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + (body.scrollTop || 0);
    const minutesFromTop = Math.round(Math.max(0, offsetY) / PX_PER_MIN);
    let whenMin = DAY_START_MIN + minutesFromTop;
    whenMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN-5, Math.round(whenMin/5)*5));
    const d = new Date(dayStart); d.setMinutes(whenMin);
    setChooser({ open:true, start:d, emp:empUsername });
  }

  /* ---------- Sync scroll ---------- */
  function handleColumnsScroll(e){
    const st = e.currentTarget.scrollTop || 0;
    setScrollY(st);
    if (hoverAppt) setHoverAppt(null);
  }
  function swallowNextClick(ev){ ev.stopPropagation(); ev.preventDefault(); }

  /* ---------- Helper for touch/mouse coords ---------- */
  function getClientCoords(ev) {
    if (ev.touches && ev.touches.length > 0) {
      return { clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY };
    }
    return { clientX: ev.clientX, clientY: ev.clientY };
  }

  /* ---------- Resize ---------- */
  function onResizingMouseMove(ev){
    const r = resizingRef.current; if(!r) return;
    const offset = ev.clientY - r.bodyTop + r.scrollTop;
    const minutesFromTop = Math.round(Math.max(0, offset) / PX_PER_MIN);
    let proposedEndMin = DAY_START_MIN + minutesFromTop;
    proposedEndMin = Math.max(proposedEndMin, r.startMin + 15);
    proposedEndMin = Math.min(proposedEndMin, DAY_END_MIN);
    proposedEndMin = Math.round(proposedEndMin / 5) * 5;
    setTempEndMap(m=>{ const nm = new Map(m); nm.set(r.id, proposedEndMin); tempEndRef.current = nm; return nm; });
  }
  function onResizingTouchMove(ev) {
    ev.preventDefault(); // Spreči skrol
    const coords = getClientCoords(ev);
    const r = resizingRef.current; if (!r) return;
    const offset = coords.clientY - r.bodyTop + r.scrollTop;
    const minutesFromTop = Math.round(Math.max(0, offset) / PX_PER_MIN);
    let proposedEndMin = DAY_START_MIN + minutesFromTop;
    proposedEndMin = Math.max(proposedEndMin, r.startMin + 15);
    proposedEndMin = Math.min(proposedEndMin, DAY_END_MIN);
    proposedEndMin = Math.round(proposedEndMin / 5) * 5;
    setTempEndMap(m => { const nm = new Map(m); nm.set(r.id, proposedEndMin); tempEndRef.current = nm; return nm; });
  }
  async function onResizingMouseUp(){
    const r = resizingRef.current; if(!r) return cleanupResize();
    justResizedRef.current = true;
    setTimeout(() => { justResizedRef.current = false; }, 300);
    setTimeout(() => { window.removeEventListener("click", swallowNextClick, true); }, 0);
    const newEndMin = tempEndRef.current.get(r.id) ?? null;
    if(newEndMin && newEndMin > r.startMin){
      const newEndDate = new Date(dayStart); newEndDate.setMinutes(newEndMin);
      try{
        setOverrideEndMap(prev=>{ const nm = new Map(prev); nm.set(r.id, newEndMin); return nm; });
        await updateDoc(doc(db,"appointments", r.id), { end: newEndDate, updatedAt: serverTimestamp() });
      }catch(err){
        console.error("Failed to save resized end:", err);
        alert("Greška pri čuvanju promena.");
        setOverrideEndMap(prev=>{ const nm=new Map(prev); nm.delete(r.id); return nm; });
        const t = overrideTimersRef.current.get(r.id);
        if (t) { clearTimeout(t); overrideTimersRef.current.delete(r.id); }
      }
    }
    cleanupResize();
  }
  function onResizingTouchEnd(ev) {
    ev.preventDefault();
    onResizingMouseUp(); // Pozovi istu logiku
  }
  function startResize(e, appt){
    e.stopPropagation(); e.preventDefault();
    if (role==="worker" && appt.employeeUsername !== currentUsername) return;
    const body = colBodyRefs.current.get(appt.employeeUsername);
    if(!body) return;
    const rect = body.getBoundingClientRect();
    const scrollTop = body.scrollTop || 0;
    const coords = getClientCoords(e);
    resizingRef.current = {
      id: appt.id,
      startMin: Math.max(DAY_START_MIN, minsInDay(appt.start, dayStart)),
      bodyTop: rect.top,
      scrollTop,
      emp: appt.employeeUsername
    };
    window.addEventListener("mousemove", onResizingMouseMove);
    window.addEventListener("mouseup", onResizingMouseUp);
    window.addEventListener("touchmove", onResizingTouchMove, { passive: false });
    window.addEventListener("touchend", onResizingTouchEnd);
    window.addEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none"; // Spreči skrol na touch
  }
  function cleanupResize(){
    resizingRef.current = null;
    setTempEndMap(new Map());
    tempEndRef.current = new Map();
    window.removeEventListener("mousemove", onResizingMouseMove);
    window.removeEventListener("mouseup", onResizingMouseUp);
    window.removeEventListener("touchmove", onResizingTouchMove);
    window.removeEventListener("touchend", onResizingTouchEnd);
    window.removeEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";
  }

  /* ---------- Drag & Drop ---------- */
  function onDragMove(ev){
    const d = draggingRef.current; if(!d) return;
    const targetEmp = pickColumnUnderPointer(ev.clientX, ev.clientY) ?? d.empFrom;
    const body = colBodyRefs.current.get(targetEmp);
    if(!body) return;

    const rect = body.getBoundingClientRect();
    const offsetY = ev.clientY - rect.top + (body.scrollTop || 0);
    let newTopMin = DAY_START_MIN + Math.round((offsetY - d.offsetY)/PX_PER_MIN);
    newTopMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - d.durationMin, Math.round(newTopMin/5)*5));

    const g = { id: d.id, emp: targetEmp, topMin: newTopMin };
    setDragGhost(g);
    dragGhostRef.current = g;
  }
  function onDragTouchMove(ev) {
    ev.preventDefault(); // Spreči skrol
    const coords = getClientCoords(ev);
    const d = draggingRef.current; if(!d) return;
    const targetEmp = pickColumnUnderPointer(coords.clientX, coords.clientY) ?? d.empFrom;
    const body = colBodyRefs.current.get(targetEmp);
    if(!body) return;

    const rect = body.getBoundingClientRect();
    const offsetY = coords.clientY - rect.top + (body.scrollTop || 0);
    let newTopMin = DAY_START_MIN + Math.round((offsetY - d.offsetY)/PX_PER_MIN);
    newTopMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - d.durationMin, Math.round(newTopMin/5)*5));

    const g = { id: d.id, emp: targetEmp, topMin: newTopMin };
    setDragGhost(g);
    dragGhostRef.current = g;
  }
  async function onDragEnd() {
    const d = draggingRef.current;
    const ghost = dragGhostRef.current;

    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("touchmove", onDragTouchMove);
    window.removeEventListener("touchend", onDragTouchEnd);
    window.removeEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";

    setDragGhost(null);
    draggingRef.current = null;
    dragGhostRef.current = null;

    if (!d || !ghost) {
      console.log("Drag aborted: missing draggingRef or dragGhostRef", { d, ghost });
      return;
    }

    if (ghost.emp === d.empFrom && ghost.topMin === d.startMinInit) {
      console.log("Drag aborted: no change in position or employee", { emp: ghost.emp, topMin: ghost.topMin });
      return;
    }

    // Calculate new start and end times
    const newStart = new Date(dayStart);
    newStart.setMinutes(ghost.topMin);
    const newEnd = new Date(newStart.getTime() + d.durationMin * 60000);

    // No collision check anymore - allow overlaps

    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 300);

    try {
      console.log("Saving drag changes:", {
        id: d.id,
        start: newStart.toISOString(),
        end: newEnd.toISOString(),
        employeeUsername: ghost.emp,
      });

      await updateDoc(doc(db, "appointments", d.id), {
        start: newStart,
        end: newEnd,
        employeeUsername: ghost.emp,
        updatedAt: serverTimestamp(),
      });
      console.log("Drag saved successfully");
    } catch (err) {
      console.error("Drag save failed:", err);
      alert("Greška pri pomeranju termina: " + err.message);
    }
  }

  function onDragTouchEnd(ev) {
    ev.preventDefault();
    onDragEnd();
  }

  function startDrag(ev, appt, top) {
    if ((ev.target)?.classList?.contains("resize-handle")) return; // ako hvatište, onda resize
    if (role === "worker" && appt.employeeUsername !== currentUsername) return;

    const body = colBodyRefs.current.get(appt.employeeUsername);
    if (!body) return;

    ev.stopPropagation();

    const startMin = Math.max(DAY_START_MIN, minsInDay(appt.start, dayStart));
    const endMin = Math.min(DAY_END_MIN, minsInDay(appt.end, dayStart));
    const durationMin = Math.max(15, endMin - startMin);

    const rect = body.getBoundingClientRect();
    const coords = getClientCoords(ev);
    const offsetY = coords.clientY - rect.top + (body.scrollTop || 0) - (top ?? 0);

    // Detekcija tap vs drag
    let isDragging = false;
    let startX = coords.clientX;
    let startY = coords.clientY;
    const touchStartTime = Date.now();

    draggingRef.current = {
      id: appt.id,
      durationMin,
      offsetY: Math.max(0, offsetY),
      empFrom: appt.employeeUsername,
      startMinInit: startMin,
    };

    const g = { id: appt.id, emp: appt.employeeUsername, topMin: startMin };
    setDragGhost(g);
    dragGhostRef.current = g;

    const onTouchMoveHandler = (ev) => {
      const coords = getClientCoords(ev);
      const dx = Math.abs(coords.clientX - startX);
      const dy = Math.abs(coords.clientY - startY);
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 10) { // Prag za drag
        isDragging = true;
        ev.preventDefault(); // Spreči skrol samo ako je drag
        onDragTouchMove(ev);
      }
    };

    const onTouchEndHandler = (ev) => {
      const touchDuration = Date.now() - touchStartTime;
      console.log("Touch ended:", { isDragging, touchDuration });
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("touchmove", onTouchMoveHandler);
      window.removeEventListener("touchend", onTouchEndHandler);
      window.removeEventListener("click", swallowNextClick, true);
      document.body.style.userSelect = "";
      document.body.style.touchAction = "";

      if (isDragging) {
        onDragEnd();
      } else if (touchDuration < 300) { // Tap kraći od 300ms
        setHoverAppt(null);
        openEdit(appt);
      }

      setDragGhost(null);
      draggingRef.current = null;
      dragGhostRef.current = null;
    };

    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onTouchMoveHandler, { passive: false });
    window.addEventListener("touchend", onTouchEndHandler);
    window.addEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
  }

  function pickColumnUnderPointer(clientX, clientY){
    for (const emp of visibleEmployees){
      const body = colBodyRefs.current.get(emp.username);
      if (!body) continue;
      const r = body.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        console.log("Picked column:", emp.username);
        return emp.username;
      }
    }
    console.log("No column picked under:", { clientX, clientY });
    return null;
  }

  /* ---------- Dinamička visina ---------- */
  useEffect(() => {
    function computeH(){
      const el = gridWrapRef.current; if(!el) return;
      const top = el.getBoundingClientRect().top;
      const h = Math.max(300, window.innerHeight - top - 16);
      setPaneH(h);
    }
    computeH();
    window.addEventListener("resize", computeH);
    return () => window.removeEventListener("resize", computeH);
  }, []);

  /* ---------- "SADA" linija ---------- */
  useEffect(()=>{
    const tick = () => setNowMinAbs(minsInDay(new Date(), startOfDay(new Date())));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(()=>() => {
    for (const [,t] of overrideTimersRef.current) clearTimeout(t);
    overrideTimersRef.current.clear();
    cleanupResize();
  }, []);

  const showNow = isSameDay(dayStart, new Date()) && nowMinAbs >= DAY_START_MIN && nowMinAbs <= DAY_END_MIN;
  const nowTop = yFromMinutes(nowMinAbs);

  const canSeePayment = role !== "worker";
  const showEmployeeFilter = role !== "worker";

  return (
    <div className="admin-cal">
      <style>{`
        /* ===== BASE STYLES ===== */
        .admin-cal{ padding:20px 16px 80px; }
        .cal-bar{ 
          display:flex; gap:10px; align-items:center; margin-bottom:16px; 
          flex-wrap:wrap; 
        }
        .btn{ 
          padding:8px 12px; border-radius:10px; border:1px solid #ddd6cc; 
          background:#fff; cursor:pointer; font-size:14px; 
          touch-action:manipulation;
        }
        .btn:hover{ background:#faf6f0; }
        .btn:active{ transform:translateY(1px); }
        .title{ 
          font-weight:800; font-size:18px; letter-spacing:.2px; 
          flex:1; text-align:center; 
        }
        .select{ 
          padding:8px 12px; border-radius:10px; border:1px solid #ddd6cc; 
          background:#fff; font-size:16px; /* touch-friendly */
        }
        .top-actions{ 
          margin-left:auto; display:flex; gap:8px; flex-wrap:wrap; 
        }

        .grid-wrap{ 
          display:grid; grid-template-columns:80px 1fr; gap:10px; 
          height: calc(100vh - 160px); /* responsive height */
        }

        /* ===== Timeline ===== */
        .timeline{ 
          border:1px solid #e6e0d7; border-radius:12px; background:#fff; 
        }
        .timeline-inner{ position:relative; height:100%; }
        .timeline-header{ 
          position:sticky; top:0; height:${HEADER_H}px; 
          background:#faf6f0; border-bottom:1px solid #e6e0d7; z-index:2; 
        }
        .timeline-viewport{ 
          position:relative; overflow:hidden; 
        }
        .timeline-body{ 
          position:relative; height:${CONTENT_H}px; 
          will-change: transform; 
        }
        .timeline .hour{ 
          position:absolute; left:8px; font-size:12px; color:#6b7280; 
          transform:translateY(-50%); 
        }
        .timeline .line{ 
          position:absolute; left:0; right:0; height:1px; background:#eee; 
        }
        .now-line-left{ 
          position:absolute; left:6px; right:6px; height:0; 
          border-top:3px solid #ef4444; z-index:5; 
        }

        /* ===== Columns ===== */
        .columns-outer{ 
          border:1px solid #e6e0d7; border-radius:12px; 
          background:#fff; overflow:auto; 
        }
        .columns{ 
          display:grid; grid-auto-flow:column; 
          grid-auto-columns:minmax(240px,1fr); position:relative; 
        }
        .col{ position:relative; }
        .col:not(:first-child)::before{ 
          content:""; position:absolute; top:0; bottom:0; left:0; 
          width:2px; background:#e6e0d7; opacity:.95; z-index:2; 
        }

        .col-header{ 
          position: sticky; top:0; height:${HEADER_H}px; 
          display:flex; align-items:center; justify-content:center; 
          font-weight:700; background:#faf6f0; 
          border-bottom:1px solid #e6e0d7; z-index:3; 
          font-size:14px; padding:0 8px; text-align:center;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .col-body{ 
          position:relative; height:${CONTENT_H}px; 
        }

        .grid-hour{ 
          position:absolute; left:0; right:0; height:1px; 
          background:#eee; z-index:0; 
        }

        .hover-line{ 
          position:absolute; left:6px; right:6px; height:0; 
          border-top:1px dashed rgba(0,0,0,.25); 
          pointer-events:none; z-index:2; 
        }
        .hover-badge{ 
          position:absolute; left:50%; transform:translate(-50%,-50%); 
          padding:3px 8px; font-size:12px; font-weight:700; 
          background:#1f1f1f; color:#fff; border-radius:999px; 
          border:1px solid rgba(255,255,255,.4); white-space:nowrap; 
          box-shadow:0 2px 10px rgba(0,0,0,.15); 
        }

        .now-line-global{ 
          position:absolute; left:0; right:0; height:0; 
          border-top:3px solid #ef4444; z-index:4; pointer-events:none; 
        }

        /* ===== Appointments ===== */
        .appt{ 
          position:absolute; left:0px; right:0px; 
          border-radius:12px; padding:8px 10px; 
          background: var(--col,#fff); color:#1f1f1f; 
          box-shadow:0 1px 2px rgba(0,0,0,.06); 
          cursor:grab; overflow:hidden; 
          border:1px solid #ddd6cc; z-index:1; 
          touch-action:manipulation;
        }
        .appt:active{ cursor:grabbing; }
        .appt.block{ 
          background:#fff !important; border:2px solid #ef4444; 
          color:#ef4444; 
        }
        .appt.paid{ 
          background:#f3f4f6 !important; color:#6b7280; 
        }

        .appt .time{ 
          font-weight:800; font-size:12px; 
        }
        .appt .title{ 
          font-size:13px; margin-top:2px; 
          line-height:1.2;
        }
        .appt .muted{ 
          color:inherit; opacity:.8; font-size:12px; 
          margin-top:2px; 
        }
        .appt .tag{ 
          display:inline-block; margin-top:4px; font-size:11px; 
          border:1px solid #e6e0d7; padding:2px 6px; 
          border-radius:999px; background:#faf6f0; 
        }

        .resize-handle{ 
          position:absolute; left:0; right:0; height:10px; 
          bottom:0; cursor:ns-resize; 
        }
        .resize-handle:before{ 
          content:""; display:block; width:36px; height:4px; 
          margin:3px auto 0; border-radius:4px; 
          background:rgba(0,0,0,0.12); 
        }

        /* Ikonice u uglu (online / specific / plaćanje) */
        .corner-icons{
          position:absolute; top:6px; right:8px;
          display:flex; gap:6px; font-size:16px; line-height:1;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,.15));
          user-select:none;
        }

        /* ===== Chooser ===== */
        .chooser-backdrop{ 
          position:fixed; inset:0; background:rgba(0,0,0,.25); 
          display:flex; align-items:center; justify-content:center; 
          z-index:50; 
        }
        .chooser-card{ 
          background:#fff; border-radius:16px; padding:16px; 
          border:1px solid #e6e0d7; box-shadow:0 12px 30px rgba(0,0,0,.18); 
          min-width:260px; max-width:90vw; 
        }
        .chooser-title{ 
          font-weight:800; margin-bottom:10px; 
          text-align:center; font-size:16px;
        }
        .chooser-actions{ 
          display:flex; gap:10px; 
        }
        .btn-ghost{ 
          padding:10px 12px; border-radius:12px; 
          border:1px solid #ddd6cc; background:#fff; cursor:pointer; 
          flex:1; font-size:14px;
        }
        .btn-dark{ 
          padding:10px 12px; border-radius:12px; 
          background:#1f1f1f; color:#fff; 
          border:1px solid #1f1f1f; cursor:pointer; 
          flex:1; font-size:14px;
        }

        /* ===== Hover kartica ===== */
        .hover-appt{ 
          position: fixed; z-index: 200; pointer-events: none; 
          width: 320px; background: #ffffff; 
          border: 1px solid #e6e0d7; border-radius: 16px; 
          box-shadow: 0 14px 34px rgba(0,0,0,.20); overflow: hidden; 
        }
        .hover-appt .stripe{ 
          position:absolute; left:0; top:0; bottom:0; width:6px; 
          background:#e6e0d7; 
        }
        .hover-appt .inner{ 
          padding: 12px 14px 12px 18px; 
        }
        .hover-appt .time{ 
          font-weight:800; font-size:13px; margin-bottom:6px; 
        }
        .hover-appt .title{ 
          font-weight:800; font-size:15px; 
        }
        .hover-appt .sub{ 
          color:#6b7280; font-size:13px; margin-top:2px; 
        }
        .hover-appt .chips{ 
          display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 2px; 
        }
        .hover-appt .chip{ 
          font-size:11px; font-weight:700; line-height:1; 
          padding:4px 8px; border-radius:999px; 
          border:1px solid #e6e0d7; background:#faf6f0; 
        }
        .hover-appt .price{ 
          font-weight:800; margin-top:6px; font-size:14px; 
        }
        .hover-appt .hr{ 
          height:1px; background:#f1ebe4; margin:10px 0; 
        }
        .hover-appt .note-row{ 
          display:flex; gap:8px; align-items:flex-start; 
        }
        .hover-appt .note-ico{ opacity:.7; }
        .hover-appt .note-text{ 
          font-size:13px; color:#374151; white-space:pre-wrap; 
        }

        /* ===== OFF maske ===== */
        .off-mask{ 
          position:absolute; left:0; right:0; 
          background: rgba(0,0,0,0.06); pointer-events:none; 
          border-radius: 0; z-index: 0; 
        }

        /* ===== DND ghost ===== */
        .drag-ghost{ 
          position:absolute; left:8px; right:8px; 
          border:2px dashed #2563eb; background: rgba(59,130,246,0.08); 
          border-radius:12px; pointer-events:none; z-index: 3; 
        }

        /* ===== MOBILE OPTIMIZATIONS ===== */
        @media (max-width: 900px) {
          .admin-cal { padding: 12px 8px 80px; }
          .cal-bar { gap: 8px; margin-bottom: 12px; justify-content: space-between; padding: 0 4px; margin-top: 20px; }
          .title { font-size: 16px; flex: none; order: 3; }
          .select { min-width: 120px; font-size: 16px; }
          .top-actions { order: 4; margin-left: 0; gap: 4px; }
          .grid-wrap { grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: 8px; height: calc(100vh - 140px); }
          .timeline { order: 2; grid-row: 2; display: none; }
          .timeline-header { display: none; }
          .timeline .hour { font-size: 11px; left: 4px; }
          .timeline .line { left: 4px; right: 4px; }
          .columns { grid-auto-columns: 1fr; min-width: 100%; }
          .columns-outer { order: 1; grid-row: 1; }
          .col-header { height: 48px; font-size: 13px; padding: 0 4px; justify-content: flex-start; text-align: left; }
          .appt { left: 0px; right: 0px; padding: 10px 8px; min-height: 44px; font-size: 13px; }
          .appt .time { font-size: 11px; line-height: 1.2; }
          .appt .title { font-size: 12px; margin-top: 2px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; display:-webkit-box; overflow:hidden; }
          .appt .muted { font-size: 11px; margin-top: 2px; -webkit-line-clamp: 1; -webkit-box-orient: vertical; display:-webkit-box; overflow:hidden; }
          .appt .tag { font-size: 10px; padding: 2px 4px; margin-top: 2px; }
          .resize-handle { height: 12px; }
          .resize-handle:before { width: 24px; height: 3px; }
          .corner-icons { font-size:14px; right:4px; top:4px; }
          .hover-line, .hover-badge { display: none; }
          .chooser-card { min-width: auto; max-width: 280px; margin: 20px; padding: 20px; }
          .chooser-title { font-size: 16px; margin-bottom: 16px; }
          .chooser-actions { flex-direction: column; gap: 8px; }
          .btn-ghost, .btn-dark { padding: 14px 16px; font-size: 16px; min-height: 48px; }
          .hover-appt { width: 90vw; max-width: 340px; left: 5vw !important; top: auto !important; bottom: 20px !important; }
          .hover-appt .inner { padding: 16px; }
          .hover-appt .title { font-size: 16px; }
          .hover-appt .sub { font-size: 14px; }
          .hover-appt .chips { gap: 4px; }
          .hover-appt .chip { font-size: 12px; padding: 4px 6px; }
          .drag-ghost { left: 4px; right: 4px; min-height: 44px; }
          .off-mask { left: 4px; right: 4px; }
          .col-body .hour { display: block; position: absolute; left: 4px; font-size: 11px; color: #6b7280; transform: translateY(-50%); z-index: 1; }
          .appt { left: 50px; }
          .col-body .hour {
    display: block; /* Show time markers on mobile */
    left: 4px;
    font-size: 11px;
    color: #6b7280;
    transform: translateY(-50%);
    z-index: 1;
  }
        }

        @media (max-width: 480px) {
          .admin-cal { padding: 8px 4px 80px; }
          .cal-bar { gap: 4px; padding: 0 2px; margin-top: 20px; }
          .btn { padding: 10px 8px; font-size: 14px; min-height: 40px; }
          .title { font-size: 15px; }
          .select { min-width: 100px; padding: 10px 8px; }
          .top-actions { gap: 2px; }
          .grid-wrap { gap: 4px; height: calc(100vh - 120px); }
          .col-header { height: 52px; font-size: 12px; }
          .appt { padding: 12px 6px; min-height: 48px; }
          .appt .time { font-size: 10px; }
          .appt .title { font-size: 11px; }
          .appt .muted { font-size: 10px; }
          .chooser-card { margin: 16px; padding: 16px; }
          .hover-appt { width: 95vw; left: 2.5vw !important; bottom: 16px !important; }
          .hover-appt .inner { padding: 12px; }
          .hover-appt .title { font-size: 15px; }
          .hover-appt .sub { font-size: 13px; }
        }

        @media (hover: none) and (pointer: coarse) {
          .btn, .select, .appt { min-height: 44px; }
          .col-header { min-height: 48px; }
          .appt { touch-action: manipulation; }
          .hover-line, .hover-badge { display: none; }
          .resize-handle { height: 16px; }
          .resize-handle:before { height: 4px; width: 32px; }
        }

        @media (max-width: 900px) and (orientation: landscape) {
          .grid-wrap { height: calc(100vh - 100px); }
          .cal-bar { margin-bottom: 8px; margin-top: 20px; }
          .title { font-size: 14px; }
        }

        @media (max-width: 900px) and (-webkit-min-device-pixel-ratio: 1) {
          .appt { min-height: 48px; }
        }

        @supports (-webkit-touch-callout: none) {
          .appt { -webkit-touch-callout: none; -webkit-user-select: none; }
          .col-body { -webkit-overflow-scrolling: touch; }
        }
          .admin-cal input,
.admin-cal select,
.admin-cal button,
.admin-cal .hour,
.admin-cal .col-header,
.admin-cal .appt,
.admin-cal .muted {
  color: #1f1f1f !important;
  -webkit-text-fill-color: #1f1f1f !important; /* iOS fix */
}
      `}</style>

      <div className="admin-cal">
        <div className="cal-bar">
          <button className="btn" onClick={()=>setDay(d=>{const x=new Date(d); x.setDate(x.getDate()-1); return startOfDay(x);})}>◀</button>
          <button className="btn" onClick={()=>setDay(startOfDay(new Date()))}>Danas</button>
          <button className="btn" onClick={()=>setDay(d=>{const x=new Date(d); x.setDate(x.getDate()+1); return startOfDay(x);})}>▶</button>

          <input 
            type="date" 
            className="select" 
            value={dateToInputValue(dayStart)} 
            onChange={e => {
              const v = e.target.value; 
              if (v) { 
                const next = new Date(v + "T00:00:00"); 
                setDay(startOfDay(next)); 
              }
            }}
          />
          
          <div className="title">
            {dayStart.toLocaleDateString("sr-RS",{
              weekday:"long", 
              day:"2-digit", 
              month:"long", 
              year:"numeric"
            })}
          </div>

          <div className="top-actions">
            {showEmployeeFilter && (
              <select 
                className="select" 
                value={employeeFilter} 
                onChange={e=>setEmployeeFilter(e.target.value)}
              >
                <option value="all">Sve radnice</option>
                {(employees||[]).map(e=>(
                  <option key={e.username} value={e.username}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="grid-wrap" ref={gridWrapRef}>
          {/* timeline levo */}
          <div className="timeline" style={{ height: paneH }}>
            <div className="timeline-inner">
              <div className="timeline-header" />
              <div className="timeline-viewport" style={{height: paneH - HEADER_H}}>
                <div className="timeline-body" style={{ transform: `translateY(${-scrollY}px)` }}>
                  {Array.from({length:(DAY_END_MIN-DAY_START_MIN)/60+1}).map((_,i)=>{
                    const m=DAY_START_MIN+i*60; 
                    const y=yFromMinutes(m); 
                    const hh=String(Math.floor(m/60)).padStart(2,"0");
                    return (
                      <React.Fragment key={m}>
                        <div className="line" style={{top:y}} />
                        <div className="hour" style={{top:y}}>{hh}:00</div>
                      </React.Fragment>
                    );
                  })}
                  {isSameDay(dayStart, new Date()) && (
                    <div className="now-line-left" style={{ top: yFromMinutes(nowMinAbs) }} />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* kolone desno */}
          <div 
            className="columns-outer" 
            ref={columnsOuterRef} 
            onScroll={handleColumnsScroll} 
            style={{ height: paneH }}
          >
            <div className="columns">
              {visibleEmployees.map(emp=>{
                const list=apptsByEmployee.get(emp.username)||[];
                return (
                  <div
                    key={emp.username}
                    className="col"
                    onMouseMove={(e)=>handleColumnMove(e, emp.username)}
                    onMouseLeave={()=>{ 
                      handleColumnLeave(); 
                      setHoverAppt(null); 
                    }}
                    onClick={(e)=>handleColumnClick(e, emp.username)}
                  >
                    <div className="col-header">
                      {emp.firstName} {emp.lastName}
                    </div>
                    <div
                      className="col-body"
                      ref={el=>{
                        if (el) colBodyRefs.current.set(emp.username, el);
                        else colBodyRefs.current.delete(emp.username);
                      }}
                    >
                      {Array.from({length:(DAY_END_MIN-DAY_START_MIN)/60+1}).map((_,i)=>{
                        const m=DAY_START_MIN+i*60; 
                        const y=yFromMinutes(m);
                        const hh=String(Math.floor(m/60)).padStart(2,"0");
                        return (
                          <React.Fragment key={`g-${m}`}>
                            <div className="grid-hour" style={{ top:y }} />
                            <div className="hour" style={{ top:y, display: "none" }}>{hh}:00</div>
                          </React.Fragment>
                        );
                      })}

                      {/* off maske */}
                      {(() => {
                        const work = getWorkIntervalsFor(emp.username, dayStart, latestSchedules);
                        const off = getOffIntervals(work);
                        return off.map(([s,e], idx) => {
                          const top = yFromMinutes(Math.max(DAY_START_MIN, s));
                          const h = (Math.min(DAY_END_MIN, e) - Math.max(DAY_START_MIN, s)) * PX_PER_MIN;
                          return (
                            <div 
                              key={`off-${idx}`} 
                              className="off-mask" 
                              style={{ top, height:h }} 
                            />
                          );
                        });
                      })()}

                      {showNow && (
                        <div className="now-line-global" style={{ top: yFromMinutes(nowMinAbs) }} />
                      )}

                      {hover.show && hover.emp===emp.username && (
                        <div className="hover-line" style={{ top: hover.top }}>
                          <div className="hover-badge">{hover.text}</div>
                        </div>
                      )}

                      {/* drag ghost */}
                      {dragGhost && dragGhost.emp===emp.username && (() => {
                        const gTop = yFromMinutes(dragGhost.topMin);
                        const d = draggingRef.current;
                        const h = (d ? d.durationMin : 30) * PX_PER_MIN - 2;
                        return (
                          <div 
                            className="drag-ghost" 
                            style={{ top: gTop, height: Math.max(18, h)} } 
                          />
                        );
                      })()}

                      {list.map(a=>{
                        const startMin = Math.max(DAY_START_MIN, minsInDay(a.start, dayStart));
                        const actualEndMin = Math.min(DAY_END_MIN, minsInDay(a.end, dayStart));
                        const endMin = (overrideEndMap.get(a.id) ?? tempEndMap.get(a.id) ?? actualEndMin);
                        const top = yFromMinutes(startMin);
                        const height=Math.max(18,(endMin-startMin)*PX_PER_MIN-2);

                        const client=(clients||[]).filter(Boolean).find(c=>c.id===a.clientId);

                        // normalizovane usluge (radi i za id stringove i za objekte)
                        const items = normalizeServices(a, services);
                        const total = (a.totalAmountRsd ?? a.priceRsd ?? 0) || items.reduce((sum,s)=>sum + (Number(s.priceRsd)||0),0);
                        const col = apptColorFrom(items, categoriesMap);

                        const isBlock=a.type==="block";
                        const isPaid=!!a.paid;

                        // heuristike za prikaz ikonica (radi i sa starijim zapisima)
                        const isOnline = a.isOnline || a.bookedVia === "public_app" || a.source === "online" || a.createdBy === "public";
                        const pickedSpecific = a.pickedMode === "specific" || a.pickedEmployee === true;

                        const placeHover = (ev)=>{
                          const padding = 16; 
                          const estW = 320, estH = 190;
                          let left = ev.clientX + 12; 
                          let topPx = ev.clientY + 12;
                          if (left + estW + padding > window.innerWidth) 
                            left = window.innerWidth - estW - padding;
                          if (topPx + estH + padding > window.innerHeight) 
                            topPx = window.innerHeight - estH - padding;
                          setHoverAppt({ appt:a, left, top: topPx });
                        };

                        return (
                          <div
                            key={a.id}
                            className={`appt ${isBlock?"block":""} ${isPaid && canSeePayment?"paid":""}`}
                            style={{ top, height, '--col': col }}
                            onMouseDown={(ev)=>!isBlock && startDrag(ev, a, top)}
                            onTouchStart={(ev)=>!isBlock && startDrag(ev, a, top)}
                            onClick={(ev)=>{ 
                              ev.stopPropagation(); 
                              if (justResizedRef.current || justDraggedRef.current) return; 
                              setHoverAppt(null); 
                              openEdit(a); 
                            }}
                            onMouseEnter={placeHover}
                            onMouseMove={placeHover}
                            onMouseLeave={()=>setHoverAppt(null)}
                          >
                            <div className="time">
                              {fmtTime(a.start)}–{(() => { 
                                const d=new Date(dayStart); 
                                d.setMinutes(endMin); 
                                return fmtTime(d); 
                              })()}
                            </div>

                            {/* Ugao sa ikonama: online, specific, plaćanje */}
                            <div className="corner-icons">
                              {isOnline && <span title="Online rezervacija">💬</span>}
                              {pickedSpecific && <span title="Klijent je izabrao konkretnu radnicu">❤️</span>}
                              {canSeePayment && a.paid === "card" && <span title="Plaćeno karticom">💳</span>}
                              {canSeePayment && a.paid === "cash" && <span title="Plaćeno kešom">💵</span>}
                              {canSeePayment && a.paid === "bank" && <span title="Plaćeno uplatom na račun">🏦</span>}
                            </div>

                            {isBlock ? (
                              <>
                                <div className="title">Blokirano vreme</div>
                                {a.note && <div className="muted">📝 {a.note}</div>}
                                <span className="tag">Blokada</span>
                              </>
                            ) : (
                              <>
                                <div className="title">
                                  {client ? formatClient(client, role) : "—"}
                                </div>
                                <div className="muted">
                                  {items.map(s=>s.name).join(", ") || a.servicesLabel || "—"} 
                                  {total?` · ${fmtPrice(total)} RSD`:""}
                                </div>
                                {a.noShow && (
                                  <span 
                                    className="tag" 
                                    style={{borderColor:"#ef4444",color:"#ef4444",background:"#fff"}}
                                  >
                                    NO-SHOW
                                  </span>
                                )}
                                {a.note && <span className="tag">📝 {a.note}</span>}
                              </>
                            )}

                            {!isBlock && (
                              <div 
                                className="resize-handle" 
                                title="Povuci za skraćivanje/produžavanje" 
                                onMouseDown={(e)=>startResize(e,a)}
                                onTouchStart={(e)=>startResize(e,a)} 
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Izbor: Termin ili Blokada */}
        {chooser.open && (
          <div 
            className="chooser-backdrop" 
            onClick={()=>setChooser({open:false,start:null,emp:null})}
          >
            <div className="chooser-card" onClick={(e)=>e.stopPropagation()}>
              <div className="chooser-title">
                Šta želiš da dodaš u {fmtTime(chooser.start)}?
              </div>
              <div className="chooser-actions">
                <button 
                  className="btn-dark" 
                  onClick={()=>{ 
                    openCreateAt(chooser.start, chooser.emp); 
                    setChooser({open:false,start:null,emp:null}); 
                  }}
                >
                  Termin
                </button>
                <button 
                  className="btn-ghost" 
                  onClick={()=>{ 
                    openBlock(chooser.emp, chooser.start); 
                    setChooser({open:false,start:null,emp:null}); 
                  }}
                >
                  Blokada
                </button>
              </div>
            </div>
          </div>
        )}

        {open && (
          <CalendarEventModal
            role={role === "worker" ? "worker" : role === "salon" ? "salon" : "admin"}
            value={modalValue}
            employees={role==="worker" ? (employees||[]).filter(e=>e.username===currentUsername) : (employees||[])}
            services={services||[]}
            clients={clients||[]}
            categoriesMap={categoriesMap||new Map()}
            onClose={()=>setOpen(false)}
            onSaved={()=>setOpen(false)}
            onDelete={(id)=>handleDelete(id)}
          />
        )}

        {/* Hover kartica */}
        {hoverAppt && (()=> {
          const a = hoverAppt.appt;
          const client = (clients||[]).filter(Boolean).find(c=>c.id===a.clientId);
          const items = normalizeServices(a, services);
          const total = (a.totalAmountRsd ?? a.priceRsd ?? 0) || items.reduce((sum,s)=>sum + (Number(s.priceRsd)||0),0);
          const emp = (employees||[]).find(e=>e.username===a.employeeUsername);
          const catColor = apptColorFrom(items, categoriesMap);

          const isOnline = a.isOnline || a.bookedVia === "public_app" || a.source === "online" || a.createdBy === "public";
          const pickedSpecific = a.pickedMode === "specific" || a.pickedEmployee === true;

          return (
            <div className="hover-appt" style={{ left: hoverAppt.left, top: hoverAppt.top }}>
              <div className="stripe" style={{ background: catColor }} />
              <div className="inner">
                <div className="time">{fmtTime(a.start)} – {fmtTime(a.end)}</div>
                <div className="title">{client ? formatClient(client, role) : "—"}</div>
                <div className="sub">
                  {client ? (
                    role==="admin" ? 
                      (client.phone ? `📞 ${client.phone}` : "") : 
                      (client.phone ? `📞 ***${client.phone.toString().replace(/\D/g,"").slice(-3)}` : "")
                  ) : ""}
                  {emp ? `  ·  👩‍💼 ${emp.firstName} ${emp.lastName}` : ""}
                </div>
                <div className="sub">
                  {items.map(s=>s.name).join(", ") || a.servicesLabel || "—"}
                  {items?.length ? ` · ${items.length} usl.` : ""}
                </div>
                <div className="chips">
                  {a.source && (
                    <span className="chip">
                      {a.source === "manual" ? "Zakazano: admin" : "Zakazano: online"}
                    </span>
                  )}
                  {isOnline && <span className="chip">Online rezervacija 💬</span>}
                  {pickedSpecific && <span className="chip">Izabrana radnica ❤️</span>}
                  {canSeePayment && a.paid === "card" && (
                    <span className="chip">Plaćeno karticom</span>
                  )}
                  {canSeePayment && a.paid === "cash" && (
                    <span className="chip">Plaćeno kešom</span>
                  )}
                  {canSeePayment && a.paid === "bank" && (
                    <span className="chip">Plaćeno uplatom na račun</span>
                  )}
                  {a.noShow && (
                    <span 
                      className="chip" 
                      style={{borderColor:"#ef4444", color:"#ef4444", background:"#fff"}}
                    >
                      NO-SHOW
                    </span>
                  )}
                </div>
                <div className="price">RSD {fmtPrice(total)}</div>
                {(client?.note || a.note) && <div className="hr" />}
                {client?.note && (
                  <div className="note-row" style={{marginTop:2}}>
                    <div className="note-ico">🗒️</div>
                    <div className="note-text">
                      <b>Beleška klijenta:</b> {client.note}
                    </div>
                  </div>
                )}
                {a.note && (
                  <div className="note-row" style={{marginTop: client?.note ? 6 : 2}}>
                    <div className="note-ico">✍️</div>
                    <div className="note-text">
                      <b>Beleška termina:</b> {a.note}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}