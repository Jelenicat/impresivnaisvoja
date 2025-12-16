import React, { useEffect, useMemo, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { debounce } from 'lodash';

import {
  collection, query, where, orderBy, onSnapshot,
  deleteDoc, doc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";
import CalendarEventModal from "../partials/CalendarEventModal";
// jezik za formatiranje datuma (srpski latinica)
const LOCALE = "sr-Latn-RS";

function toJsDate(x) { if (!x) return null; if (x instanceof Date) return x; if (typeof x?.toDate === "function") return x.toDate(); return new Date(x); }
function parseLocalYmd(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
function startOfDay(d) { const x = new Date(toJsDate(d) || new Date()); x.setHours(0, 0, 0, 0); return x; }
function localYmd(d) {
  const x = startOfDay(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function endOfDay(d) { const x = new Date(toJsDate(d) || new Date()); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a, b) { const x = startOfDay(a), y = startOfDay(b); return x.getTime() === y.getTime(); }
function fmtTime(d) { const x = toJsDate(d); if (!x) return ""; const hh = String(x.getHours()).padStart(2, "0"); const mm = String(x.getMinutes()).padStart(2, "0"); return `${hh}:${mm}`; }
const fmtDate = (d) => {
  const x = d?.toDate ? d.toDate() : new Date(d);
  if (isNaN(x)) return "—";
  return x.toLocaleDateString(LOCALE, { day:"2-digit", month:"2-digit", year:"numeric" });
};


function minsInDay(dt, dayStart) { const t = toJsDate(dt)?.getTime?.() ?? 0; return Math.round((t - dayStart.getTime()) / 60000); }
const fmtPrice = (n) => (Number(n) || 0).toLocaleString("sr-RS");

const DAY_START_MIN = 7 * 60, DAY_END_MIN = 22 * 60, PX_PER_MIN = 1.1;
const yFromMinutes = (m) => (m - DAY_START_MIN) * PX_PER_MIN;
const weekdayIndex = (d) => (toJsDate(d).getDay() + 6) % 7;
function getPhone(c) { return (c?.phone ?? c?.phoneNumber ?? c?.mobile ?? "").toString(); }
function formatClient(c, role = "admin") {
  if (!c) return "—";
  const phone = getPhone(c);
  if (role === "admin") { return `${c.firstName || ""} ${c.lastName || ""}${phone ? ` · ${phone}` : ""}`.trim(); }
  const last3 = phone.replace(/\D/g, "").slice(-3);
  const initial = c.lastName ? `${c.lastName[0].toUpperCase()}.` : "";
  return `${c.firstName || ""} ${initial}${last3 ? ` · ***${last3}` : ""}`.trim();
}
function isOnlineAppt(a) {
  return a?.isOnline === true || a?.bookedVia === "public_app" || a?.source === "online" || a?.createdBy === "public";
}
function isCanceledAppt(a) {
  if (!a) return false;
  return a.status === "cancelled" || a.status === "canceled" || a.canceled === true || !!a.cancelledAt || !!a.canceledAt;
}
function apptCanceledAt(a) {
  return toJsDate(a?.cancelledAt) || toJsDate(a?.canceledAt) || toJsDate(a?.archivedAt) || null;
}
function getApptTs(a) {
  return toJsDate(a?.updatedAt) || toJsDate(a?.createdAt) || toJsDate(a?.start) || new Date(0);
}
function normalizeServices(a, services) {
  const svcMap = new Map((services || []).map(s => [s.id, s]));
  const raw = a?.services || [];
  if (!raw.length) return [];
  if (typeof raw[0] === "string") {
    return raw.map(id => {
      const base = svcMap.get(id);
      return base ? { id: base.id, name: base.name || "—", categoryId: base.categoryId || null, priceRsd: Number(base.priceRsd) || 0 } : { id, name: "—", categoryId: null, priceRsd: 0 };
    });
  }
  if (typeof raw[0] === "object") {
    return raw.map(x => {
      const id = x.serviceId || x.id;
      const base = id ? svcMap.get(id) : null;
      return { id: id || (base?.id ?? null), name: x.name || base?.name || "—", categoryId: x.categoryId || base?.categoryId || null, priceRsd: Number(x.priceRsd ?? base?.priceRsd ?? 0) || 0 };
    });
  }
  return [];
}
function hmToMin(s) { if (typeof s !== "string") return null; const [h, m] = s.split(":").map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return null; return h * 60 + m; }
function getWorkIntervalsFor(empUsername, dateObj, latestSchedules) {
  const sch = latestSchedules.get(empUsername);
  if (!sch) return [];

  const d = startOfDay(dateObj);
  const dStr = localYmd(d);

  // 1) Override prioritet (jedan tačan dan)
  const ov = sch?.overrides?.[dStr];
  if (ov) {
    if (ov.closed) return [];
    const s = hmToMin(ov.from);
    const e = hmToMin(ov.to);
    if (s != null && e != null && e > s) return [[s, e]];
    return [];
  }

  // 2) Opseg važenja baznog schedule-a
  const inRange = (!sch.startDate || sch.startDate <= dStr) && (!sch.endDate || sch.endDate >= dStr);
  if (!inRange) return [];

  // 3) Pattern (1w/2w/3w/4w) kao i ranije
  const weeksCount = sch.pattern === "2w" ? 2 : sch.pattern === "3w" ? 3 : sch.pattern === "4w" ? 4 : 1;
  const start = sch.startDate ? parseLocalYmd(sch.startDate) : d;
  const diffDays = Math.floor((d - startOfDay(start)) / (24 * 3600 * 1000));
  if (diffDays < 0) return [];

  const weekIdx = ((Math.floor(diffDays / 7) % weeksCount) + weeksCount) % weeksCount;
  const weeksArr = Array.isArray(sch.weeks)
    ? sch.weeks
    : Object.keys(sch.weeks || {}).sort((a, b) => Number(a) - Number(b)).map(k => sch.weeks[k]);

  const dayCfg = (weeksArr[weekIdx] || [])[weekdayIndex(d)];
  if (!dayCfg || dayCfg.closed) return [];

  const intervals = [];

  if (Array.isArray(dayCfg.ranges)) {
    for (const r of dayCfg.ranges) {
      let s = typeof r.start === "number" ? r.start : hmToMin(r.start);
      let e = typeof r.end   === "number" ? r.end   : hmToMin(r.end);
      if (s == null || e == null) continue;
      if (e > s) intervals.push([s, e]);
    }
  }

  const cand = [[dayCfg.from, dayCfg.to], [dayCfg.start, dayCfg.end], [dayCfg.startMin, dayCfg.endMin]];
  for (const [a, b] of cand) {
    let s = typeof a === "number" ? a : hmToMin(a);
    let e = typeof b === "number" ? b : hmToMin(b);
    if (s != null && e != null && e > s) intervals.push([s, e]);
  }

  intervals.sort((x, y) => x[0] - y[0]);

  // merge preklapanja
  const merged = [];
  for (const [s, e] of intervals) {
    if (!merged.length || s > merged[merged.length - 1][1]) merged.push([s, e]);
    else merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
  }
  return merged;
}

function getOffIntervals(workIntervals) {
  const res = []; let cur = DAY_START_MIN;
  for (const [s, e] of workIntervals) { if (s > cur) res.push([cur, Math.min(s, DAY_END_MIN)]); cur = Math.max(cur, e); }
  if (cur < DAY_END_MIN) res.push([cur, DAY_END_MIN]);
  return res;
}
const HEADER_H = 36;
const CONTENT_H = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;
function dateToInputValue(d) {
  const x = toJsDate(d) || new Date();
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function apptColorFrom(items, categoriesMap) {
  const first = items[0];
  const col = first ? (categoriesMap.get(first.categoryId)?.color || null) : null;
  return col || "#e6e0d7";
}

export default function AdminCalendar({ role = "admin", currentUsername = null }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [employees, setEmployees] = useState([]);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [clients, setClients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [latestSchedules, setLatestSchedules] = useState(new Map());
  const [open, setOpen] = useState(false);
  const [modalValue, setModalValue] = useState({ create: true, type: "appointment" });
  const [hover, setHover] = useState({ show: false, emp: null, top: 0, text: "" });
  const [chooser, setChooser] = useState({ open: false, start: null, emp: null });
  const [hoverAppt, setHoverAppt] = useState(null);
  const [tempEndMap, setTempEndMap] = useState(new Map());
  const resizingRef = useRef(null);
  const tempEndRef = useRef(new Map());
  const justResizedRef = useRef(false);
  const draggingRef = useRef(null);
  const [dragGhost, setDragGhost] = useState(null);
  const dragGhostRef = useRef(null);
  const justDraggedRef = useRef(false);
  const [overrideEndMap, setOverrideEndMap] = useState(new Map());
  const overrideTimersRef = useRef(new Map());
  const columnsOuterRef = useRef(null);
  const [paneH, setPaneH] = useState(0);
  const gridWrapRef = useRef(null);
  const [scrollY, setScrollY] = useState(0);
  const colBodyRefs = useRef(new Map());
  const deepLinkOpenedRef = useRef({ id: null }); // sprečava ponovna otvaranja istog termina
    const sentCreateRef = useRef(new Set());


  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState([]);
  const [hasUnread, setHasUnread] = useState(false);
  const lastSeenKey = useMemo(() => `notif:lastSeen:${role}:${currentUsername || "all"}`, [role, currentUsername]);
  const getLastSeen = () => {
    const v = localStorage.getItem(lastSeenKey);
    return v ? new Date(v) : new Date(0);
  };
  const [nowMinAbs, setNowMinAbs] = useState(0);
  const loc = useLocation();
  const qs = new URLSearchParams(loc.search);
  const focusApptId = qs.get("appointmentId");
  const focusEmpFromUrl = qs.get("employeeId");
  const serviceMap = useMemo(() => new Map(services.map(s => [s.id, s])), [services]);
  const categoriesMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const dayStart = useMemo(() => startOfDay(day), [day]);
  const dayEnd = useMemo(() => endOfDay(day), [day]);

 useEffect(() => {
  const unsub = onSnapshot(collection(db, "schedules"), (snap) => {
    // privremena struktura: emp -> { base: scheduleDoc | null, overrides: { [ymd]: {from,to,closed} } }
    const tmp = new Map();

    const getOrInit = (emp) => {
      if (!tmp.has(emp)) tmp.set(emp, { base: null, overrides: {} });
      return tmp.get(emp);
    };

    // helperi
    const pickNewest = (a, b) => {
      const ta = a?.createdAt?.toDate?.()?.getTime?.() || 0;
      const tb = b?.createdAt?.toDate?.()?.getTime?.() || 0;
      return ta >= tb ? a : b;
    };
    const jsWeekdayIdx = (dateStr) => (new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7;

    for (const docSnap of snap.docs) {
      const data = { id: docSnap.id, ...docSnap.data() };
      const emp = data.employeeUsername;
      if (!emp) continue;
      const bucket = getOrInit(emp);

      const isExplicitOverride =
        data?.kind === "override" ||
        data?.pattern === "custom-1d" ||
        (!!data?.startDate && !!data?.endDate && data.startDate === data.endDate);

      if (isExplicitOverride) {
        // Izvući (from,to,closed) za taj jedini dan iz weeks["0"][dan]
        const dateStr = data.startDate; // isti je kao endDate
        const w0 = Array.isArray(data.weeks) ? data.weeks[0] : data.weeks?.["0"];
        const dayIdx = jsWeekdayIdx(dateStr);
        const cell = Array.isArray(w0) ? (w0[dayIdx] || null) : null;

        // ako nema cell, tretiraj kao closed
        const from = cell?.from ?? "";
        const to   = cell?.to   ?? "";
        const closed = cell?.closed === true || (!from || !to);

        bucket.overrides[dateStr] = { from, to, closed: !!closed };
      } else {
        // kandidat za bazni schedule (1w/2w/3w/4w)
        bucket.base = bucket.base ? pickNewest(bucket.base, data) : data;

        // Ako sam bazni već ima svoju mapu overrides (buduća verzija), spoji i nju
        if (data?.overrides && typeof data.overrides === "object") {
          for (const [k, v] of Object.entries(data.overrides)) {
            // očekuje se {from,to,closed}
            if (!bucket.overrides[k]) bucket.overrides[k] = {
              from: v?.from ?? "",
              to: v?.to ?? "",
              closed: !!v?.closed
            };
          }
        }
      }
    }

    // Pretvori u mapu za render: emp -> "composed schedule"
    // composed = { ...base, overrides: {ymd:{from,to,closed}} }
    const perEmp = new Map();
    for (const [emp, { base, overrides }] of tmp.entries()) {
      if (base) perEmp.set(emp, { ...base, overrides });
      else if (Object.keys(overrides).length) {
        // u teoriji može postojati samo override bez base – i to prikaži makar kao “samo taj dan”
        perEmp.set(emp, { pattern: "1w", startDate: null, endDate: null, weeks: {"0": []}, overrides });
      }
    }

    setLatestSchedules(perEmp);
  });
  return () => unsub && unsub();
}, []);

  function worksThisDay(empUsername, dateObj) {
  const sch = latestSchedules.get(empUsername);
  if (!sch) return false;

  const d = startOfDay(dateObj);
  const dStr = localYmd(d);

  // 0) Ako postoji override za TAJ dan – on ima prioritet
  const ov = sch.overrides && sch.overrides[dStr];
  if (ov) {
    // ako je označen kao zatvoren ili nema ispravno vreme → tretiraj kao da ne radi
    if (ov.closed) return false;
    const s = hmToMin(ov.from);
    const e = hmToMin(ov.to);
    if (s == null || e == null || e <= s) return false;
    return true;
  }

  // 1) Provera opsega važenja baznog rasporeda
  const inRange =
    (!sch.startDate || sch.startDate <= dStr) &&
    (!sch.endDate || sch.endDate >= dStr);
  if (!inRange) return false;

  // 2) Pattern (1w/2w/3w/4w) – isto kao u getWorkIntervalsFor
  const weeksCount =
    sch.pattern === "2w" ? 2 :
    sch.pattern === "3w" ? 3 :
    sch.pattern === "4w" ? 4 : 1;

  const start = sch.startDate ? parseLocalYmd(sch.startDate) : d;
  const diffDays = Math.floor((d - startOfDay(start)) / (24 * 3600 * 1000));
  if (diffDays < 0) return false;

  const weekIdx = ((Math.floor(diffDays / 7) % weeksCount) + weeksCount) % weeksCount;
  const weeksArr = Array.isArray(sch.weeks)
    ? sch.weeks
    : Object.keys(sch.weeks || {})
        .sort((a, b) => Number(a) - Number(b))
        .map(k => sch.weeks[k]);

  const dayCfg = (weeksArr[weekIdx] || [])[weekdayIndex(d)];
  if (!dayCfg || dayCfg.closed) return false;
  return true;
}

  const employeesWorkingToday = useMemo(() => (employees || []).filter(e => worksThisDay(e.username, dayStart)), [employees, latestSchedules, dayStart]);
  const visibleEmployees = useMemo(() => {
    let base = employeesWorkingToday;
    if (role === "worker" && currentUsername) {
      base = base.filter(e => e.username === currentUsername);
      return base;
    }
    if (employeeFilter === "all") return base;
    return base.filter(e => e.username === employeeFilter);
  }, [employeesWorkingToday, employeeFilter, role, currentUsername]);

  const apptsForDay = useMemo(() => {
    const s = dayStart.getTime(), e = dayEnd.getTime();
    return (appointments || []).filter(a => {
      const t = toJsDate(a.start)?.getTime?.() ?? 0;
      return t >= s && t <= e;
    }).sort((a, b) => toJsDate(a.start) - toJsDate(b.start));
  }, [appointments, dayStart, dayEnd]);

  const apptsByEmployee = useMemo(() => {
    const m = new Map();
    for (const emp of visibleEmployees) m.set(emp.username, []);
    for (const a of apptsForDay) {
      if (!m.has(a.employeeUsername)) m.set(a.employeeUsername, []);
      m.get(a.employeeUsername).push(a);
    }
    return m;
  }, [apptsForDay, visibleEmployees]);

  useEffect(() => {
    if (!focusApptId) return;
    let isCancelled = false;
    (async () => {
      try {
        const snap = await (await import("firebase/firestore")).getDoc((await import("firebase/firestore")).doc(db, "appointments", focusApptId));
        if (!snap.exists() || isCancelled) return;
        const a = snap.data();
        const start = toJsDate(a?.start);
        if (start) {
          setDay(startOfDay(start));
        }
        const emp = a?.employeeUsername || focusEmpFromUrl || null;
        if (emp && role !== "worker") {
          setEmployeeFilter(emp);
        }
      } catch (e) {
        console.warn("Ne mogu da učitam appointment za focus:", e);
      }
    })();
    return () => { isCancelled = true; };
  }, [focusApptId, focusEmpFromUrl, role]);

  useEffect(() => onSnapshot(collection(db, "clients"), snap => {
    const rows = snap.docs.map(d => {
      const data = d.data();
      return data ? { id: d.id, ...data } : null;
    }).filter(Boolean);
    setClients(rows);
  }), []);

  useEffect(() => onSnapshot(collection(db, "employees"), snap => {
    setEmployees(snap.docs.map(d => {
      const data = d.data();
      return data ? { id: d.id, ...data } : null;
    }).filter(Boolean));
  }), []);

  useEffect(() => onSnapshot(collection(db, "services"), snap => {
    setServices(snap.docs.map(d => {
      const data = d.data();
      return data ? { id: d.id, ...data } : null;
    }).filter(Boolean));
  }), []);

  useEffect(() => onSnapshot(collection(db, "categories"), snap => {
    setCategories(snap.docs.map(d => {
      const data = d.data();
      return data ? { id: d.id, ...data } : null;
    }).filter(Boolean));
  }), []);

  useEffect(() => {
    const q = query(collection(db, "appointments"), where("start", ">=", dayStart), where("start", "<=", dayEnd), orderBy("start", "asc"));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log("Appointments updated:", docs.length, docs);
      setAppointments(docs);
      setOverrideEndMap(prev => {
        if (prev.size === 0) return prev;
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
    return () => unsub && unsub();
  }, [dayStart, dayEnd]);

  useEffect(() => {
    if (!focusApptId || !appointments?.length) return;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-appt-id="${focusApptId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("appt--highlight");
        setTimeout(() => el.classList.remove("appt--highlight"), 1600);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [focusApptId, appointments]);
// Auto-open modal kada URL ima ?appointmentId=...
useEffect(() => {
  if (!focusApptId || !appointments?.length) return;

  // već otvoren za isti id? ne otvaraj ponovo
  if (deepLinkOpenedRef.current.id === focusApptId) return;

  const appt = appointments.find(a => a.id === focusApptId);
  if (!appt) return;

  // otvori modal za taj termin
  openEdit(appt);
  deepLinkOpenedRef.current.id = focusApptId;

  // opciono: očisti query da se modal ne otvara opet na re-render/refresh
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("appointmentId");
    u.searchParams.delete("employeeId");
    window.history.replaceState({}, "", u.toString());
  } catch {}
}, [focusApptId, appointments]);

  useEffect(() => {
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const unsubs = [];
    const qBooked = query(collection(db, "appointments"), where("createdAt", ">=", past), where("createdAt", "<=", future), orderBy("createdAt", "desc"));
    const unsubBooked = onSnapshot(qBooked, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const scoped = (role === "worker" && currentUsername) ? all.filter(a => a?.employeeUsername === currentUsername) : all;
      const bookedItems = scoped.map(a => {
        const ts = toJsDate(a?.createdAt) || toJsDate(a?.upAt) || getApptTs(a);
        if (!ts) return null;
        return isOnlineAppt(a) ? { id: a.id + ":booked", type: "booked", ts, appt: a } : null;
      }).filter(Boolean);
      setNotifItems(prev => {
        const keep = prev.filter(x => !String(x.id).endsWith(":booked"));
        const merged = [...keep, ...bookedItems].sort((x, y) => (y.ts?.getTime?.() || 0) - (x.ts?.getTime?.() || 0));
        return merged;
      });
      const lastSeen = getLastSeen().getTime();
      const anyNew = bookedItems.some(it => (it.ts?.getTime?.() || 0) > lastSeen);
      if (anyNew) setHasUnread(true);
    });
    unsubs.push(unsubBooked);
    const qHist = query(collection(db, "appointments_history"), where("archivedAt", ">=", past), where("archivedAt", "<=", future), orderBy("archivedAt", "desc"));
    const unsubHist = onSnapshot(qHist, (snap) => {
      const hist = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const scoped = (role === "worker" && currentUsername) ? hist.filter(a => a?.employeeUsername === currentUsername) : hist;
      const canceledItems = scoped.map(a => {
        if (!isCanceledAppt(a)) return null;
        const ts = apptCanceledAt(a);
        if (!ts) return null;
        return { id: a.id + ":canceled", type: "canceled", ts, appt: a };
      }).filter(Boolean);
      setNotifItems(prev => {
        const keep = prev.filter(x => !String(x.id).endsWith(":canceled"));
        const merged = [...keep, ...canceledItems].sort((x, y) => (y.ts?.getTime?.() || 0) - (x.ts?.getTime?.() || 0));
        return merged;
      });
      const lastSeen = getLastSeen().getTime();
      const anyNew = canceledItems.some(it => (it.ts?.getTime?.() || 0) > lastSeen);
      if (anyNew) setHasUnread(true);
    });
    unsubs.push(unsubHist);
    return () => unsubs.forEach(u => u && u());
  }, [role, currentUsername, dayStart]);
// === NOTIFIKACIJE: kreiranje termina (ručno) ===

useEffect(() => {
  const FIVE_MIN = 5 * 60 * 1000;
  const since = new Date(Date.now() - FIVE_MIN);

  const qNew = query(
    collection(db, "appointments"),
    where("createdAt", ">=", since),
    orderBy("createdAt", "desc")
  );

  const unsub = onSnapshot(qNew, (snap) => {
    snap.docChanges().forEach(async (chg) => {
      if (chg.type !== "added") return;

      const a = { id: chg.doc.id, ...chg.doc.data() };
if (sentCreateRef.current.has(a.id)) return;
sentCreateRef.current.add(a.id);

const createdBy = a?.createdBy; // "admin" | "salon" | "worker"
const isManual = a?.source === "manual";

if (!isManual) return;






      try {
        const fmt = (d) => {
          const x = d?.toDate ? d.toDate() : new Date(d);
          const dd = String(x.getDate()).padStart(2, "0");
          const mm = String(x.getMonth() + 1).padStart(2, "0");
          const yyyy = x.getFullYear();
          const hh = String(x.getHours()).padStart(2, "0");
          const mi = String(x.getMinutes()).padStart(2, "0");
          return `${dd}.${mm}.${yyyy}. ${hh}:${mi}`;
        };
        const titleDate = `${fmt(a.start)}–${fmt(a.end)}`;

        const empObj = (employees || []).find(e => e.username === a.employeeUsername);
        const empName = empObj ? `${empObj.firstName || ""} ${empObj.lastName || ""}`.trim() : (a.employeeUsername || "radnica");

        const client = (clients || []).find(c => c?.id === a?.clientId);
        const items = normalizeServices(a, services);
        const total = (a?.totalAmountRsd ?? a?.priceRsd ?? 0)
          || items.reduce((s, x) => s + (+x.priceRsd || 0), 0);

        const info = {
          apptId: a.id,
          startIso: (a.start?.toDate?.() || new Date(a.start))?.toISOString?.(),
          endIso: (a.end?.toDate?.() || new Date(a.end))?.toISOString?.(),
          employeeUsername: a.employeeUsername,
          employeeName: empName,
          clientName: client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : (a?.clientName || ""),
          clientPhone: client ? (client.phone || client.phoneNumber || "") : (a?.clientPhone || ""),
          serviceNames: items.map(s => s.name),
          priceRsd: String(total || 0),
          changeType:
  createdBy === "worker"
    ? "WORKER_CREATED"
    : createdBy === "salon"
      ? "SALON_CREATED"
      : "ADMIN_CREATED"

        };

   const url = `/worker?appointmentId=${info.apptId}&employeeId=${info.employeeUsername}`;

// ADMIN ili SALON → RADNICA
if (createdBy === "admin" || createdBy === "salon") {
  await fetch("/api/pushMoveNotif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "toEmployee",
      employeeUsername: a.employeeUsername,
      title: "Dodeljen vam je novi termin",
      body: titleDate,
      screen: url, // /worker
      reason: createdBy === "admin"
        ? "ADMIN_CREATED_APPOINTMENT"
        : "SALON_CREATED_APPOINTMENT",
      info
    })
  });
}

// RADNICA → ADMIN
if (createdBy === "worker") {
  await fetch("/api/pushMoveNotif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "toAdmin",
      title: "Radnica je dodala termin",
      body: `${empName} • ${titleDate}`,
      screen: `/admin/kalendar?appointmentId=${info.apptId}&employeeId=${info.employeeUsername}`,
      reason: "WORKER_CREATED_APPOINTMENT",
      info
    })
  });
}

      } catch (e) {
        console.warn("pushMoveNotif (create) error:", e);
      }
    });
  });

  return () => unsub && unsub();
}, [role, employees, services, clients]);

  function openCreateAt(date, employeeUsername) {
    const s = toJsDate(date) || new Date();
    const targetEmp = role === "worker" ? (currentUsername || employeeUsername) : (employeeUsername || (visibleEmployees[0]?.username || ""));
    setModalValue({
      create: true, type: "appointment", start: s, end: new Date(s.getTime() + 30 * 60000),
      employeeUsername: targetEmp, services: [], priceRsd: 0, paid: null, source: "manual", pickedEmployee: false, note: ""
    });
    setOpen(true);
  }
  function openBlock(employeeUsername, date) {
    const s = date ? toJsDate(date) : new Date(dayStart);
    const targetEmp = role === "worker" ? (currentUsername || employeeUsername) : (employeeUsername || visibleEmployees[0]?.username || "");
    setModalValue({ create: true, type: "block", start: s, end: new Date(s.getTime() + 60 * 60000), employeeUsername: targetEmp, note: "" });
    setOpen(true);
  }
  function openEdit(a) {
    if (role === "worker" && a.employeeUsername !== currentUsername) return;
    const overrideMin = overrideEndMap.get(a.id) ?? tempEndMap.get(a.id) ?? null;
    let endDate = toJsDate(a.end);
    if (overrideMin != null) { const d = new Date(dayStart); d.setMinutes(overrideMin); endDate = d; }
    setModalValue({ ...a, create: false, start: toJsDate(a.start), end: endDate, manualEnd: true });
    setOpen(true);
  }
async function handleDelete(id) {
  if (!id) return;
  if (!window.confirm("Obrisati ovaj termin?")) return;

  // Nađi termin PRE brisanja
  const appt = (appointments || []).find(a => a.id === id);
  if (!appt) {
    await deleteDoc(doc(db, "appointments", id));
    setOpen(false);
    return;
  }

  const fmt = (d) => {
    const x = d?.toDate ? d.toDate() : new Date(d);
    const dd = String(x.getDate()).padStart(2, "0");
    const mm = String(x.getMonth() + 1).padStart(2, "0");
    const yyyy = x.getFullYear();
    const hh = String(x.getHours()).padStart(2, "0");
    const mi = String(x.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy}. ${hh}:${mi}`;
  };

  const titleDate = `${fmt(appt.start)}–${fmt(appt.end)}`;
  const employeeUsername = appt.employeeUsername;

  const empObj = (employees || []).find(e => e.username === employeeUsername);
  const empName = empObj
    ? `${empObj.firstName || ""} ${empObj.lastName || ""}`.trim()
    : employeeUsername;

  /* ================= NOTIFIKACIJE ================= */

  try {
    // 1️⃣ SALON briše → admin + radnica
    if (role === "salon") {
      // admin
      await fetch("/api/pushMoveNotif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "toAdmin",
          title: "Salon je obrisao termin",
          body: `${empName} • ${titleDate}`,
          reason: "SALON_DELETED_APPOINTMENT",
          info: { apptId: id }
        })
      });

      // radnica
      await fetch("/api/pushMoveNotif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "toEmployee",
          employeeUsername,
          title: "Vaš termin je obrisan",
          body: titleDate,
          screen: `/worker?appointmentId=${id}&employeeId=${employeeUsername}`,
          reason: "SALON_DELETED_APPOINTMENT",
          info: { apptId: id }
        })
      });
    }

    // 2️⃣ RADNICA briše → admin
    if (role === "worker") {
      await fetch("/api/pushMoveNotif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "toAdmin",
          title: "Radnica je obrisala termin",
          body: `${empName} • ${titleDate}`,
          reason: "WORKER_DELETED_APPOINTMENT",
          info: { apptId: id }
        })
      });
    }

    // 3️⃣ ADMIN briše → radnica
    if (role === "admin") {
      await fetch("/api/pushMoveNotif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "toEmployee",
          employeeUsername,
          title: "Vaš termin je obrisan",
          body: titleDate,
          screen: `/worker?appointmentId=${id}&employeeId=${employeeUsername}`,
          reason: "ADMIN_DELETED_APPOINTMENT",
          info: { apptId: id }
        })
      });
    }
  } catch (e) {
    console.warn("pushMoveNotif (delete) error:", e);
  }

  /* ================= BRISANJE ================= */

  await deleteDoc(doc(db, "appointments", id));
  setOpen(false);
}

  function prevDay() { const d = new Date(dayStart); d.setDate(d.getDate() - 1); setDay(d); }
  function nextDay() { const d = new Date(dayStart); d.setDate(d.getDate() + 1); setDay(d); }
  function today() { setDay(startOfDay(new Date())); }
  function openNotifModal() {
    setNotifOpen(true);
    try {
      const nowIso = new Date().toISOString();
      localStorage.setItem(lastSeenKey, nowIso);
      setHasUnread(false);
    } catch {}
  }

  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    let startX = 0, startY = 0, moved = false;
    function onTouchStart(e) {
      if (resizingRef.current || draggingRef.current) return;
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
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) > 10) {
        e.preventDefault();
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
      if (Math.abs(dy) > Math.abs(dx)) return;
      const THRESH = 80;
      if (dx <= -THRESH) {
        nextDay();
      } else if (dx >= THRESH) {
        prevDay();
      }
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [dayStart, visibleEmployees]);

  function handleColumnMove(e, empUsername) {
    const body = colBodyRefs.current.get(empUsername);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + (body.scrollTop || 0);
    const minutesFromTop = Math.round(Math.max(0, offsetY) / PX_PER_MIN);
    let whenMin = DAY_START_MIN + minutesFromTop;
    whenMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, Math.round(whenMin / 5) * 5));
    const d = new Date(dayStart); d.setMinutes(whenMin);
    setHover({ show: true, emp: empUsername, top: yFromMinutes(whenMin), text: fmtTime(d) });
    if (draggingRef.current) {
      const g = { id: draggingRef.current.id, emp: empUsername, topMin: whenMin };
      setDragGhost(g);
      dragGhostRef.current = g;
    }
  }
  function handleColumnLeave() { setHover({ show: false, emp: null, top: 0, text: "" }); }
  function handleColumnClick(e, empUsername) {
    if (justResizedRef.current || justDraggedRef.current) return;
    const body = colBodyRefs.current.get(empUsername);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = e.clientY - rect.top + (body.scrollTop || 0);
    const minutesFromTop = Math.round(Math.max(0, offsetY) / PX_PER_MIN);
    let whenMin = DAY_START_MIN + minutesFromTop;
    whenMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - 5, Math.round(whenMin / 5) * 5));
    const d = new Date(dayStart); d.setMinutes(whenMin);
    setChooser({ open: true, start: d, emp: empUsername });
  }
  function handleColumnsScroll(e) {
    const st = e.currentTarget.scrollTop || 0;
    setScrollY(st);
    if (hoverAppt) setHoverAppt(null);
  }
  function swallowNextClick(ev) { ev.stopPropagation(); ev.preventDefault(); }
  function getClientCoords(ev) {
    if (ev.touches && ev.touches.length > 0) {
      return { clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY };
    }
    return { clientX: ev.clientX, clientY: ev.clientY };
  }

  const onResizingMouseMove = debounce((ev) => {
    const r = resizingRef.current; if (!r) return;
    const offset = ev.clientY - r.bodyTop + r.scrollTop;
    const minutesFromTop = Math.round(Math.max(0, offset) / PX_PER_MIN);
    let proposedEndMin = DAY_START_MIN + minutesFromTop;
    proposedEndMin = Math.max(proposedEndMin, r.startMin + 15);
    proposedEndMin = Math.min(proposedEndMin, DAY_END_MIN);
    proposedEndMin = Math.round(proposedEndMin / 5) * 5;
    setTempEndMap(m => { const nm = new Map(m); nm.set(r.id, proposedEndMin); tempEndRef.current = nm; return nm; });
  }, 16);

  const onResizingTouchMove = debounce((ev) => {
    if (!resizingRef.current) return;
    ev.preventDefault();
    const coords = getClientCoords(ev);
    const r = resizingRef.current;
    const offset = coords.clientY - r.bodyTop + r.scrollTop;
    const minutesFromTop = Math.round(Math.max(0, offset) / PX_PER_MIN);
    let proposedEndMin = DAY_START_MIN + minutesFromTop;
    proposedEndMin = Math.max(proposedEndMin, r.startMin + 15);
    proposedEndMin = Math.min(proposedEndMin, DAY_END_MIN);
    proposedEndMin = Math.round(proposedEndMin / 5) * 5;
    setTempEndMap(m => { const nm = new Map(m); nm.set(r.id, proposedEndMin); tempEndRef.current = nm; return nm; });
  }, 16);

async function onResizingMouseUp() {
  const r = resizingRef.current;
  if (!r) return cleanupResize();

  justResizedRef.current = true;
  setTimeout(() => { justResizedRef.current = false; }, 300);
  setTimeout(() => { window.removeEventListener("click", swallowNextClick, true); }, 0);

  const newEndMin = tempEndRef.current.get(r.id) ?? null;

  if (newEndMin && newEndMin > r.startMin) {
    const newEndDate = new Date(dayStart); 
    newEndDate.setMinutes(newEndMin);

    try {
      // Optimistic UI dok Firestore ne potvrdi
      setOverrideEndMap(prev => { const nm = new Map(prev); nm.set(r.id, newEndMin); return nm; });

      await updateDoc(doc(db, "appointments", r.id), { 
        end: newEndDate, 
        updatedAt: serverTimestamp() 
      });

      // === NOTIFIKACIJA (resize) ===
try {
  const actorRole = role; // "admin" | "salon" | "worker"
  const empU = r.emp;     // postavljeno u startResize()

  // vreme: originalni start (iz resize ref-a) -> novi end
  const startDate = new Date(dayStart);
  startDate.setMinutes(r.startMin);

  const fmt = (d) => {
    const x = new Date(d);
    const dd = String(x.getDate()).padStart(2, "0");
    const mm = String(x.getMonth() + 1).padStart(2, "0");
    const yyyy = x.getFullYear();
    const hh = String(x.getHours()).padStart(2, "0");
    const mi = String(x.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy}. ${hh}:${mi}`;
  };
  const titleDate = `${fmt(startDate)}–${fmt(newEndDate)}`;

  // ---- dopunske info o terminu ----
  const appt = (appointments || []).find(x => x.id === r.id) || {};
  const empObj = (employees || []).find(e => e.username === empU);
  const empName = empObj ? `${empObj.firstName || ""} ${empObj.lastName || ""}`.trim() : (empU || "radnica");
  const client = (clients || []).find(c => c?.id === appt?.clientId);
  const items = normalizeServices(appt, services);
  const total = (appt?.totalAmountRsd ?? appt?.priceRsd ?? 0) || items.reduce((s, x) => s + (+x.priceRsd || 0), 0);

  const info = {
    apptId: r.id,
    startIso: startDate.toISOString(),
    endIso: newEndDate.toISOString(),
    employeeUsername: empU,
    employeeName: empName,
    clientName: client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : (appt?.clientName || ""),
    clientPhone: client ? (client.phone || client.phoneNumber || "") : (appt?.clientPhone || ""),
    serviceNames: items.map(s => s.name),
    priceRsd: String(total || 0),
    changeType: "RESIZE"
  };

// Prvo definiši bazu URL-a zavisno od primaoca
const base =
  actorRole === "admin" || actorRole === "salon"
    ? "/worker"            // admin/salon → radnica
    : "/admin/kalendar";   // radnica → admin


const url = `${base}?appointmentId=${info.apptId}&employeeId=${info.employeeUsername}`;

let payloadNotif = null;

if (actorRole === "admin" || actorRole === "salon") {
  // Admin/salon promenio trajanje – obavesti radnicu
  payloadNotif = {
    kind: "toEmployee",
    employeeUsername: empU,
    title: "Vaš termin je pomeren",
    body: titleDate,
    screen: url, // sada /worker...
    reason: "ADMIN_RESIZED",
    info
  };
} else if (actorRole === "worker") {
  // Radnica promenila – obavesti admina
  payloadNotif = {
    kind: "toAdmin",
    title: "Radnica je pomerila termin",
    body: `${empName} • ${titleDate}`,
    screen: url, // sada /admin...
    reason: "WORKER_RESIZED",
    info
  };
}


  if (payloadNotif) {
    await fetch("/api/pushMoveNotif", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadNotif)
    });
  }
} catch (e) {
  console.warn("pushMoveNotif (resize) error:", e);
}
// === /NOTIFIKACIJA ===

    } catch (err) {
      console.error("Failed to save resized end:", err);
      alert("Greška pri čuvanju promena.");
      setOverrideEndMap(prev => { const nm = new Map(prev); nm.delete(r.id); return nm; });
      const t = overrideTimersRef.current.get(r.id);
      if (t) { clearTimeout(t); overrideTimersRef.current.delete(r.id); }
    }
  }

  cleanupResize();
}

  function onResizingTouchEnd(ev) {
    ev.preventDefault();
    onResizingMouseUp();
  }
  function startResize(e, appt) {
    e.stopPropagation(); e.preventDefault();
    if (role === "worker" && appt.employeeUsername !== currentUsername) return;
    const body = colBodyRefs.current.get(appt.employeeUsername);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const scrollTop = body.scrollTop || 0;
    const coords = getClientCoords(e);
    document.body.classList.add("is-resizing");
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
    document.body.style.touchAction = "none";
    setTimeout(() => {
      if (resizingRef.current) {
        console.warn("Resize timeout - cleaning up");
        cleanupResize();
      }
    }, 10000);
  }
  function cleanupResize() {
    resizingRef.current = null;
    setTempEndMap(new Map());
    tempEndRef.current = new Map();
    document.body.classList.remove("is-resizing");
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";
    window.removeEventListener("mousemove", onResizingMouseMove);
    window.removeEventListener("mouseup", onResizingMouseUp);
    window.removeEventListener("touchmove", onResizingTouchMove);
    window.removeEventListener("touchend", onResizingTouchEnd);
    window.removeEventListener("click", swallowNextClick, true);
  }

  const onDragMove = debounce((ev) => {
    const d = draggingRef.current; if (!d) return;
    const targetEmp = pickColumnUnderPointer(ev.clientX, ev.clientY) ?? d.empFrom;
    const body = colBodyRefs.current.get(targetEmp);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = ev.clientY - rect.top + (body.scrollTop || 0);
    let newTopMin = DAY_START_MIN + Math.round((offsetY - d.offsetY) / PX_PER_MIN);
    newTopMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - d.durationMin, Math.round(newTopMin / 5) * 5));
    const g = { id: d.id, emp: targetEmp, topMin: newTopMin };
    setDragGhost(g);
    dragGhostRef.current = g;
  }, 16);

  const onDragTouchMove = debounce((ev) => {
    if (!draggingRef.current) return;
    ev.preventDefault();
    const coords = getClientCoords(ev);
    const d = draggingRef.current;
    const targetEmp = pickColumnUnderPointer(coords.clientX, coords.clientY) ?? d.empFrom;
    const body = colBodyRefs.current.get(targetEmp);
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const offsetY = coords.clientY - rect.top + (body.scrollTop || 0);
    let newTopMin = DAY_START_MIN + Math.round((offsetY - d.offsetY) / PX_PER_MIN);
    newTopMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN - d.durationMin, Math.round(newTopMin / 5) * 5));
    const g = { id: d.id, emp: targetEmp, topMin: newTopMin };
    setDragGhost(g);
    dragGhostRef.current = g;
  }, 16);

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
  document.body.classList.remove("is-dnd");
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

  const newStart = new Date(dayStart);
  newStart.setMinutes(ghost.topMin);
  const newEnd = new Date(newStart.getTime() + d.durationMin * 60000);
  const movedToAnotherEmp = ghost.emp !== d.empFrom;
  const msg = movedToAnotherEmp
    ? "Želite li da pomerite termin na drugu radnicu?"
    : "Želite li da pomerite ovaj termin?";
  const ok = window.confirm(msg);
  if (!ok) {
    console.log("Drag canceled by user – not saving.");
    return;
  }

  justDraggedRef.current = true;
  setTimeout(() => { justDraggedRef.current = false; }, 300);

  try {
    console.log("Saving drag changes:", {
      id: d.id,
      start: newStart.toISOString(),
      end: newEnd.toISOString(),
      employeeUsername: ghost.emp
    });

    await updateDoc(doc(db, "appointments", d.id), {
      start: newStart,
      end: newEnd,
      employeeUsername: ghost.emp,
      updatedAt: serverTimestamp()
    });

    console.log("Drag saved successfully");

    // === NOTIF nakon drag&drop-a ===
try {
  const actorRole = role; // "admin" | "salon" | "worker"
  const fmt = (x) => {
    const z = new Date(x);
    const dd = String(z.getDate()).padStart(2, "0");
    const mm = String(z.getMonth() + 1).padStart(2, "0");
    const yyyy = z.getFullYear();
    const hh = String(z.getHours()).padStart(2, "0");
    const mi = String(z.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy}. ${hh}:${mi}`;
  };
  const titleDate = `${fmt(newStart)}–${fmt(newEnd)}`;

  const empObj = (employees || []).find(e => e.username === (ghost.emp || d.empFrom));
  const empName = empObj
    ? `${empObj.firstName || ""} ${empObj.lastName || ""}`.trim()
    : (ghost.emp || "radnica");

  // ---- dopunske info o terminu ----
  const appt = (appointments || []).find(x => x.id === d.id) || {};
  const client = (clients || []).find(c => c?.id === appt?.clientId);
  const items = normalizeServices(appt, services);
  const total = (appt?.totalAmountRsd ?? appt?.priceRsd ?? 0) || items.reduce((s, x) => s + (+x.priceRsd || 0), 0);

  const info = {
    apptId: d.id,
    startIso: newStart.toISOString(),
    endIso: newEnd.toISOString(),
    previousEmployeeUsername: d.empFrom,
    newEmployeeUsername: ghost.emp,
    employeeUsername: ghost.emp,          // radi kompatibilnosti
    employeeName: empName,
    movedToAnotherEmp: movedToAnotherEmp ? "true" : "false",
    clientName: client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : (appt?.clientName || ""),
    clientPhone: client ? (client.phone || client.phoneNumber || "") : (appt?.clientPhone || ""),
    serviceNames: items.map(s => s.name),
    priceRsd: String(total || 0),
    changeType: movedToAnotherEmp ? "MOVE_TO_ANOTHER_EMP" : "MOVE_SAME_EMP"
  };

// definiši bazu linka zavisno od primaoca
const base =
  actorRole === "admin" || actorRole === "salon"
    ? "/worker"            // admin/salon → radnica
    : "/admin/kalendar";   // radnica → admin


const url = `${base}?appointmentId=${info.apptId}&employeeId=${info.employeeUsername}`;

let payloadNotif = null;

if (actorRole === "admin" || actorRole === "salon") {
  payloadNotif = movedToAnotherEmp
    ? {
        kind: "toEmployee",
        employeeUsername: ghost.emp,
        title: "Dodeljen vam je novi termin",
        body: titleDate,
        screen: url, // sada /worker...
        reason: "ADMIN_MOVED_TO_NEW_EMP",
        info
      }
    : {
        kind: "toEmployee",
        employeeUsername: ghost.emp,
        title: "Vaš termin je pomeren",
        body: titleDate,
        screen: url, // sada /worker...
        reason: "ADMIN_RESCHEDULED",
        info
      };
} else if (actorRole === "worker") {
  payloadNotif = {
    kind: "toAdmin",
    title: "Radnica je pomerila termin",
    body: `${empName} • ${titleDate}`,
    screen: url, // sada /admin...
    reason: "WORKER_RESCHEDULED",
    info
  };
}


  if (payloadNotif) {
    await fetch("/api/pushMoveNotif", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadNotif)
    });
  }
} catch (e) {
  console.warn("pushMoveNotif (drag) error:", e);
}
// === /NOTIF ===

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
    if ((ev.target)?.classList?.contains("resize-handle")) return;
    if (role === "worker" && appt.employeeUsername !== currentUsername) return;
    const isTouch = ev.type === "touchstart";
    const body = colBodyRefs.current.get(appt.employeeUsername);
    if (!body) return;
    ev.stopPropagation();
    document.body.classList.add("is-dnd");
    const startMin = Math.max(DAY_START_MIN, minsInDay(appt.start, dayStart));
    const endMin = Math.min(DAY_END_MIN, minsInDay(appt.end, dayStart));
    const durationMin = Math.max(15, endMin - startMin);
    const rect = body.getBoundingClientRect();
    const coords = getClientCoords(ev);
    const offsetY = coords.clientY - rect.top + (body.scrollTop || 0) - (top ?? 0);
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
      const touchDuration = Date.now() - touchStartTime;
      if (distance > 70 && touchDuration >= 300) {
        isDragging = true;
        ev.preventDefault();
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
      document.body.classList.remove("is-dnd");
      if (isDragging && touchDuration >= 200) {
        onDragEnd();
      } else if (touchDuration < 300) {
        setHoverAppt(null);
        openEdit(appt);
      }
      setDragGhost(null);
      draggingRef.current = null;
      dragGhostRef.current = null;
    };
    if (isTouch) {
      window.addEventListener("touchmove", onTouchMoveHandler, { passive: false });
      window.addEventListener("touchend", onTouchEndHandler);
    } else {
      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragEnd);
    }
    window.addEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";
    setTimeout(() => {
      if (draggingRef.current) {
        console.warn("Drag timeout - cleaning up");
        onDragEnd();
      }
    }, 10000);
  }
  function pickColumnUnderPointer(clientX, clientY) {
    for (const emp of visibleEmployees) {
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
  useEffect(() => {
    function computeH() {
      const el = gridWrapRef.current; if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = Math.max(300, window.innerHeight - top - 16);
      setPaneH(h);
    }
    computeH();
    window.addEventListener("resize", computeH);
    return () => window.removeEventListener("resize", computeH);
  }, []);
  useEffect(() => {
    const tick = () => setNowMinAbs(minsInDay(new Date(), startOfDay(new Date())));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => {
    for (const [, t] of overrideTimersRef.current) clearTimeout(t);
    overrideTimersRef.current.clear();
    cleanupResize();
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    window.removeEventListener("touchmove", onDragTouchMove);
    window.removeEventListener("touchend", onDragTouchEnd);
    window.removeEventListener("click", swallowNextClick, true);
    document.body.style.userSelect = "";
    document.body.style.touchAction = "";
    document.body.classList.remove("is-dnd", "is-resizing");
  }, []);
  useEffect(() => {
    const checkScroll = () => {
      if (!draggingRef.current && !resizingRef.current) {
        document.body.style.touchAction = "";
        document.body.classList.remove("is-dnd", "is-resizing");
      }
    };
    const interval = setInterval(checkScroll, 1000);
    return () => clearInterval(interval);
  }, []);
  const showNow = isSameDay(dayStart, new Date()) && nowMinAbs >= DAY_START_MIN && nowMinAbs <= DAY_END_MIN;
  const nowTop = yFromMinutes(nowMinAbs);
  const canSeePayment = role !== "worker";
  const showEmployeeFilter = role !== "worker";

  return (
    <div className="admin-cal">
      <style>{`
        html, body { overscroll-behavior: none; }
        body.is-dnd, body.is-resizing { overflow: hidden !important; position: relative; }
        .admin-cal { padding: 20px 16px 80px; }
        .cal-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .btn { padding: 8px 12px; border-radius: 10px; border: 1px solid #ddd6cc; background: #fff; cursor: pointer; font-size: 14px; touch-action: manipulation; }
        .btn:hover { background: #faf6f0; }
        .btn:active { transform: translateY(1px); }
        .title { font-weight: 800; font-size: 18px; letter-spacing: .2px; flex: 1; text-align: center; }
        .select { padding: 8px 12px; border-radius: 10px; border: 1px solid #ddd6cc; background: #fff; font-size: 16px; }
        .top-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
        .grid-wrap { display: grid; grid-template-columns: 80px 1fr; gap: 10px; height: calc(100vh - 160px); overscroll-behavior: contain; }
        .timeline { border: 1px solid #e6e0d7; border-radius: 12px; background: #fff; }
        .timeline-inner { position: relative; height: 100%; }
        .timeline-header { position: sticky; top: 0; height: ${HEADER_H}px; background: #faf6f0; border-bottom: 1px solid #e6e0d7; z-index: 2; }
        .timeline-viewport { position: relative; overflow: hidden; }
        .timeline-body { position: relative; height: ${CONTENT_H}px; will-change: transform; }
        .timeline .hour { position: absolute; left: 8px; font-size: 12px; color: #6b7280; transform: translateY(-50%); }
        .timeline .line { position: absolute; left: 0; right: 0; height: 1px; background: #eee; }
        .now-line-left { position: absolute; left: 6px; right: 6px; height: 0; border-top: 3px solid #ef4444; z-index: 5; }
        .columns-outer { border: 1px solid #e6e0d7; border-radius: 12px; background: #fff; overflow: auto; overflow-x: hidden !important; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: auto; }
        body.is-dnd .columns-outer, body.is-resizing .columns-outer { touch-action: none !important; -webkit-overflow-scrolling: auto !important; overflow: hidden !important; }
        .columns { display: grid; grid-template-columns: repeat(var(--cols, 1), minmax(140px, 1fr)); position: relative; }
        .columns--fit { grid-auto-flow: initial; grid-template-columns: repeat(var(--cols, 1), minmax(140px, 1fr)); gap: 0; min-width: 100%; }
        .col { position: relative; }
        .col:not(:first-child)::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 2px; background: #e6e0d7; opacity: .95; z-index: 2; }
        .col-header { position: sticky; top: 0; height: ${HEADER_H}px; display: flex; align-items: center; justify-content: center; font-weight: 700; background: #faf6f0; border-bottom: 1px solid #e6e0d7; font-size: 14px; padding: 0 8px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 30; container-type: inline-size; container-name: colhead; }
        .col-header .full-name { display: inline; }
        .col-header .abbr-name { display: none; }
        @container colhead (max-width: 140px) { .col-header .full-name { display: none; } .col-header .abbr-name { display: inline; } }
        .col-body { position: relative; height: ${CONTENT_H}px; padding-top: ${HEADER_H}px; box-sizing: border-box; }
        .grid-hour { position: absolute; left: 0; right: 0; height: 1px; background: #eee; z-index: 0; }
        .hover-line { position: absolute; left: 6px; right: 6px; height: 0; border-top: 1px dashed rgba(0,0,0,.25); pointer-events: none; z-index: 2; }
        .hover-badge { position: absolute; left: 50%; transform: translate(-50%,-50%); padding: 3px 8px; font-size: 12px; font-weight: 700; background: #1f1f1f; color: #fff; border-radius: 999px; border: 1px solid rgba(255,255,255,.4); white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
        .now-line-global { position: absolute; left: 0; right: 0; height: 0; border-top: 3px solid #ef4444; z-index: 4; pointer-events: none; }
        .cal-bar .bell { position: relative; display: inline-flex; align-items: center; justify-content: center; height: 40px; min-width: 44px; border: 1px solid #ddd6cc; background: #fff; border-radius: 10px; font-size: 18px; padding: 0 10px; line-height: 1; cursor: pointer; }
        .cal-bar .bell .dot { position: absolute; top: 6px; right: 6px; width: 10px; height: 10px; background: #ef4444; border-radius: 999px; box-shadow: 0 0 0 2px #fff; }
        @media (min-width: 901px) { .cal-bar { display: flex; align-items: center; gap: 10px; } .cal-bar .date-chip { order: 1; } .cal-bar .bell { order: 2; } }
        .appt { position: absolute; left: 8px; right: 8px; border-radius: 12px; padding: 8px 10px; background: var(--col, #fff); color: #1f1f1f; box-shadow: 0 1px 2px rgba(0, 0, 0, .06); cursor: grab; overflow: hidden; border: 1px solid #ddd6cc; z-index: 10; touch-action: manipulation; }
        .appt.appt--highlight { outline: 3px solid #2563eb; outline-offset: 0; animation: apptFlash 1.2s ease-out; }
        @keyframes apptFlash { 0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.35); } 70% { box-shadow: 0 0 0 12px rgba(37,99,235,0); } 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); } }
        .appt:active { cursor: grabbing; }
        .appt.block { background: #fff !important; border: 2px solid #ef4444; color: #ef4444; }
        .appt.paid { background: #f3f4f6 !important; color: #6b7280; }
        .appt .time { font-weight: 800; font-size: 12px; }
        .appt .title { font-size: 13px; margin-top: 2px; line-height: 1.2; }
        .appt .muted { color: inherit; opacity: .8; font-size: 12px; margin-top: 2px; }
        .appt .tag { display: inline-block; margin-top: 4px; font-size: 11px; border: 1px solid #e6e0d7; padding: 2px 6px; border-radius: 999px; background: #faf6f0; }
        .resize-handle { position: absolute; left: 0; right: 0; height: 10px; bottom: 0; cursor: ns-resize; }
        .resize-handle:before { content: ""; display: block; width: 36px; height: 4px; margin: 3px auto 0; border-radius: 4px; background: rgba(0,0,0,0.12); }
        .corner-icons { position: absolute; top: 6px; right: 8px; display: flex; gap: 6px; font-size: 16px; line-height: 1; filter: drop-shadow(0 1px 1px rgba(0,0,0,.15)); user-select: none; }
        .chooser-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; z-index: 50; }
        .chooser-card { background: #fff; border-radius: 16px; padding: 16px; border: 1px solid #e6e0d7; box-shadow: 0 12px 30px rgba(0,0,0,.18); min-width: 260px; max-width: 90vw; }
        .chooser-title { font-weight: 800; margin-bottom: 10px; text-align: center; font-size: 16px; }
        .chooser-actions { display: flex; gap: 10px; }
        .btn-ghost { color: #e6e0d7; padding: 10px 12px; border-radius: 12px; border: 1px solid #ddd6cc; background: #fff; cursor: pointer; flex: 1; font-size: 14px; }
        .btn-dark { padding: 10px 12px; border-radius: 12px; border: 1px solid #1f1f1f; cursor: pointer; flex: 1; font-size: 14px; }
        .chooser-card .btn-dark { background: #1f1f1f; border-color: #1f1f1f; color: #fff !important; -webkit-text-fill-color: #fff !important; }
        .hover-appt { position: fixed; z-index: 200; pointer-events: none; width: 320px; background: #ffffff; border: 1px solid #e6e0d7; border-radius: 14px; box-shadow: 0 14px 34px rgba(0,0,0,.20); overflow: hidden; background: var(--col,#fff); color: #1f1f1f; }
        .hover-appt .stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #e6e0d7; }
        .hover-appt .inner { padding: 12px 14px 12px 18px; }
        .hover-appt .time { font-weight: 800; font-size: 13px; margin-bottom: 6px; }
        .hover-appt .title { font-weight: 800; font-size: 15px; }
        .hover-appt .sub { color: #6b7280; font-size: 13px; margin-top: 2px; }
        .hover-appt .chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 2px; }
        .hover-appt .chip { font-size: 11px; font-weight: 700; line-height: 1; padding: 4px 8px; border-radius: 999px; border: 1px solid #e6e0d7; background: #faf6f0; }
        .hover-appt .price { font-weight: 800; margin-top: 6px; font-size: 14px; }
        .hover-appt .hr { height: 1px; background: #f1ebe4; margin: 10px 0; }
        .hover-appt .note-row { display: flex; gap: 8px; align-items: flex-start; }
        .hover-appt .note-ico { opacity: .7; }
        .hover-appt .note-text { font-size: 13px; color: #374151; white-space: pre-wrap; }
        .off-mask { position: absolute; left: 0; right: 0; background: rgba(0,0,0,0.06); pointer-events: none; border-radius: 0; z-index: 0; }
        .drag-ghost { position: absolute; left: 8px; right: 8px; border: 2px dashed #2563eb; background: rgba(59,130,246,0.08); border-radius: 12px; pointer-events: none; z-index: 3; }
        .cal-bar .btn-back { order: 0; }
        @media (max-width: 900px) {
          .admin-cal { padding: 52px 8px 80px; margin-top: 20px; }
          .cal-bar { display: grid; grid-template-columns: auto 1fr auto; grid-template-areas: "back date bell" "nav input input" "emp emp emp"; align-items: center; gap: 8px; margin: 12px 0; padding: 50px 4px; }
          .cal-bar .btn-back { grid-area: back; justify-self: start; }
          .cal-bar .date-chip { grid-area: date; justify-self: center; background: #faf6f0; border: 1px solid #e6e0d7; border-radius: 999px; padding: 8px 14px; font-weight: 600; font-size: 12px; letter-spacing: .2px; }
          .cal-bar .bell { grid-area: bell; justify-self: end; }
          .cal-bar .nav-group { grid-area: nav; display: grid; grid-template-columns: 44px 1fr 44px; gap: 8px; align-items: center; }
          .cal-bar .icon-btn { display: inline-flex; align-items: center; justify-content: center; height: 40px; border: 1px solid #ddd6cc; background: #fff; border-radius: 10px; font-size: 18px; padding: 0 8px; line-height: 1; }
          .cal-bar .today-btn { min-height: 40px; font-weight: 700; }
          .cal-bar .date-input { grid-area: input; width: 100%; min-height: 40px; align-self: stretch; }
          .cal-bar .top-actions { grid-area: emp; justify-self: stretch; }
          .cal-bar .emp-select { width: 100%; }
          .title { flex: unset; text-align: center; }
          .grid-wrap { grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: 8px; height: calc(100vh - 140px); }
          .timeline { order: 2; grid-row: 2; display: none; }
          .timeline-header { display: none; }
          .columns { grid-template-columns: repeat(var(--cols, 1), minmax(100px, 1fr)); }
          .columns-outer { order: 1; grid-row: 1; overflow-x: hidden !important; }
          .col-header { height: 48px; font-size: 13px; padding: 0 8px; justify-content: center; text-align: center; }
          .appt { left: 6px; right: 6px; padding: 10px 8px; min-height: 44px; font-size: 13px; border-radius: 14px; z-index: 10; }
          .appt .time { font-size: 11px; line-height: 1.2; }
          .appt .title { font-size: 12px; margin-top: 10px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; display: -webkit-box; overflow: hidden; }
          .appt .muted { font-size: 11px; margin-top: 2px; -webkit-line-clamp: 1; -webkit-box-orient: vertical; display: -webkit-box; overflow: hidden; }
          .appt .tag { font-size: 8px; padding: 2px 4px; margin-top: 2px; }
          .resize-handle { height: 12px; }
          .resize-handle:before { width: 24px; height: 3px; }
          .corner-icons { font-size: 14px; right: 4px; top: 4px; }
          .col-body .hour { display: block; position: absolute; left: 4px; font-size: 10px; color: #6b7280; transform: translateY(-50%); z-index: 0; width: 28px; text-align: right; overflow: hidden; pointer-events: none; }
          .grid-hour { left: 0; right: 0; z-index: 1; }
          .hover-line { left: 0; right: 0; }
          .now-line-global { left: 0; right: 0; }
          .off-mask { left: 0; right: 0; }
          .drag-ghost { left: 0; right: 0; }
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
          .drag-ghost { min-height: 44px; }
        }
        @media (min-width: 901px) { .col-body .hour { display: none; } }
        @media (max-width: 480px) {
          .admin-cal { padding: 8px 4px 80px; }
          .cal-bar { gap: 4px; padding: 0 2px; margin-top: 20px; }
          .btn { padding: 10px 8px; font-size: 14px; min-height: 40px; }
          .title { font-size: 15px; }
          .select { min-width: 100px; padding: 10px 8px; }
          .top-actions { gap: 2px; }
          .grid-wrap { gap: 4px; height: calc(100vh - 120px); }
          .col-header { height: 52px; font-size: 12px; }
          .appt { padding: 12px 6px; min-height: 48px; border-radius: 14px; z-index: 10; }
          .appt .time { font-size: 10px; }
          .appt .title { font-size: 11px; }
          .appt .muted { font-size: 10px; }
          .chooser-card { margin: 16px; padding: 16px; }
          .hover-appt { width: 95vw; left: 2.5vw !important; bottom: 16px !important; }
          .hover-appt .inner { padding: 12px; }
          .hover-appt .title { font-size: 15px; }
          .hover-appt .sub { font-size: 13px; }
          .col-body .hour { font-size: 9px; left: 1px; width: 22px; }
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
          .col-body { -webkit-overflow-scrolling: auto; }
        }
        .cal-bar .today-btn, .cal-bar .date-chip, .cal-bar .date-input, .cal-bar .btn, input[type="date"] {
          color: #1f1f1f !important; -webkit-text-fill-color: #1f1f1f !important; -webkit-appearance: none; appearance: none; text-decoration: none; accent-color: #1f1f1f;
        }
        input[type="date"]::-webkit-datetime-edit, input[type="date"]::-webkit-datetime-edit-fields-wrapper, input[type="date"]::-webkit-datetime-edit-text, input[type="date"]::-webkit-datetime-edit-month-field, input[type="date"]::-webkit-datetime-edit-day-field, input[type="date"]::-webkit-datetime-edit-year-field {
          color: #1f1f1f !important;
        }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: none; opacity: .8; }
        .cal-bar *, .btn, .select, input, button { -webkit-tap-highlight-color: transparent; }
        button:focus, input[type="date"]:focus { outline: 2px solid rgba(0,0,0,.15); outline-offset: 2px; }
        .notif-list { max-height: 60vh; overflow: auto; padding-right: 4px; }
        .notif-card { position: relative; border: 1px solid #e6e0d7; border-radius: 14px; padding: 12px 12px 10px 14px; margin-bottom: 10px; background: #fff; box-shadow: 0 6px 14px rgba(0,0,0,.06); }
        .notif-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; border-top-left-radius: 14px; border-bottom-left-radius: 14px; background: linear-gradient(to bottom, #f4dfe8, #e6e0d7); }
        .notif-card.booked::before { background: linear-gradient(to bottom, #d6f6df, #cdebd6); }
        .notif-card.canceled::before { background: linear-gradient(to bottom, #fde0e0, #f7cccc); }
        .notif-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .notif-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 12px; letter-spacing: .2px; background: #faf6f0; border: 1px solid #e6e0d7; padding: 4px 10px; border-radius: 999px; }
        .notif-when { opacity: .7; font-size: 12px; white-space: nowrap; }
        .notif-body { margin-top: 10px; line-height: 1.5; font-size: 14px; }
        .notif-row b { font-weight: 700; color: #1f1f1f; }
        .notif-row + .notif-row { margin-top: 2px; }
        .notif-services { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
        .notif-chip { font-size: 12px; font-weight: 700; line-height: 1; padding: 6px 8px; border-radius: 999px; border: 1px solid #e6e0d7; background: #faf6f0; }
        .notif-price { margin-top: 8px; font-weight: 800; font-size: 14px; display: inline-block; padding: 4px 10px; border-radius: 8px; border: 1px solid #e6e0d7; background: #fff; }
        .notif-cancel { margin-top: 8px; padding: 8px; border-radius: 10px; background: #fff4f4; border: 1px dashed #f2b8b8; color: #7f1d1d; font-size: 13px; }
        @media (max-width: 480px) { .notif-chip { font-size: 11px; padding: 5px 7px; } .notif-price { font-size: 13px; } }
      `}</style>

      {notifOpen && createPortal(
        <div className="chooser-backdrop" onClick={() => setNotifOpen(false)}>
          <div className="chooser-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="chooser-title">Online obaveštenja</div>
            <div className="notif-list">
              {notifItems.length === 0 ? (
                <div className="empty">Nema novijih online događaja.</div>
              ) : notifItems.map((it) => {
                const a = it.appt;
                const client = (clients || []).find(c => c?.id === a?.clientId);
                const items = normalizeServices(a, services);
                const total = (a?.totalAmountRsd ?? a?.priceRsd ?? 0) || items.reduce((s, x) => s + (+x.priceRsd || 0), 0);
                const emp = (employees || []).find(e => e.username === a?.employeeUsername);
               const when = it.ts
  ? it.ts.toLocaleString(LOCALE, { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit", year:"numeric" })
  : "—";

                const isCanceled = isCanceledAppt(a);
                
          const title = it.type === "booked" ? "Zakazano online" : "Otkazano online";
          const ico = isCanceled ? "✖" : "✓";

          return (
            <div
              key={it.id}
              className={`notif-card ${isCanceled ? "canceled" : "booked"}`}
            >
              {/* Naslov + vreme događaja */}
              <div className="notif-head">
                <span className="notif-badge" title={title}>
                  <span aria-hidden="true">{ico}</span> {title}
                </span>
                <span className="notif-when">{when}</span>
              </div>

              {/* Detalji termina */}
              <div className="notif-body">
                <div className="notif-row"><b>Klijent:</b> {formatClient(client, role)}</div>
                <div className="notif-row">
                  <b>Radnik:</b>{" "}
                  {emp ? `${emp.firstName} ${emp.lastName || ""}`.trim() : (a?.employeeUsername || "—")}
                </div>
                <div className="notif-row">
                <b>Termin:</b> {fmtDate(a?.start)} {fmtTime(a?.start)}–{fmtTime(a?.end)}


                </div>

                {Array.isArray(items) && items.length > 0 && (
                  <div className="notif-services" aria-label="Usluge">
                    {items.map((s, i) => (
                      <span key={s.id || i} className="notif-chip">{s.name || "—"}</span>
                    ))}
                  </div>
                )}

                <div className="notif-price">Ukupno: {fmtPrice(total)} RSD</div>

                {isCanceled && a?.cancelReason && (
                  <div className="notif-cancel">
                    <b>Razlog otkazivanja:</b> {a.cancelReason}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="chooser-actions" style={{ marginTop: 12 }}>
        <button className="btn-dark" onClick={() => setNotifOpen(false)}>Zatvori</button>
      </div>
    </div>
  </div>,
  document.body
)}


      <div className="admin-cal">
        <div className="cal-bar">
  {/* ← Nazad */}
    <button
    type="button"
    className="btn btn-back"
    onClick={() => (window.history.length > 1 ? window.history.back() : null)}
    aria-label="Nazad"
    title="Nazad"
  >
    ← Nazad
  </button>

  {/* ZVONO (notifikacije) */}
  <button
    type="button"
    className="bell"
    onClick={openNotifModal}
    title="Online obaveštenja"
    aria-label="Online obaveštenja"
  >
    <span role="img" aria-hidden="true">🔔</span>
    {hasUnread && <span className="dot" />}
  </button>

  {/* Datum (lepa “pilula” na mobilnom) */}
  <div className="title date-chip">
  {dayStart.toLocaleDateString(LOCALE, {
  weekday:"long", day:"2-digit", month:"long", year:"numeric"
})}

  </div>

  {/* Strelice + Danas – kompaktan red na mobilnom */}
  <div className="nav-group">
    <button className="icon-btn" onClick={()=>setDay(d=>{const x=new Date(d); x.setDate(x.getDate()-1); return startOfDay(x);})}>‹</button>
    <button className="btn today-btn" onClick={()=>setDay(startOfDay(new Date()))}>Danas</button>
    <button className="icon-btn" onClick={()=>setDay(d=>{const x=new Date(d); x.setDate(x.getDate()+1); return startOfDay(x);})}>›</button>
  </div>

  {/* Ručni izbor datuma */}
  <input
    type="date"
    className="select date-input"
    value={dateToInputValue(dayStart)}
    onChange={e=>{
      const v=e.target.value;
      if(v){ const next=new Date(v+"T00:00:00"); setDay(startOfDay(next)); }
    }}
  />


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

<div
  className="columns columns--fit"
  style={{ "--cols": visibleEmployees.length }}
>



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
  <span className="full-name">
    {emp.firstName} {emp.lastName}
  </span>
  <span className="abbr-name">
    {emp.firstName} {emp.lastName ? (emp.lastName[0].toUpperCase() + ".") : ""}
  </span>
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
                            <div className="hour" style={{ top:y }}>{hh}:00</div>
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
                            data-appt-id={a.id}
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
  {client ? formatClient(client, role) : (a.clientName || a.clientEmail || a.clientPhone || "—")}
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
                <div className="title">
  {client ? formatClient(client, role) : (a.clientName || a.clientEmail || a.clientPhone || "—")}
</div>

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