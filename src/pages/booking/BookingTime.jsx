// src/pages/booking/BookingTime.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection, onSnapshot, query, orderBy, where,
  addDoc, serverTimestamp, getDocs, setDoc, doc
} from "firebase/firestore";
import { db } from "../../firebase";

/* ---------- Salon sati (1=pon .. 7=ned) ---------- */
const SALON_HOURS = {
  1:[{start:"09:00",end:"20:00"}],
  2:[{start:"09:00",end:"20:00"}],
  3:[{start:"09:00",end:"20:00"}],
  4:[{start:"09:00",end:"20:00"}],
  5:[{start:"09:00",end:"20:00"}],
  6:[{start:"09:00",end:"16:00"}],
  7:[]
};

const MIN_STEP = 60;

/* ---------- Utils ---------- */
const toHM = s => { const [h,m]=String(s||"").split(":").map(Number); return {h:h||0,m:m||0}; };
const setHM = (d,{h,m}) => { const x=new Date(d); x.setHours(h,m,0,0); return x; };
const addMin = (d, m) => { const x=new Date(d); x.setMinutes(x.getMinutes()+m); return x; };
const cmpHM = (a,b)=>{ const A=toHM(a),B=toHM(b); return A.h!==B.h?A.h-B.h:A.m-B.m; };
const maxHM = (a,b)=> cmpHM(a,b)>=0?a:b;
const minHM = (a,b)=> cmpHM(a,b)<=0?a:b;
const wd1to7 = d => (d.getDay()===0?7:d.getDay());
const dayKey = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;  // npr "2025-12-05"
};
const hhmm = d => d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", hour12: false });
const nice = (d, o={}) => d.toLocaleString("sr-RS", o);
const niceDate = d => d.toLocaleDateString("sr-RS",{weekday:"short", day:"2-digit", month:"2-digit", year:"numeric"});

// “danas” pomoćnici
const startOfToday = ()=>{ const x=new Date(); x.setHours(0,0,0,0); return x; };
const isSameDay = (a,b) => dayKey(a)===dayKey(b);

// minute helpers
const mOf = d => d.getHours()*60 + d.getMinutes();
const hmToMin = (hm)=>{ const {h,m}=toHM(hm); return h*60+m; };
const iv = (s,e)=>({start:s,end:e}); // interval u minutima

// --- BRZI FETCH zauzeća za više radnika odjednom (batch-uje po 10) ---
async function loadBusyMap(day, usernames) {
  if (!usernames?.length) return new Map();

  const s = new Date(day); s.setHours(0,0,0,0);
  const e = new Date(day); e.setHours(23,59,59,999);

  const chunks = [];
  for (let i = 0; i < usernames.length; i += 10) {
    chunks.push(usernames.slice(i, i + 10));
  }

  const map = new Map();
  for (const batch of chunks) {
    const qAp = query(
      collection(db, "appointments"),
      where("employeeUsername", "in", batch),
      where("start", ">=", s),
      where("start", "<=", e),
      orderBy("start", "asc")
    );
    const snap = await getDocs(qAp);
    snap.forEach(d => {
      const a = d.data();
      const u = a.employeeUsername;
      const st = a.start?.toDate?.() || new Date(a.start);
      const en = a.end?.toDate?.()   || new Date(a.end);
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(iv(mOf(st), mOf(en)));
    });
  }
  return map;
}


function* iterDays(from,count){ const x=new Date(from); x.setHours(0,0,0,0); for(let i=0;i<count;i++){ yield new Date(x); x.setDate(x.getDate()+1);} }
function intersectIntervals(a,b){
  const out=[];
  for(const ia of a) for(const ib of b){
    const s=maxHM(ia.start,ib.start), e=minHM(ia.end,ib.end);
    if (cmpHM(s,e)<0) out.push({start:s,end:e});
  }
  return out;
}
function slotsForIntervals(dayDate, intervals, durationMin){
  const res=[];
  for(const seg of intervals){
    let cur=setHM(dayDate,toHM(seg.start));
    const hardEnd=setHM(dayDate,toHM(seg.end));
    while(true){
      const until=addMin(cur,durationMin);
      if (until>hardEnd) break;
      res.push({start:new Date(cur), end:until});
      cur=addMin(cur,MIN_STEP);
    }
  }
  return res;
}

// oduzimanje zauzetih intervala od slobodnih (sve u minutima)
function subtractIntervals(freeMins, busyMins){
  let res = [...freeMins];
  for (const b of busyMins){
    const next = [];
    for (const f of res){
      if (b.end <= f.start || b.start >= f.end){ next.push(f); continue; }
      if (b.start > f.start) next.push(iv(f.start, Math.max(f.start, b.start)));
      if (b.end   < f.end)   next.push(iv(Math.min(f.end, b.end), f.end));
    }
    res = next;
  }
  return res;
}
function slotsFromMinuteIntervals(dayDate, minuteIntervals, durationMin){
  const out=[];
  for (const seg of minuteIntervals){
    for (let s=seg.start; s+durationMin<=seg.end; s+=MIN_STEP){
      const start = new Date(dayDate);
      start.setHours(0,0,0,0);
      start.setMinutes(s);
      const end = new Date(start);
      end.setMinutes(start.getMinutes() + durationMin); // ✅ ISPRAVKA
      out.push({ start, end });
    }
  }
  return out;
}


/* ---------- Pattern/schedule helpers ---------- */
const PATTERN_WEEKS = {"1w":1,"2w":2,"3w":3,"4w":4};
const jsDayToIdx = d => (d.getDay()+6)%7; // Mon=0
function pickDayFromSchedule(sched, date){
  if (!sched) return null;

  // 🔹 1) prvo proveri da li postoji override za TAČAN dan
  const key = dayKey(date);            // npr. "2025-12-05"
  const ov  = sched.overrides && sched.overrides[key];
  if (ov) {
    // ako ima override – on je jači od šablona
    return {
      from:   ov.from   || "",
      to:     ov.to     || "",
      closed: !!ov.closed,
    };
  }

  // 🔹 2) ako nema override → koristi postojeću logiku sa pattern-om
  if (!sched.startDate) return null;

  const start = new Date(sched.startDate);
  start.setHours(0,0,0,0);

  const cur = new Date(date);
  cur.setHours(0,0,0,0);

  if (sched.endDate){
    const end=new Date(sched.endDate);
    end.setHours(23,59,59,999);
    if (cur > end) return null;
  }
  if (cur < start) return null;

  const diffDays = Math.floor((cur - start) / (24*3600*1000));
  const totalWeeks = PATTERN_WEEKS[sched.pattern] || 1;
  const weekIdx = (Math.floor(diffDays/7)) % totalWeeks;

  const dayIdx = jsDayToIdx(cur);
  const weekArr = sched.weeks?.[String(weekIdx)] || [];
  const day = weekArr[dayIdx];
  if (!day) return null;

  return { from: day.from || "", to: day.to || "", closed: !!day.closed };
}
/* ---------- Skill helpers ---------- */
function canEmployeeDo(service, employee){
  if (!employee) return true; // "Prvi dostupan" – ne filtriramo
  const sids = Array.isArray(employee.serviceId) ? employee.serviceId : Array.isArray(employee.serviceIds) ? employee.serviceIds : [];
  const cids = Array.isArray(employee.categoryIds) ? employee.categoryIds : [];
  const sid = service?.serviceId || service?.id || null;
  const cid = service?.categoryId || null;
  if (sids.length || cids.length){
    if (sid && sids.includes(sid)) return true;
    if (cid && cids.includes(cid)) return true;
    return false;
  }
  return false; // bez podešenih dozvola – ne dopuštamo
}

/* ---------- Toast helper ---------- */
function uid(){ return Math.random().toString(36).slice(2); }

/* ---------- Client helpers ---------- */
function getLoggedClient(){
  try{
    const raw = localStorage.getItem("clientProfile");
    if (raw){
      const p = JSON.parse(raw);
      const fullName = `${p.firstName||""} ${p.lastName||""}`.trim();
      return { id: p.id || null, name: fullName, phone: p.phone || "", email: p.email || "" };
    }
    const id    = localStorage.getItem("clientId")   || localStorage.getItem("userId") || null;
    const name  = localStorage.getItem("clientName") || localStorage.getItem("displayName") || "";
    const phone = localStorage.getItem("clientPhone")|| localStorage.getItem("phone") || "";
    const email = localStorage.getItem("clientEmail")|| localStorage.getItem("email") || "";
    return { id, name, phone, email };
  }catch{ return { id:null, name:"", phone:"", email:"" }; }
}
function getCartKey(){
  try{
    const raw = localStorage.getItem("clientProfile");
    const p = raw ? JSON.parse(raw) : null;
    return `bookingCart:${p?.id || "anon"}`;
  }catch{
    return "bookingCart:anon";
  }
}
function splitName(full = "") {
  const parts = String(full || "").trim().split(/\s+/);
  const first = parts.shift() || "";
  const last  = parts.join(" ");
  return { first, last };
}

export default function BookingTime(){
  const nav = useNavigate();
  const { state } = useLocation();
  const chosenEmployeeId = state?.employee || "firstFree";
  const client = useMemo(()=>getLoggedClient(),[]);

  const today0 = startOfToday();
  /* ✅ OGRANIČENJE: poslednji dozvoljeni dan za izbor (danas + 14 dana, uključivo) */
  const maxDate = useMemo(() => {
    const x = new Date(today0);
    x.setDate(x.getDate() + 7); // poslednji dozvoljeni dan
    return x;
  }, [today0]);

  // 1) Usluge iz korpe (vezano za korisnika) + migracija sa starog ključa
  const [cart, setCart] = useState(()=>{
    try{
      const key = getCartKey();
      const perUser = localStorage.getItem(key);
      if (perUser) return JSON.parse(perUser);
      const legacy = localStorage.getItem("bookingCart");
      if (legacy){
        localStorage.setItem(key, legacy);
        localStorage.removeItem("bookingCart");
        return JSON.parse(legacy);
      }
      return [];
    }catch{ return []; }
  });

  // 2) Employees + najnovije smene po useru
  const [employees,setEmployees]=useState([]);
 useEffect(() => {
  const qEmps = query(collection(db, "employees"), orderBy("username"));
  return onSnapshot(qEmps, snap => {
    setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}, []);

  const [latestByUser, setLatestByUser] = useState({});
  useEffect(()=>{
    const qSch = query(collection(db,"schedules"), orderBy("employeeUsername"), orderBy("createdAt","desc"));
    return onSnapshot(qSch, snap=>{
      const map=new Map();
      for(const d of snap.docs){
        const s=d.data(); const u=s.employeeUsername;
        if(!map.has(u)) map.set(u,{ id:d.id, ...s });
      }
      const obj={}; for(const [k,v] of map.entries()) obj[k]=v;
      setLatestByUser(obj);
    });
  },[]);

  const chosenEmployee = useMemo(
    ()=> employees.find(e=>e.username===chosenEmployeeId) || null,
    [employees, chosenEmployeeId]
  );

  // Default selekcija usluga za ovaj termin
  const [selectedIds, setSelectedIds] = useState(()=>{
    if (!cart?.length) return [];
    if (chosenEmployeeId==="firstFree") return cart.map(x=>x.serviceId);
    return cart.filter(s=>canEmployeeDo(s, chosenEmployee)).map(s=>s.serviceId);
  });

  const selectedServices = useMemo(
    ()=> cart.filter(s=>selectedIds.includes(s.serviceId)),
    [cart, selectedIds]
  );
  const remainingServices = useMemo(
    ()=> cart.filter(s=>!selectedIds.includes(s.serviceId)),
    [cart, selectedIds]
  );

  const totalDurationMin = selectedServices.reduce((a,b)=>a+(Number(b.durationMin)||0),0);
  const totalAmountRsd    = selectedServices.reduce((a,b)=>a+(Number(b.priceRsd)||0),0);

  // 3) Kalendar state
  const startOfMonth = (d)=>new Date(d.getFullYear(), d.getMonth(), 1);
  const [anchor, setAnchor] = useState(()=> startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(()=> new Date());

  const daysInMonth = useMemo(()=>{
  const first = startOfMonth(anchor);
  const arr = [];
  for (const d of iterDays(first, 40)) {
    if (d.getMonth() !== anchor.getMonth()) continue;
    arr.push(d);                       // ✅ prikaži ceo mesec
  }
  return arr;
}, [anchor]);


  // Prev/Next ograničenja za mesece
  const canGoPrev = useMemo(()=>{
    return startOfMonth(anchor) > startOfMonth(today0);
  }, [anchor, today0]);

  const canGoNext = useMemo(()=>{
    const nextStart = new Date(anchor.getFullYear(), anchor.getMonth()+1, 1);
    return nextStart <= maxDate; // ne dozvoli skok u mesec koji počinje posle maxDate
  }, [anchor, maxDate]);

  /* ---------- Busy map po radnici za izabrani dan ---------- */
  const [busyByEmp, setBusyByEmp] = useState(new Map());
  useEffect(()=>{
    // Ako je izabrani dan izvan dozvoljenog opsega, ne otvaraj subscribe
    if (selectedDay < today0 || selectedDay > maxDate) {
      setBusyByEmp(new Map());
      return;
    }

    const s = new Date(selectedDay); s.setHours(0,0,0,0);
    const e = new Date(selectedDay); e.setHours(23,59,59,999);

    const targets = (chosenEmployeeId==="firstFree")
      ? employees.map(x=>x.username)
      : [chosenEmployeeId];

    const unsubs = targets.map(u=>{
      const qAp = query(
        collection(db, "appointments"),
        where("employeeUsername","==", u),
        where("start",">=", s),
        where("start","<=", e),
        orderBy("start","asc")
      );
      return onSnapshot(qAp, snap=>{
        const busy = [];
        snap.forEach(doc=>{
          const a = doc.data();
          const st = a.start?.toDate?.() || new Date(a.start);
          const en = a.end?.toDate?.()   || new Date(a.end);
          busy.push(iv(mOf(st), mOf(en)));
        });
        setBusyByEmp(prev=>{ const nm=new Map(prev); nm.set(u, busy); return nm; });
      });
    });

    return ()=> unsubs.forEach(u=>u && u());
  },[selectedDay, chosenEmployeeId, employees, today0, maxDate]);

  function employeeCanDoAll(services, employee){
    return services.every(s => canEmployeeDo(s, employee));
  }

  // 4) Slotovi za selektovani dan (bez preklapanja) + FILTAR PROŠLOSTI + ❗filtar na 2 nedelje
  const { slots, anyWork } = useMemo(() => { 
    const d = selectedDay;

    if (d < today0 || d > maxDate) {
  return { slots: [], anyWork: false };
}

    const salon = SALON_HOURS[wd1to7(d)] || [];
    if (!salon.length || !totalDurationMin) {
  return { slots: [], anyWork: false };
}

    function freeForEmp(empUsername, dayCfg){
      const base = intersectIntervals(salon, [{start:dayCfg.from, end:dayCfg.to}])
        .map(r => iv(hmToMin(r.start), hmToMin(r.end)));
      const busy = busyByEmp.get(empUsername) || [];
      const free = subtractIntervals(base, busy);
      return slotsFromMinuteIntervals(d, free, totalDurationMin);
    }

    let resultSlots=[]; let anyWork=false;

    if (chosenEmployeeId !== "firstFree"){
      const sched = latestByUser[chosenEmployeeId];
      const day   = pickDayFromSchedule(sched, d);
     if (!day || day.closed) return { slots: [], anyWork: false };
      resultSlots = freeForEmp(chosenEmployeeId, day);
      anyWork = true;
    } else {
      const all=[];
      for (const e of employees){
        if (!employeeCanDoAll(selectedServices, e)) continue;
        const sched = latestByUser[e.username];
        const day   = pickDayFromSchedule(sched, d);
        if (!day || day.closed) continue;
        anyWork=true;
        const ss = freeForEmp(e.username, day).map(s=>({...s, employeeId:e.username}));
        all.push(...ss);
      }
      all.sort((a,b)=>a.start-b.start);
      resultSlots = all;
    }

 if (isSameDay(d, today0)) {
  const now = new Date();
  const resultImm = resultSlots.filter(s => s.start >= now);
  return { slots: resultImm, anyWork };
}

return { slots: resultSlots, anyWork };

  },[selectedDay, chosenEmployeeId, employees, latestByUser, totalDurationMin, busyByEmp, selectedServices, today0, maxDate]);

  /* ---------- Toasts ---------- */
  const [toasts, setToasts] = useState([]); // {id, text}
  function pushToast(text){
    const id = uid();
    setToasts(ts=>[...ts, {id, text}]);
    setTimeout(()=>setToasts(ts=>ts.filter(t=>t.id!==id)), 2600);
  }

  /* ---------- Gatekeeper helpers ---------- */
  function splitByCanDo(list, employee){
    const doable=[], notDoable=[];
    for (const s of list){
      (canDoEmployee(s, employee) ? doable : notDoable).push(s);
    }
    return { doable, notDoable };
  }
  function canDoEmployee(s, employee){ return canEmployeeDo(s, employee); }

  // LEP MODAL (umesto window.confirm)
  const [mismatch, setMismatch] = useState({
    open:false,
    doable:[],
    notDoable:[],
    proceedCb:null,
    backCb:null
  });

  function ensureValidSelectionForEmployee(cb){
    if (chosenEmployeeId === "firstFree" || !chosenEmployee) { cb(); return; }
    const { doable, notDoable } = splitByCanDo(selectedServices, chosenEmployee);
    if (notDoable.length === 0) { cb(); return; }
    if (doable.length === 0){
      setMismatch({
        open:true, doable, notDoable,
        proceedCb:null,
        backCb:()=>nav("/booking/employee", { state:{ reason:"employee-does-not-do-selected-services" } })
      });
      return;
    }
    setMismatch({
      open:true, doable, notDoable,
      proceedCb:()=>{
        setSelectedIds(doable.map(s=>s.serviceId));
        pushToast("Nastavljam samo sa uslugama koje ova radnica radi.");
        cb();
      },
      backCb:()=>nav("/booking/employee", { state:{ reason:"pick-employee-for-remaining" } })
    });
  }

  // ✅ proveri i pokaži mismatch modal za KONKRETNOG employeeUsername (u "firstFree" toku)
  function ensureValidForEmployeeUsername(empUsername, cb){
    const emp = employees.find(e => e.username === empUsername);
    if (!emp) { cb(); return; }
    const { doable, notDoable } = splitByCanDo(selectedServices, emp);
    if (notDoable.length === 0) { cb(); return; }
    if (doable.length === 0){
      setMismatch({
        open:true, doable, notDoable,
        proceedCb:null,
        backCb:()=>{}
      });
      return;
    }
    setMismatch({
      open:true, doable, notDoable,
      proceedCb:()=>{
        setSelectedIds(doable.map(s=>s.serviceId));
        pushToast("Nastavljam samo sa uslugama koje ova radnica radi.");
        cb();
      },
      backCb:()=>nav("/booking/employee", { state:{ reason:"pick-employee-for-remaining" } })
    });
  }

  /* ---------- Confirm sheet ---------- */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmData, setConfirmData] = useState(null); // {start,end, employeeId}
  const [saving, setSaving] = useState(false);

  function pickSlot(opt){
    if (opt?.start < new Date()){
      pushToast("Ne možeš izabrati vreme u prošlosti.");
      return;
    }
    // ❗ Dodatna zaštita na gornju granicu
    const endOfMax = new Date(maxDate); endOfMax.setHours(23,59,59,999);
    if (opt?.start > endOfMax) {
      pushToast("Zakazivanje je moguće najviše 14 dana unapred.");
      return;
    }
    if (!selectedServices.length){
      pushToast("Izaberi bar jednu uslugu koju zakazuješ sada.");
      return;
    }

    // Ako je "firstFree" — validiraj baš za radnicu koja je vlasnik izabranog slota
    if (chosenEmployeeId === "firstFree" && opt?.employeeId){
      ensureValidForEmployeeUsername(opt.employeeId, () => {
        const employeeId = opt.employeeId;
        setConfirmData({ start: opt.start, end: opt.end, employeeId });
        setConfirmOpen(true);
        pushToast(`Termin izabran: ${niceDate(opt.start)} u ${hhmm(opt.start)}`);
        const e = employees.find(x=>x.username===employeeId);
        pushToast(`Dodeljen: ${e ? (e.firstName||e.username) : "zaposleni"}`);
      });
      return;
    }

    // Inače (konkretno izabran zaposleni)
    ensureValidSelectionForEmployee(() => {
      const employeeId = chosenEmployeeId;
      setConfirmData({ start: opt.start, end: opt.end, employeeId });
      setConfirmOpen(true);
      pushToast(`Termin izabran: ${niceDate(opt.start)} u ${hhmm(opt.start)}`);
      if (chosenEmployee) {
        pushToast(`Radnik: ${`${chosenEmployee.firstName||""} ${chosenEmployee.lastName||""}`.trim() || chosenEmployee.username}`);
      }
    });
  }

  // grupisanje usluga po kategoriji (više kartica po terminu)
  function groupServicesByCategory(list){
    const map = new Map();
    for (const s of list){
      const key = s.categoryId || "nocat";
      if (!map.has(key)) map.set(key, { categoryId: key, categoryName: s.categoryName || null, services: [] });
      map.get(key).services.push(s);
    }
    return Array.from(map.values());
  }

  // proveri konflikt pre upisa
  async function hasConflict(empUsername, start, end){
    const qConf = query(
      collection(db,"appointments"),
      where("employeeUsername","==", empUsername),
      where("start","<", end),
      where("end",">", start)
    );
    const snap = await getDocs(qConf);
    return !snap.empty;
  }

  async function confirmBooking(){
    if (!confirmData) return;

    // hard guard za opseg datuma
    const endOfMax = new Date(maxDate); endOfMax.setHours(23,59,59,999);
    if (confirmData.start < new Date() || confirmData.start > endOfMax){
      pushToast("Vreme za ovaj termin više nije dostupno.");
      setConfirmOpen(false);
      return;
    }

    // hard guard za skill
    if (confirmData.employeeId){
      const emp = employees.find(e => e.username === confirmData.employeeId);
      if (!selectedServices.every(s=>canEmployeeDo(s, emp))) {
        pushToast("Ova radnica ne radi sve izabrane usluge. Izaberi drugu ili smanji izbor.");
        setConfirmOpen(false);
        return;
      }
    }

    try{
      setSaving(true);

      // ✅ izračunaj jednom, koristi svuda
      const safeClientName =
        (client.name && client.name.trim()) ||
        (client.phone && String(client.phone).trim()) ||
        (client.email && String(client.email).trim()) ||
        "";

      const { first: firstName, last: lastName } = splitName(safeClientName);

      // --- Klijent upsert ---
      let clientId = client?.id || null;
      let foundId = null;

      if (!clientId && client.phone){
        const q1 = query(collection(db, "clients"), where("phone", "==", client.phone));
        const s1 = await getDocs(q1);
        if (!s1.empty) foundId = s1.docs[0].id;
      }
      if (!foundId && !clientId && client.email){
        const q2 = query(collection(db, "clients"), where("email", "==", client.email));
        const s2 = await getDocs(q2);
        if (!s2.empty) foundId = s2.docs[0].id;
      }
      if (!foundId && !clientId){
        const cref = await addDoc(collection(db,"clients"),{
          firstName: firstName,
          lastName:  lastName,
          displayName: safeClientName,
          phone: client.phone || "",
          email: (client.email || "").toLowerCase(),
          createdAt: serverTimestamp(),
          source: "public_app"
        });
        foundId = cref.id;
      }

      clientId = clientId || foundId;

      if (clientId){
        await setDoc(
          doc(db,"clients", clientId),
          {
            firstName: firstName,
            lastName:  lastName,
            displayName: safeClientName,
            phone: client.phone || "",
            email: (client.email || "").toLowerCase(),
            updatedAt: serverTimestamp()
          },
          { merge:true }
        );
      }

      const groups = groupServicesByCategory(selectedServices);
      let rollingStart = new Date(confirmData.start);
      const createdIds = [];

      for (let i=0;i<groups.length;i++){
        const g = groups[i];
        const gDuration = g.services.reduce((a,b)=>a+(Number(b.durationMin)||0),0);
        const gAmount   = g.services.reduce((a,b)=>a+(Number(b.priceRsd)||0),0);
        const gEnd      = addMin(rollingStart, gDuration);

        // FINAL RACE GUARD
        if (await hasConflict(confirmData.employeeId || "", rollingStart, gEnd)){
          setSaving(false);
          pushToast("Ups, termin je upravo zauzet. Izaberi drugi slobodan.");
          return;
        }

        const names = g.services.map(s => s.name).filter(Boolean);
        const servicesLabel = names.join(", ");
        const servicesFirstName = names[0] || null;

        const ref = await addDoc(collection(db, "appointments"), {
          start: new Date(rollingStart),
          end:   new Date(gEnd),
          date:  dayKey(rollingStart),

          employeeId: confirmData.employeeId || null,
          employeeUsername: confirmData.employeeId || null,

          services: g.services.map(s=>({
            serviceId: s.serviceId,
            name: s.name,
            durationMin: Number(s.durationMin)||0,
            priceRsd: Number(s.priceRsd)||0,
            categoryId: s.categoryId || null,
            categoryName: s.categoryName || null,
          })),
          servicesIds: g.services.map(s => s.serviceId),
          totalDurationMin: gDuration,
          totalAmountRsd:   gAmount,
          priceRsd:         gAmount,

          servicesLabel,
          servicesFirstName,
          servicesCategoryId: g.categoryId,
          servicesCategoryName: g.categoryName || null,
          groupIndex: i+1,
          groupCount: groups.length,

          clientId: clientId || null,
          clientName: safeClientName || "Klijent",

          clientPhone: client.phone || "",
          clientEmail: (client.email || "").toLowerCase(),
          clientPhoneNorm: (client.phone || "").replace(/\D+/g, ""),
          isOnline: true,
          bookedVia: "public_app",

          pickedMode: (chosenEmployeeId==="firstFree") ? "firstFree" : "specific",
          isPaid: false,
          paymentStatus: "unpaid",
          paymentMethod: null,

          status: "booked",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: clientId || "public"
        });

        createdIds.push(ref.id);
        rollingStart = gEnd;
      }

      // Notifikacija (ostavljeno kako već imaš)
      try {
        const emp = employees.find(e => e.username === (confirmData.employeeId || ""));
        const employeeDocId = emp?.id || null;

        const title = "📅 Zakazan termin";
        const body =
          `${safeClientName || "Klijent"} – ` +
          `${(selectedServices[0]?.name || "usluga")}` +
          `${selectedServices.length > 1 ? ` (+${selectedServices.length - 1})` : ""} · ` +
          `${niceDate(confirmData.start)} ${hhmm(confirmData.start)} · ` +
          `${totalAmountRsd.toLocaleString("sr-RS")} RSD`;

        const url = `/admin/kalendar?appointmentId=${createdIds?.[0] || ""}${
          employeeDocId ? `&employeeId=${emp?.username || ""}` : ""
        }`;

        await fetch("/api/sendNotifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "appointment_created",
            title,
            body,
            toRoles: ["admin", "salon"],
            toEmployeeId: employeeDocId,
            data: {
              screen: "/admin/kalendar",
              url,
              appointmentIds: createdIds,
              employeeId: employeeDocId || "",
              employeeUsername: emp?.username || "",
              clientName: client?.name || "",
              startTs: confirmData.start?.getTime?.() ?? null
            }
          })
        });
      } catch { /* no-op */ }

      pushToast(`✅ Rezervacija sačuvana (${createdIds.length} kartica)`);
      setConfirmOpen(false);

      // očisti korpu (po korisniku)
      const remaining = cart.filter(s=>!selectedIds.includes(s.serviceId));
      localStorage.setItem(getCartKey(), JSON.stringify(remaining));
      setCart(remaining);
      setSelectedIds([]);

      if (remaining.length > 0){
        const left = remaining.length;
        pushToast(`Ostala je još ${left} usluga`);
        setTimeout(()=>{ nav("/booking/employee", { state:{ info:`Ostalo za zakazivanje: ${left} usluga` } }); }, 400);
      } else {
        setTimeout(()=>nav("/home"), 2600);
      }

    } catch (err){
      console.error(err);
      pushToast("Greška pri čuvanju rezervacije.");
    } finally {
      setSaving(false);
    }
  }

  // header ime radnice
  const headerName = useMemo(()=>{
    if (chosenEmployeeId==="firstFree") return "Prvi dostupan";
    const e = employees.find(x=>x.username===chosenEmployeeId);
    return e ? `${e.firstName||""} ${e.lastName||""}`.trim() || e.username : chosenEmployeeId;
  },[chosenEmployeeId, employees]);

  // pomoćne funkcije UI
  function toggleSel(id){
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
  }
  function selectAllForEmployee(){
    if (chosenEmployeeId==="firstFree"){
      setSelectedIds(cart.map(s=>s.serviceId));
      pushToast("Sve usluge uključene.");
      return;
    }
    const can = cart.filter(s=>canEmployeeDo(s, chosenEmployee)).map(s=>s.serviceId);
    setSelectedIds(can);
    pushToast("Uključene usluge koje ova radnica radi.");
  }

  return (
    <div className="wrap">
      <style>{`
        :root { color-scheme: light; }
        button, .btn, .btnx, .pill { -webkit-tap-highlight-color: transparent; }
        button:focus, button:active,
        .btn:focus, .btn:active,
        .btnx:focus, .btnx:active,
        .pill:focus, .pill:active { outline:none !important; box-shadow:none !important; }
      .d:focus, .d:active { outline:none !important; box-shadow:none !important; }
        .d:focus-visible { outline:2px solid #111; }
        .wrap{min-height:100dvh;background:#0f0f10;}
        .sheet{background:#fff;min-height:100dvh;border-top-left-radius:22px;border-top-right-radius:22px;padding:16px 14px 120px;}
        .hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
        .back{appearance:none;border:1px solid #eee;background:#fafafa;padding:8px 10px;border-radius:10px;font-weight:700;}
        .title{font-size:26px;font-weight:900;margin:6px 0 4px;}
        .sub{opacity:.7;font-weight:700;margin-bottom:10px;}
        .hero{width:100%;height:140px;border-radius:18px;overflow:hidden;margin:20px 0 10px;}
        .hero img{width:100%;height:100%;object-fit:cover}
        .cal{margin-top:6px;border:1px solid:#eee;border-radius:16px;padding:12px;}
        .cal .mbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
        .btnx{appearance:none;border:1px solid #eee;background:#fafafa;padding:8px 10px;border-radius:10px;font-weight:700;}
        .btnx[disabled]{opacity:.35}
        .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
        .dow{font-size:12px;opacity:.6;text-align:center;margin-bottom:6px}
        .d{aspect-ratio:1; border:1px solid #eee; border-radius:12px; display:flex;align-items:center;justify-content:center; background:#fff; font-weight:900; font-size:16px; color:#111; user-select:none;}
        .d.sel{ outline:2px solid #111; background:#111; color:#fff; border-color:#111; }
        .d.disabled{opacity:.25;pointer-events:none}
        .msg{margin:14px 0;padding:12px;border-radius:12px;background:#fff7f0;border:1px solid #ffe6d2;font-weight:700}
        .slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
        .slot{padding:10px 12px;border:1px solid #eee;border-radius:12px;background:#f7f7f7;font-weight:800}
        .slot.emp{border-style:dashed}
        .res{margin-top:14px;border-top:1px dashed #eee;padding-top:10px}
        .svc{display:flex;justify-content:space-between;align-items:center;padding:6px 0;gap:10px}
        .svc .l{display:flex;align-items:center;gap:10px}
        .chk{width:20px;height:20px;border:1px solid #ddd;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:#fff}
        .chk.on{background:#111;color:#fff;border-color:#111}
        .sum{font-weight:900;margin-top:8px;display:flex;justify-content:space-between;align-items:center}
        .pill{ font-size:12px;padding:6px 10px;border:1px solid #eee;border-radius:999px;background:#fafafa;font-weight:700; color:#111; }
        .helpers{display:flex;gap:8px;margin-top:8px}
        .fab{position:fixed;left:14px;right:14px;bottom:18px;display:flex;gap:10px}
        .btn{padding:14px;border-radius:14px;font-weight:800;border:1px solid #1f1f1f}
        .btn-dark{background:#1f1f1f;color:#fff;border-color:#1f1f1f;flex:1}
        .btn-ghost{background:#fff;color:#111}
        .confirm-overlay{position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:flex-end; z-index:50;}
        .confirm-sheet{background:#fff; width:100%; border-top-left-radius:22px; border-top-right-radius:22px; padding:16px; max-height:80dvh; overflow:auto;}
        .cs-title{font-size:18px; font-weight:900; margin-bottom:10px;}
        .cs-row{display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed #eee;}
        .cs-row:last-child{border-bottom:none;}
        .cs-sub{margin-top:12px; font-weight:800;}
        .mm-backdrop{position:fixed; inset:0; background:rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; z-index:70;}
        .mm-card{width:min(560px, 92vw); background:#fff; border-radius:18px; border:1px solid:#eee; box-shadow:0 16px 44px rgba(0,0,0,.22); padding:18px;}
        .mm-head{display:flex; align-items:center; gap:10px; margin-bottom:8px;}
        .mm-ico{font-size:22px;}
        .mm-title{font-weight:900; font-size:18px;}
        .mm-section{background:#fafafa; border:1px solid:#eee; border-radius:12px; padding:10px 12px; margin-top:10px;}
        .mm-sub{font-weight:800; margin-bottom:6px;}
        .mm-list{margin:0; padding-left:14px; line-height:1.5;}
        .mm-list.ok li{color:#1f3b1f;}
        .mm-actions{display:flex; gap:10px; justify-content:flex-end; margin-top:14px;}
        .mm-btn{padding:12px 14px; border-radius:12px; font-weight:800; border:1px solid #1f1f1f;}
        .mm-btn.dark{background:#1f1f1f; color:#fff;}
        .mm-btn.ghost{background:#fff; color:#111; border-color:#ddd;}
        @media (max-width: 520px){ .mm-card{padding:16px;} .mm-title{font-size:16px;} .mm-btn{flex:1;} }
        .toasts{position:fixed; left:12px; right:12px; bottom:90px; display:flex; flex-direction:column; gap:8px; z-index:60;}
        .toast{background:#111;color:#fff;padding:10px 12px;border-radius:12px;font-weight:800;opacity:.95}
        a, a:visited, a:active { color: inherit; text-decoration: none; }
        button, .btn, .btnx, .pill, .slot, .back { appearance:none!important; -webkit-appearance:none!important; color:#111!important; -webkit-text-fill-color:#111!important; }
        .btn-dark { color:#fff!important; -webkit-text-fill-color:#fff!important; }
        .back:focus, .back:active, .btn:focus, .btn:active, .btnx:focus, .btnx:active, .pill:focus, .pill:active, .slot:focus, .slot:active { color:inherit!important; -webkit-text-fill-color:inherit!important; outline:none!important; box-shadow:none!important; }
        .d { -webkit-text-fill-color: inherit !important; }
        .d.sel { -webkit-text-fill-color: #fff !important; }
        a[x-apple-data-detectors], a[href^="x-apple-data-detectors:"], a[href^="tel:"]{ color: inherit !important; -webkit-text-fill-color: inherit !important; text-decoration: none !important; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
      <div className="sheet">

        {/* Hero slika */}
        <div className="hero"><img src="/usluge1.webp" alt="Usluga" /></div>
        <button className="back" onClick={()=>nav(-1)}>Nazad</button>
        <div className="title">{nice(anchor,{month:"long", year:"numeric"})}</div>
        <div className="sub">{headerName}</div>

        {/* KALENDAR */}
        <div className="cal">
          <div className="mbar">
            <button
              className="btnx"
              disabled={!canGoPrev}
              onClick={()=>{ if(!canGoPrev) return; const x=new Date(anchor); x.setMonth(anchor.getMonth()-1); setAnchor(x); }}
              title={canGoPrev ? "Prethodni mesec" : "Nije dostupno"}>
              ◀︎
            </button>
            <div style={{fontWeight:900}}>{nice(anchor,{month:"long", year:"numeric"})}</div>
            <button
              className="btnx"
              disabled={!canGoNext}
              onClick={()=>{ if(!canGoNext) return; const x=new Date(anchor); x.setMonth(anchor.getMonth()+1); setAnchor(x); }}
              title={canGoNext ? "Sledeći mesec" : "Dostupno je samo 14 dana unapred"}>
              ▶︎
            </button>
          </div>

          <div className="grid">
            {["Pon","Uto","Sre","Čet","Pet","Sub","Ned"].map(d=><div key={d} className="dow">{d}</div>)}
            {(() => {
              const firstDow = ((new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay() + 6) % 7);

              const blanks = Array(firstDow).fill(null);
              const elems = [];
              blanks.forEach((_,i)=>elems.push(<div key={`b${i}`} />));
              daysInMonth.forEach(d=>{
                const sel = dayKey(d)===dayKey(selectedDay);
                const isOff = (SALON_HOURS[wd1to7(d)]||[]).length===0;
                const isPastDay = d < today0;
                const isTooFar  = d > maxDate; // ❗ nova provera
                const disabled = isOff || isPastDay || isTooFar;
                const title = disabled
                  ? (isPastDay ? "Dan je prošao" : (isTooFar ? "Zakazivanje moguće samo za nedelju unapred" : "Salon ne radi"))
                  : "";
                elems.push(
                  <button
                    key={d.toISOString()}
                    className={`d ${sel?"sel":""} ${disabled?"disabled":""}`}
                    onClick={()=>!disabled && setSelectedDay(d)}
                    disabled={disabled}
                    aria-disabled={disabled}
                    title={title}
                  >
                    {d.getDate()}
                  </button>
                );
              });
              return elems;
            })()}
          </div>
        </div>

        {/* Poruka ili slotovi */}
        {(!totalDurationMin) ? (
          <div className="msg">Izaberite bar jednu uslugu ispod da biste videli termine.</div>
        ) : ( (selectedDay > maxDate)
              ? <div className="msg">Zakazivanje je moguće samo u naredne dve nedelje.</div>
              : (slots.length===0 ? (
                  <div className="msg">
                    Nema dostupnih termina za odabrani datum.&nbsp;
                    {anyWork ? "Pokušaj drugi dan." : "Zaposleni ne rade taj dan."}

                  </div>
                ) : (
                  <div className="slots">
                    {slots.map((s,i)=>{
                      const emp = chosenEmployeeId==="firstFree" ? (s.employeeId ? (employees.find(e=>e.username===s.employeeId)?.firstName || s.employeeId) : null) : null;
                      return (
                        <button
                          key={i}
                          className={`slot ${emp?"emp":""}`}
                          onClick={()=>pickSlot(s)}
                          disabled={s.start < new Date()}
                          title={s.start < new Date() ? "Vreme je prošlo" : ""}
                        >
                          {hhmm(s.start)}{emp?` • ${emp}`:""}
                        </button>
                      );
                    })}
                  </div>
                )
            )
        )}

        {/* Rezime + odabir usluga */}
        <div className="res">
          <div className="helpers">
            <button className="pill" onClick={selectAllForEmployee}>Uključi sve koje ova radnica radi</button>
            <button className="pill" onClick={()=>{ setSelectedIds([]); pushToast("Ništa nije izabrano."); }}>Poništi sve</button>
          </div>

          {cart.map(it=>(
            <div key={it.serviceId} className="svc">
              <div className="l">
                <button
                  className={`chk ${selectedIds.includes(it.serviceId)?"on":""}`}
                  onClick={()=>toggleSel(it.serviceId)}
                  aria-label="toggle service"
                >
                  {selectedIds.includes(it.serviceId) ? "✓" : ""}
                </button>
                <div>
                  <div style={{fontWeight:800}}>{it.name} • {it.durationMin} min</div>
                  <div style={{fontSize:12,opacity:.7}}>
                    {Number(it.priceRsd||0).toLocaleString("sr-RS")} RSD
                    {chosenEmployeeId!=="firstFree" && chosenEmployee && (
                      canEmployeeDo(it, chosenEmployee)
                        ? <span style={{marginLeft:8,color:"#208A3C"}}>• radi ova radnica</span>
                        : <span style={{marginLeft:8,color:"#B02A37"}}>• ova radnica ne radi</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="sum">
            <span>Za zakazivanje sada: {selectedServices.length} / {cart.length} usl.</span>
            <span>{totalAmountRsd.toLocaleString("sr-RS")} RSD • {totalDurationMin} min</span>
          </div>
          {remainingServices.length>0 && (
            <div style={{marginTop:6, fontSize:13, opacity:.75}}>
              Ostaje za kasnije: {remainingServices.length} usluga (posle potvrde bićeš vraćen na izbor radnika za preostalo).
            </div>
          )}
        </div>

        {/* Confirm Sheet */}
        {confirmOpen && confirmData && (
          <div className="confirm-overlay" onClick={()=>!saving && setConfirmOpen(false)}>
            <div className="confirm-sheet" onClick={(e)=>e.stopPropagation()}>
              <div className="cs-title">Potvrda termina</div>

              <div className="cs-row"><div>Datum</div><div>{niceDate(confirmData.start)}</div></div>
              <div className="cs-row"><div>Vreme</div><div>{hhmm(confirmData.start)} – {hhmm(confirmData.end)}</div></div>
              <div className="cs-row">
                <div>Zaposleni</div>
                <div>
                  {(() => {
                   const id = confirmData.employeeId;
  if (!id) return "—";
  const e = employees.find(x => x.username === id);
  return e ? `${e.firstName || ""} ${e.lastName || ""}`.trim() || id : id;
})()}
                </div>
              </div>

              <div className="cs-sub">Usluge u ovom terminu</div>
              {selectedServices.map(s=>(
                <div key={s.serviceId} className="cs-row">
                  <div>{s.name}</div>
                  <div>{Number(s.priceRsd||0).toLocaleString("sr-RS")} • {s.durationMin}m</div>
                </div>
              ))}
              <div className="cs-row">
                <div style={{fontWeight:900}}>Ukupno</div>
                <div style={{fontWeight:900}}>{totalAmountRsd.toLocaleString("sr-RS")} RSD • {totalDurationMin}m</div>
              </div>

              <div className="cs-sub">Klijent</div>
              <div className="cs-row"><div>Ime i prezime</div><div>{client.name || "—"}</div></div>
              <div className="cs-row"><div>Telefon</div><div>{client.phone || "—"}</div></div>
              <div className="cs-row"><div>Email</div><div>{client.email || "—"}</div></div>

              <div className="cs-actions" style={{display:"flex",gap:10,marginTop:12}}>
                <button className="btn btn-ghost" disabled={saving} onClick={()=>setConfirmOpen(false)}>Otkaži</button>
                <button className="btn btn-dark" disabled={saving} onClick={confirmBooking}>
                  {saving ? "Čuvam..." : "Potvrdi"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mismatch modal */}
        {mismatch.open && (
          <div className="mm-backdrop" onClick={()=>setMismatch(m=>({ ...m, open:false }))}>
            <div className="mm-card" onClick={(e)=>e.stopPropagation()}>
              <div className="mm-head">
                <div className="mm-ico">⚠️</div>
                <div className="mm-title">Ne poklapaju se usluge</div>
              </div>

              <div className="mm-section">
                <div className="mm-sub">Ova radnica <b>NE radi</b>:</div>
                <ul className="mm-list">
                  {mismatch.notDoable.map(s=>(<li key={s.serviceId}>• {s.name}</li>))}
                </ul>
              </div>

              {mismatch.doable.length>0 && (
                <div className="mm-section">
                  <div className="mm-sub">Može da uradi:</div>
                  <ul className="mm-list ok">
                    {mismatch.doable.map(s=>(<li key={s.serviceId}>• {s.name}</li>))}
                  </ul>
                </div>
              )}

              <div className="mm-actions">
                {mismatch.doable.length>0 ? (
                  <>
                    <button
                      className="mm-btn ghost"
                      onClick={()=>{
                        setMismatch(m=>({ ...m, open:false }));
                        mismatch.backCb && mismatch.backCb();
                      }}
                    >
                      Izaberi drugu radnicu
                    </button>
                    <button
                      className="mm-btn dark"
                      onClick={()=>{
                        const cb = mismatch.proceedCb;
                        setMismatch(m=>({ ...m, open:false }));
                        cb && cb();
                      }}
                    >
                      Nastavi sa dozvoljenim
                    </button>
                  </>
                ) : (
                  <button
                    className="mm-btn dark"
                    onClick={()=>{
                      const cb = mismatch.backCb;
                      setMismatch(m=>({ ...m, open:false }));
                      cb && cb();
                    }}
                  >
                    Nazad na izbor radnice
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* FAB */}
        <div className="fab">
          <button className="btn btn-dark" onClick={()=>nav(-1)}>Nazad</button>
          <button
            className="btn btn-dark"
            onClick={()=>{
              if (!totalDurationMin) {
                pushToast("Izaberi bar jednu uslugu za ovaj termin.");
                return;
              }
              if (selectedDay < today0){
                pushToast("Ne možeš birati datum u prošlosti.");
                return;
              }
            if (selectedDay > maxDate) {
  pushToast("Zakazivanje je moguće samo u naredne dve nedelje.");
  return;
}
              ensureValidSelectionForEmployee(() => {
                pushToast("Izaberi vreme iznad pa potvrdi.");
              });
            }}
          >
            Nastavi
          </button>
        </div>
      </div>

      {/* Toastovi */}
      <div className="toasts">
        {toasts.map(t=> <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </div>
  );
}
