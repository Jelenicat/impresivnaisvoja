// src/pages/booking/BookingTime.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  collection, onSnapshot, query, orderBy, where, doc,
  serverTimestamp, getDocsFromServer, getDocFromServer, writeBatch,
} from "firebase/firestore";
import { db } from "../../firebase";

/* ---------- Salon sati (1=pon .. 7=ned) ---------- */
const SALON_HOURS = {
  1: [{ start: "08:00", end: "21:00" }],
  2: [{ start: "08:00", end: "21:00" }],
  3: [{ start: "08:00", end: "21:00" }],
  4: [{ start: "08:00", end: "21:00" }],
  5: [{ start: "08:00", end: "21:00" }],
  6: [{ start: "08:00", end: "16:00" }],
  7: [],
};
const MIN_STEP = 60;
const LOAD_TIMEOUT_MS = 15000;
const PATTERN_WEEKS = { "1w": 1, "2w": 2, "3w": 3, "4w": 4 };

/* ---------- Datumi i intervali ---------- */
const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};
const startOfToday = () => startOfDay(new Date());
const addMin = (d, minutes) => new Date(d.getTime() + minutes * 60000);
const wd1to7 = (d) => d.getDay() || 7;
const jsDayToIdx = (d) => (d.getDay() + 6) % 7;
const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const hhmm = (d) => d.toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit", hour12: false });
const nice = (d, options = {}) => d.toLocaleString("sr-RS", options);
const niceDate = (d) => d.toLocaleDateString("sr-RS", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const iv = (start, end) => ({ start, end });
const mOf = (d) => d.getHours() * 60 + d.getMinutes();
const atMinute = (day, minute) => {
  const d = startOfDay(day);
  d.setMinutes(minute);
  return d;
};
function asDate(value) {
  if (value == null || value === "") return null;
  const d = value?.toDate?.() || new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
function parseLocalYmd(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return dayKey(date) === value ? date : null;
}
function hmToMin(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return NaN;
  const h = Number(match[1]), m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : NaN;
}
function* iterDays(from, count) {
  const d = startOfDay(from);
  for (let i = 0; i < count; i++) {
    yield new Date(d);
    d.setDate(d.getDate() + 1);
  }
}
function subtractIntervals(freeMins, busyMins) {
  let result = [...freeMins];
  for (const busy of busyMins) {
    const next = [];
    for (const free of result) {
      if (busy.end <= free.start || busy.start >= free.end) {
        next.push(free);
        continue;
      }
      if (busy.start > free.start) next.push(iv(free.start, busy.start));
      if (busy.end < free.end) next.push(iv(busy.end, free.end));
    }
    result = next;
  }
  return result;
}
function slotsFromMinuteIntervals(day, intervals, durationMin) {
  if (!Number.isInteger(durationMin) || durationMin <= 0) return [];
  const step = durationMin >= 120 ? 120 : MIN_STEP;
  const out = [];
  for (const seg of intervals) {
    for (let minute = seg.start; minute + durationMin <= seg.end; minute += step) {
      const start = atMinute(day, minute);
      out.push({ start, end: addMin(start, durationMin) });
    }
  }
  return out;
}

/* ---------- Osnovne smene + oba formata dnevnih izuzetaka ---------- */
function normalizeDay(day) {
  if (!day) return null;
  if (day.closed) return { from: "", to: "", closed: true };
  const from = hmToMin(day.from), to = hmToMin(day.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  return { from: day.from, to: day.to, closed: false };
}
function composeSchedules(rows) {
  const buckets = new Map();
  const createdTime = (s) => asDate(s.createdAt)?.getTime() || 0;
  const modifiedTime = (s) => asDate(s.updatedAt)?.getTime() || createdTime(s);
  // Stabilan izbor i kada više dokumenata sadrži izuzetak za isti dan.
  const sorted = [...rows].sort((a, b) =>
    modifiedTime(b) - modifiedTime(a) || createdTime(b) - createdTime(a) ||
    String(b.id).localeCompare(String(a.id))
  );
  for (const row of sorted) {
    const username = row.employeeUsername;
    if (!username) continue;
    if (!buckets.has(username)) buckets.set(username, { base: null, overrides: {} });
    const bucket = buckets.get(username);
    const isOneDay = row.kind === "override" || row.pattern === "custom-1d" ||
      (!!row.startDate && row.startDate === row.endDate);

    if (isOneDay) {
      const date = parseLocalYmd(row.startDate);
      if (date && !Object.prototype.hasOwnProperty.call(bucket.overrides, row.startDate)) {
        const cell = row.weeks?.["0"]?.[jsDayToIdx(date)];
        bucket.overrides[row.startDate] = normalizeDay(cell) || { closed: true };
      }
    } else if (!bucket.base || createdTime(row) > createdTime(bucket.base)) {
      // Izmena starog dokumenta ne pretvara ga u najnoviji osnovni raspored.
      bucket.base = row;
    }

    for (const [date, day] of Object.entries(row.overrides || {})) {
      if (parseLocalYmd(date) && !Object.prototype.hasOwnProperty.call(bucket.overrides, date)) {
        bucket.overrides[date] = normalizeDay(day) || { closed: true };
      }
    }
  }
  const result = {};
  for (const [username, bucket] of buckets) {
    result[username] = { ...(bucket.base || {}), overrides: bucket.overrides };
  }
  return result;
}
function pickDayFromSchedule(schedule, date) {
  if (!schedule) return null;
  const key = dayKey(date);
  if (Object.prototype.hasOwnProperty.call(schedule.overrides || {}, key)) {
    return normalizeDay(schedule.overrides[key]);
  }
  const start = parseLocalYmd(schedule.startDate);
  if (!start || key < schedule.startDate) return null;
  if (schedule.endDate && (!parseLocalYmd(schedule.endDate) || key > schedule.endDate)) return null;
  // Razlika kalendarskih dana: prelazak na letnje/zimsko vreme ne pomera nedelju.
  const utcDay = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((utcDay(date) - utcDay(start)) / 86400000);
  const weekCount = PATTERN_WEEKS[schedule.pattern] || 1;
  const weekIdx = Math.floor(diffDays / 7) % weekCount;
  return normalizeDay(schedule.weeks?.[String(weekIdx)]?.[jsDayToIdx(date)]);
}
function workingIntervals(schedule, date) {
  const day = pickDayFromSchedule(schedule, date);
  if (!day || day.closed) return [];
  const from = hmToMin(day.from), to = hmToMin(day.to);
  return (SALON_HOURS[wd1to7(date)] || [])
    .map((salon) => iv(Math.max(from, hmToMin(salon.start)), Math.min(to, hmToMin(salon.end))))
    .filter((seg) => seg.start < seg.end);
}
function withinWorkingHours(schedule, start, end) {
  if (!asDate(start) || !asDate(end) || end <= start || dayKey(start) !== dayKey(end)) return false;
  return workingIntervals(schedule, start).some((seg) =>
    start >= atMinute(start, seg.start) && end <= atMinute(start, seg.end)
  );
}
function intervalIsFree(busy, start, end) {
  // Nedostajući podaci nisu dokaz da je radnica slobodna.
  if (!Array.isArray(busy)) return false;
  return !busy.some((seg) => start < atMinute(start, seg.end) && end > atMinute(start, seg.start));
}
function dayAppointmentsQuery(username, day) {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  // Obuhvata i blokadu/rezervaciju koja je počela prethodnog dana.
  // Ista vrsta overlap upita koju je ranije koristila završna hasConflict provera.
  return query(collection(db, "appointments"),
    where("employeeUsername", "==", username),
    where("start", "<", end), where("end", ">", start));
}
function readBusyIntervals(snapshot, day) {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const result = [];
  for (const row of snapshot.docs) {
    const data = row.data();
    const st = asDate(data.start), en = asDate(data.end);
    if (!st || !en || en <= st) throw new Error(`Neispravan interval rezervacije: ${row.id}`);
    if (st >= end || en <= start) continue;
    const from = st <= start ? 0 : mOf(st);
    const to = en >= end ? 1440 : mOf(en) + (en.getSeconds() || en.getMilliseconds() ? 1 : 0);
    result.push(iv(from, to));
  }
  return result;
}

/* ---------- Učitavanje: samo podaci potvrđeni sa servera ---------- */
function serverConfirmed(snapshot) {
  return !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
}
function useServerCollection(name, reloadKey) {
  const [data, setData] = useState({ key: -1, rows: [], ready: false, error: "" });
  useEffect(() => {
    let active = true;
    let timer;
    setData({ key: reloadKey, rows: [], ready: false, error: "" });
    const waitForServer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) setData((prev) => prev.ready ? prev : {
          ...prev, error: "Podaci se nisu učitali. Proveri vezu i pokušaj ponovo.",
        });
      }, LOAD_TIMEOUT_MS);
    };
    waitForServer();
    const ref = name === "employees"
      ? query(collection(db, name), orderBy("username")) : collection(db, name);
    const unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
      if (!active) return;
      if (!serverConfirmed(snapshot)) {
        setData((prev) => ({ ...prev, key: reloadKey, ready: false }));
        waitForServer();
        return;
      }
      clearTimeout(timer);
      setData({ key: reloadKey, rows: snapshot.docs.map((d) => ({ ...d.data(), id: d.id })), ready: true, error: "" });
    }, (error) => {
      if (!active) return;
      clearTimeout(timer);
      console.error(`BookingTime: učitavanje ${name}`, error);
      setData((prev) => ({ ...prev, key: reloadKey, ready: false, error: "Ne mogu da proverim dostupnost. Pokušaj ponovo." }));
    });
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [name, reloadKey]);
  return data.key === reloadKey ? data : { key: reloadKey, rows: [], ready: false, error: "" };
}
function useDayBusy(dayString, usernamesKey, reloadKey, enabled) {
  const requestKey = JSON.stringify([dayString, usernamesKey, reloadKey, enabled]);
  const [data, setData] = useState({ key: "", entries: new Map(), error: "" });
  useEffect(() => {
    let active = true;
    let timer;
    const users = JSON.parse(usernamesKey);
    const day = parseLocalYmd(dayString);
    setData({ key: requestKey, entries: new Map(), error: "" });
    if (!enabled || !day || !users.length) return () => { active = false; };

    const waitForServer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active) return;
        setData((prev) => users.every((u) => prev.entries.get(u)?.ready) ? prev : {
          ...prev, error: "Zauzeti termini se nisu učitali. Proveri vezu i pokušaj ponovo.",
        });
      }, LOAD_TIMEOUT_MS);
    };
    const put = (username, entry) => {
      if (!active) return;
      setData((prev) => {
        if (prev.key !== requestKey) return prev;
        const entries = new Map(prev.entries);
        entries.set(username, entry);
        const allReady = users.every((u) => entries.get(u)?.ready);
        return { key: requestKey, entries, error: allReady ? "" : prev.error };
      });
    };
    waitForServer();
    const unsubs = users.map((username) => onSnapshot(
      dayAppointmentsQuery(username, day), { includeMetadataChanges: true },
      (snapshot) => {
        if (!active) return;
        if (!serverConfirmed(snapshot)) {
          put(username, { ready: false, busy: null, error: "" });
          waitForServer();
          return;
        }
        try {
          put(username, { ready: true, busy: readBusyIntervals(snapshot, day), error: "" });
        } catch (error) {
          console.error("BookingTime: neispravno zauzeće", error);
          put(username, { ready: false, busy: null, error: "Ne mogu da proverim zauzeća za ovaj datum. Kontaktiraj salon." });
        }
      },
      (error) => {
        if (!active) return;
        console.error("BookingTime: učitavanje zauzeća", error);
        put(username, { ready: false, busy: null, error: "Ne mogu da proverim zauzeća. Pokušaj ponovo." });
      }
    ));
    return () => { active = false; clearTimeout(timer); unsubs.forEach((unsubscribe) => unsubscribe()); };
  }, [dayString, usernamesKey, reloadKey, enabled, requestKey]);

  const users = JSON.parse(usernamesKey);
  const current = data.key === requestKey;
  const ready = enabled && (!users.length || (current && users.every((u) => data.entries.get(u)?.ready)));
  const busyByEmp = new Map();
  if (current) {
    for (const [username, entry] of data.entries) if (entry.ready) busyByEmp.set(username, entry.busy);
  }
  const error = current ? ([...data.entries.values()].find((e) => e.error)?.error || data.error) : "";
  return { ready, busyByEmp, error };
}

/* ---------- Usluge i klijent ---------- */
function canEmployeeDo(service, employee) {
  if (!employee || employee.active === false) return false;
  const sids = Array.isArray(employee.serviceId) ? employee.serviceId : Array.isArray(employee.serviceIds) ? employee.serviceIds : [];
  const cids = Array.isArray(employee.categoryIds) ? employee.categoryIds : [];
  return sids.includes(service.serviceId || service.id) || (!!service.categoryId && cids.includes(service.categoryId));
}
function freshService(item, fresh) {
  return {
    ...item,
    serviceId: item.serviceId || item.id,
    name: fresh.name ?? item.name ?? "",
    durationMin: Number(fresh.durationMin),
    priceRsd: Number(fresh.priceRsd),
    categoryId: fresh.categoryId ?? null,
    categoryName: fresh.categoryName ?? item.categoryName ?? null,
    description: fresh.description ?? "",
  };
}
function serviceSignature(services) {
  return JSON.stringify(services.map((s) => [s.serviceId, s.name, s.durationMin, s.priceRsd, s.categoryId]));
}
function validService(service) {
  return !!service.serviceId && Number.isInteger(service.durationMin) && service.durationMin > 0 &&
    service.durationMin <= 1440 && Number.isFinite(service.priceRsd) && service.priceRsd >= 0;
}
function getLoggedClient() {
  try {
    const raw = localStorage.getItem("clientProfile");
    if (raw) {
      const p = JSON.parse(raw);
      return { id: p.id || null, name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), phone: p.phone || "", email: p.email || "" };
    }
    return {
      id: localStorage.getItem("clientId") || localStorage.getItem("userId") || null,
      name: localStorage.getItem("clientName") || localStorage.getItem("displayName") || "",
      phone: localStorage.getItem("clientPhone") || localStorage.getItem("phone") || "",
      email: localStorage.getItem("clientEmail") || localStorage.getItem("email") || "",
    };
  } catch { return { id: null, name: "", phone: "", email: "" }; }
}
function getCartKey() {
  try {
    const p = JSON.parse(localStorage.getItem("clientProfile") || "null");
    return `bookingCart:${p?.id || "anon"}`;
  } catch { return "bookingCart:anon"; }
}
function readCart() {
  try {
    const key = getCartKey();
    const raw = localStorage.getItem(key) || localStorage.getItem("bookingCart") || "[]";
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    const cart = rows.filter((s) => {
      const id = s?.serviceId || s?.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map((s) => ({ ...s, serviceId: s.serviceId || s.id }));
    try {
      localStorage.setItem(key, JSON.stringify(cart));
      localStorage.removeItem("bookingCart");
    } catch { /* Korpa ostaje dostupna u memoriji. */ }
    return cart;
  } catch { return []; }
}
function splitName(full = "") {
  const parts = String(full).trim().split(/\s+/);
  return { first: parts.shift() || "", last: parts.join(" ") };
}
function bookingError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}
function assertServerSnapshot(snapshot) {
  if (!serverConfirmed(snapshot)) throw bookingError("Podaci još nisu potvrđeni. Sačekaj i izaberi termin ponovo.");
}
function groupServicesByCategory(services) {
  const groups = new Map();
  for (const service of services) {
    const key = service.categoryId || "nocat";
    if (!groups.has(key)) groups.set(key, { categoryId: key, categoryName: service.categoryName || null, services: [] });
    groups.get(key).services.push(service);
  }
  return [...groups.values()];
}

export default function BookingTime() {
  const nav = useNavigate();
  const { state } = useLocation();
  const chosenEmployeeId = state?.employee || "firstFree";
  const client = useMemo(() => getLoggedClient(), []);
  const [clock, setClock] = useState(() => Date.now());
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [reloadKey, setReloadKey] = useState(0);
  const [storedCart, setStoredCart] = useState(readCart);
  const [selectedIds, setSelectedIds] = useState(() => storedCart.map((s) => s.serviceId));
  const [selectedDay, setSelectedDay] = useState(startOfToday);
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmData, setConfirmData] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef(new Set());
  const [mismatch, setMismatch] = useState({ open: false, doable: [], notDoable: [], proceedCb: null, backCb: null });

  const pushToast = useCallback((text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, text }]);
    const timer = setTimeout(() => {
      toastTimers.current.delete(timer);
      if (mountedRef.current) setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
    toastTimers.current.add(timer);
  }, []);
  const saveCart = useCallback((nextCart) => {
    setStoredCart(nextCart);
    try { localStorage.setItem(getCartKey(), JSON.stringify(nextCart)); }
    catch (error) { console.warn("BookingTime: korpa nije sačuvana lokalno", error); }
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      toastTimers.current.forEach(clearTimeout);
      toastTimers.current.clear();
    };
  }, []);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      setOnline(navigator.onLine !== false);
      setClock(Date.now());
      setReloadKey((key) => key + 1);
    };
    const offline = () => setOnline(false);
    const timer = setInterval(() => setClock(Date.now()), 15000);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  const todayString = dayKey(new Date(clock));
  const today0 = useMemo(() => parseLocalYmd(todayString), [todayString]);
  const maxDate = useMemo(() => {
    const date = new Date(today0);
    date.setDate(date.getDate() + 14);
    return date;
  }, [today0]);
  const selectedDayString = dayKey(selectedDay);
  const dayInRange = selectedDay >= today0 && selectedDay <= maxDate;
  const employeesState = useServerCollection("employees", reloadKey);
  const schedulesState = useServerCollection("schedules", reloadKey);
  const servicesState = useServerCollection("services", reloadKey);
  const employees = employeesState.rows;
  const chosenEmployee = employees.find((e) => e.username === chosenEmployeeId) || null;
  const latestByUser = useMemo(() => composeSchedules(schedulesState.rows), [schedulesState.rows]);
  const serviceMap = useMemo(() => new Map(servicesState.rows.map((s) => [s.id, s])), [servicesState.rows]);
  const cart = useMemo(() => {
    if (!servicesState.ready) return storedCart;
    return storedCart.filter((s) => serviceMap.has(s.serviceId))
      .map((s) => freshService(s, serviceMap.get(s.serviceId)));
  }, [storedCart, servicesState.ready, serviceMap]);

  // Keš nikada ne prazni korpu. Usklađivanje je dozvoljeno tek posle odgovora servera.
  useEffect(() => {
    if (!servicesState.ready || JSON.stringify(cart) === JSON.stringify(storedCart)) return;
    const ids = new Set(cart.map((s) => s.serviceId));
    const removed = storedCart.filter((s) => !ids.has(s.serviceId));
    saveCart(cart);
    if (removed.length) {
      setSelectedIds((prev) => prev.filter((id) => ids.has(id)));
      pushToast(`Usluga više nije dostupna: ${removed.map((s) => s.name || "usluga").join(", ")}.`);
    }
  }, [cart, storedCart, servicesState.ready, saveCart, pushToast]);

  const initialSelectionFor = useRef(null);
  useEffect(() => {
    if (!employeesState.ready || !servicesState.ready || initialSelectionFor.current === chosenEmployeeId) return;
    initialSelectionFor.current = chosenEmployeeId;
    setSelectedIds(cart.filter((s) => chosenEmployeeId === "firstFree" || canEmployeeDo(s, chosenEmployee)).map((s) => s.serviceId));
  }, [employeesState.ready, servicesState.ready, chosenEmployeeId, chosenEmployee, cart]);

  const selectedServices = useMemo(() => cart.filter((s) => selectedIds.includes(s.serviceId)), [cart, selectedIds]);
  const remainingServices = useMemo(() => cart.filter((s) => !selectedIds.includes(s.serviceId)), [cart, selectedIds]);
  const selectedSignature = serviceSignature(selectedServices);
  const selectionValid = selectedServices.length > 0 && selectedServices.every(validService);
  const totalDurationMin = selectedServices.reduce((sum, s) => sum + (Number(s.durationMin) || 0), 0);
  const totalAmountRsd = selectedServices.reduce((sum, s) => sum + (Number(s.priceRsd) || 0), 0);
  const baseReady = online && employeesState.ready && schedulesState.ready && servicesState.ready;
  const workingEmployees = useMemo(() => {
    if (!baseReady || !selectionValid || !dayInRange) return [];
    return employees.filter((e) =>
      (chosenEmployeeId === "firstFree" || e.username === chosenEmployeeId) &&
      selectedServices.every((s) => canEmployeeDo(s, e)) &&
      workingIntervals(latestByUser[e.username], selectedDay).length > 0
    );
  }, [baseReady, selectionValid, dayInRange, employees, chosenEmployeeId, selectedServices, latestByUser, selectedDay]);
  const usernamesKey = JSON.stringify([...new Set(workingEmployees.map((e) => e.username))].sort());
  const busyState = useDayBusy(selectedDayString, usernamesKey, reloadKey, baseReady && selectionValid && dayInRange);
  const busyByEmp = busyState.busyByEmp;
  const availabilityError = !online ? "Nema internet veze. Poveži se da proverimo slobodne termine." :
    (employeesState.error || schedulesState.error || servicesState.error || busyState.error || "");
  const availabilityReady = baseReady && selectionValid && dayInRange && busyState.ready && !availabilityError;
  const loadingSlots = !availabilityError && dayInRange && (!baseReady || (selectionValid && !busyState.ready));
  const anyWork = workingEmployees.length > 0;

  // Nijedan slot se ne računa iz nedostajućih zauzeća ili podataka za drugi datum.
  const slots = useMemo(() => {
    if (!availabilityReady) return [];
    const result = [];
    for (const employee of workingEmployees) {
      const busy = busyByEmp.get(employee.username);
      if (!Array.isArray(busy)) return [];
      const free = subtractIntervals(workingIntervals(latestByUser[employee.username], selectedDay), busy);
      result.push(...slotsFromMinuteIntervals(selectedDay, free, totalDurationMin)
        .map((slot) => ({ ...slot, employeeId: employee.username })));
    }
    return result.filter((slot) => slot.start.getTime() >= clock)
      .sort((a, b) => a.start - b.start || a.employeeId.localeCompare(b.employeeId));
  }, [availabilityReady, workingEmployees, busyByEmp, latestByUser, selectedDay, totalDurationMin, clock]);

  const daysInMonth = useMemo(() => [...iterDays(startOfMonth(anchor), 31)]
    .filter((d) => d.getMonth() === anchor.getMonth()), [anchor]);
  const canGoPrev = startOfMonth(anchor) > startOfMonth(today0);
  const canGoNext = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) <= maxDate;
  const contextKey = JSON.stringify([selectedDayString, chosenEmployeeId]);
  const confirmEmployee = employees.find((e) => e.username === confirmData?.employeeId);
  const confirmationValid = !!(confirmData && availabilityReady &&
    confirmData.contextKey === contextKey && confirmData.signature === selectedSignature &&
    confirmData.start.getTime() >= clock && confirmEmployee &&
    selectedServices.every((s) => canEmployeeDo(s, confirmEmployee)) &&
    withinWorkingHours(latestByUser[confirmData.employeeId], confirmData.start, confirmData.end) &&
    intervalIsFree(busyByEmp.get(confirmData.employeeId), confirmData.start, confirmData.end));
  const liveStateRef = useRef(null);
  liveStateRef.current = { contextKey, selectedSignature, confirmationValid };

  useEffect(() => {
    if (!confirmOpen || !confirmData || savingRef.current || confirmationValid) return;
    setConfirmOpen(false);
    setConfirmData(null);
    pushToast("Podaci o terminu su promenjeni ili se ponovo proveravaju. Izaberi termin ponovo.");
  }, [confirmOpen, confirmData, confirmationValid, pushToast]);

  function retryAvailability() {
    if (savingRef.current) return;
    setConfirmOpen(false);
    setConfirmData(null);
    setOnline(navigator.onLine !== false);
    setClock(Date.now());
    setReloadKey((key) => key + 1);
  }
  function ensureValidForEmployeeUsername(username, callback) {
    const employee = employees.find((e) => e.username === username);
    if (!employee || employee.active === false) {
      pushToast("Ova radnica trenutno nije dostupna. Izaberi drugu.");
      return;
    }
    const doable = selectedServices.filter((s) => canEmployeeDo(s, employee));
    const notDoable = selectedServices.filter((s) => !canEmployeeDo(s, employee));
    if (!notDoable.length) { callback(); return; }
    setMismatch({
      open: true, doable, notDoable,
      proceedCb: doable.length ? () => {
        setSelectedIds(doable.map((s) => s.serviceId));
        // Trajanje se promenilo: ne otvarati potvrdu starog slota.
        pushToast("Izbor usluga je promenjen. Izaberi vreme ponovo.");
      } : null,
      backCb: () => nav("/booking/employee", { state: { reason: "pick-employee-for-remaining" } }),
    });
  }
  function ensureValidSelectionForEmployee(callback) {
    if (chosenEmployeeId === "firstFree") { callback(); return; }
    ensureValidForEmployeeUsername(chosenEmployeeId, callback);
  }
  function pickSlot(option) {
    if (savingRef.current || !availabilityReady) return;
    const slot = slots.find((s) => s.employeeId === option.employeeId &&
      s.start.getTime() === option.start.getTime() && s.end.getTime() === option.end.getTime());
    if (!slot || slot.start < new Date()) {
      pushToast("Ovaj termin više nije dostupan. Izaberi drugi.");
      return;
    }
    ensureValidForEmployeeUsername(slot.employeeId, () => {
      setConfirmData({ ...slot, contextKey, signature: selectedSignature });
      setConfirmOpen(true);
    });
  }

  async function confirmBooking() {
    // Ref sprečava dva klika i pre nego što React onemogući dugme.
    if (savingRef.current || !confirmOpen || !confirmData) return;
    if (!confirmationValid) {
      retryAvailability();
      pushToast("Termin mora ponovo da se proveri. Izaberi vreme ponovo.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const attempt = { ...confirmData };
    const cartForBooking = [...cart];
    const selectedSet = new Set(selectedIds);
    try {
      if (navigator.onLine === false) throw bookingError("Nema internet veze. Termin nije potvrđen.");

      // Pripremi klijenta bez upisa: klijent i sve kartice čuvaju se zajedno.
      let clientId = client.id || null;
      if (!clientId && client.phone) {
        const snapshot = await getDocsFromServer(query(collection(db, "clients"), where("phone", "==", client.phone)));
        assertServerSnapshot(snapshot);
        if (!snapshot.empty) clientId = snapshot.docs[0].id;
      }
      if (!clientId && client.email) {
        const snapshot = await getDocsFromServer(query(collection(db, "clients"), where("email", "==", client.email)));
        assertServerSnapshot(snapshot);
        if (!snapshot.empty) clientId = snapshot.docs[0].id;
      }
      const isNewClient = !clientId;
      const clientRef = clientId ? doc(db, "clients", String(clientId)) : doc(collection(db, "clients"));
      clientId = clientRef.id;
      const employee = employees.find((e) => e.username === attempt.employeeId);
      if (!employee) throw bookingError("Radnica više nije dostupna. Izaberi drugu.");

      // Sve provere dostupnosti i cenovnika moraju dobiti odgovor SERVERA.
      // Greška, keš ili prekid veze prekidaju potvrdu pre upisa rezervacija.
      const [serviceResults, employeeSnap, schedulesSnap, busySnap] = await Promise.all([
        Promise.all(cartForBooking.map(async (item) => {
          const snapshot = await getDocFromServer(doc(db, "services", item.serviceId));
          assertServerSnapshot(snapshot);
          return snapshot.exists() ? freshService(item, snapshot.data()) : null;
        })),
        getDocFromServer(doc(db, "employees", employee.id)),
        getDocsFromServer(query(collection(db, "schedules"), where("employeeUsername", "==", attempt.employeeId))),
        getDocsFromServer(dayAppointmentsQuery(attempt.employeeId, attempt.start)),
      ]);
      [employeeSnap, schedulesSnap, busySnap].forEach(assertServerSnapshot);
      const latestCartForBooking = serviceResults.filter(Boolean);
      const bookingServices = latestCartForBooking.filter((s) => selectedSet.has(s.serviceId));
      saveCart(latestCartForBooking);
      if (!bookingServices.length || bookingServices.length !== selectedServices.length) {
        setSelectedIds((prev) => prev.filter((id) => latestCartForBooking.some((s) => s.serviceId === id)));
        throw bookingError("Neka od izabranih usluga više nije dostupna. Izaberi usluge i termin ponovo.");
      }
      if (serviceSignature(bookingServices) !== attempt.signature) {
        throw bookingError("Cena, trajanje ili usluga su promenjeni. Proveri novi izbor pa izaberi vreme ponovo.");
      }
      if (!bookingServices.every(validService)) throw bookingError("Trajanje ili cena usluge nisu ispravno podešeni. Kontaktiraj salon.");
      const freshEmployee = employeeSnap.exists() ? { ...employeeSnap.data(), id: employeeSnap.id } : null;
      if (!freshEmployee || freshEmployee.username !== attempt.employeeId ||
          !bookingServices.every((s) => canEmployeeDo(s, freshEmployee))) {
        throw bookingError("Ova radnica više nije dostupna za sve izabrane usluge. Izaberi drugu.");
      }

      const bookingDuration = bookingServices.reduce((sum, s) => sum + s.durationMin, 0);
      const bookingEnd = addMin(attempt.start, bookingDuration);
      const freshSchedules = composeSchedules(schedulesSnap.docs.map((d) => ({ ...d.data(), id: d.id })));
      if (bookingEnd.getTime() !== attempt.end.getTime() ||
          !withinWorkingHours(freshSchedules[attempt.employeeId], attempt.start, bookingEnd)) {
        throw bookingError("Ovaj termin ne staje u važeće radno vreme radnice ili salona. Izaberi drugi termin.");
      }
      if (!intervalIsFree(readBusyIntervals(busySnap, attempt.start), attempt.start, bookingEnd)) {
        throw bookingError("Termin je u međuvremenu zauzet ili blokiran. Izaberi drugi.");
      }
      const latestAllowedDay = startOfToday();
      latestAllowedDay.setDate(latestAllowedDay.getDate() + 14);
      if (attempt.start < new Date() || startOfDay(attempt.start) > latestAllowedDay) {
        throw bookingError("Vreme za ovaj termin više nije dostupno. Izaberi drugi termin.");
      }
      const live = liveStateRef.current;
      if (!mountedRef.current || navigator.onLine === false || !live.confirmationValid ||
          live.contextKey !== attempt.contextKey || live.selectedSignature !== attempt.signature) {
        throw bookingError("Podaci su se promenili tokom provere. Izaberi termin ponovo.");
      }

      const safeClientName = String(client.name || client.phone || client.email || "").trim();
      const { first: firstName, last: lastName } = splitName(safeClientName);
      const bookingTotalAmount = bookingServices.reduce((sum, s) => sum + s.priceRsd, 0);
      const groups = groupServicesByCategory(bookingServices);
      if (groups.length > 450) throw bookingError("Previše usluga u jednom zakazivanju. Smanji izbor.");
      const batch = writeBatch(db);
      batch.set(clientRef, {
        firstName, lastName, displayName: safeClientName,
        phone: client.phone || "", email: String(client.email || "").toLowerCase(),
        updatedAt: serverTimestamp(),
        ...(isNewClient ? { createdAt: serverTimestamp(), source: "public_app" } : {}),
      }, { merge: true });
      const createdIds = [];
      let rollingStart = new Date(attempt.start);
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const duration = group.services.reduce((sum, s) => sum + s.durationMin, 0);
        const amount = group.services.reduce((sum, s) => sum + s.priceRsd, 0);
        const end = addMin(rollingStart, duration);
        const names = group.services.map((s) => s.name).filter(Boolean);
        const serviceSnapshots = group.services.map((s) => ({
          id: s.serviceId, serviceId: s.serviceId, name: s.name,
          durationMin: s.durationMin, priceRsd: s.priceRsd,
          categoryId: s.categoryId || null, categoryName: s.categoryName || null,
          description: s.description || "",
        }));
        const ref = doc(collection(db, "appointments"));
        batch.set(ref, {
          start: new Date(rollingStart), end, date: dayKey(rollingStart),
          employeeId: attempt.employeeId, employeeUsername: attempt.employeeId,
          services: serviceSnapshots, serviceSnapshots,
          servicesIds: group.services.map((s) => s.serviceId),
          serviceIds: group.services.map((s) => s.serviceId),
          totalDurationMin: duration, totalAmountRsd: amount, priceRsd: amount,
          servicesLabel: names.join(", "), servicesFirstName: names[0] || null,
          servicesCategoryId: group.categoryId, servicesCategoryName: group.categoryName || null,
          groupIndex: i + 1, groupCount: groups.length,
          clientId, clientName: safeClientName || "Klijent",
          clientPhone: client.phone || "", clientEmail: String(client.email || "").toLowerCase(),
          clientPhoneNorm: String(client.phone || "").replace(/\D+/g, ""),
          isOnline: true, bookedVia: "public_app",
          pickedMode: chosenEmployeeId === "firstFree" ? "firstFree" : "specific",
          isPaid: false, paymentStatus: "unpaid", paymentMethod: null,
          status: "booked", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          createdBy: clientId || "public",
        });
        createdIds.push(ref.id);
        rollingStart = end;
      }

      // Atomski čuva SVE kategorije ili nijednu; nema delimične rezervacije.
      // OVO NIJE zaključavanje termina: drugi klijent/admin i dalje može upisati
      // između čitanja i commit-a. Za tu zaštitu potreban je zajednički serverski
      // upis sa transakcijom/evidencijom zauzeća i odgovarajuća Firestore pravila.
      await batch.commit();

      setConfirmOpen(false);
      setConfirmData(null);
      pushToast(`✅ Rezervacija sačuvana (${createdIds.length} kartica)`);
      const remaining = latestCartForBooking.filter((s) => !selectedSet.has(s.serviceId));
      saveCart(remaining);
      setSelectedIds([]);

      // Slanje postojeće notifikacije ne sme pretvoriti uspešan upis u grešku.
      try {
        const url = `/admin/kalendar?appointmentId=${createdIds[0]}&employeeId=${attempt.employeeId}`;
        void fetch("/api/sendNotifications", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "appointment_created", title: "📅 Zakazan termin",
            body: `${safeClientName || "Klijent"} – ${bookingServices[0]?.name || "usluga"}` +
              `${bookingServices.length > 1 ? ` (+${bookingServices.length - 1})` : ""} · ` +
              `${niceDate(attempt.start)} ${hhmm(attempt.start)} · ${bookingTotalAmount.toLocaleString("sr-RS")} RSD`,
            toRoles: ["admin", "salon"], toEmployeeId: freshEmployee.id,
            data: {
              screen: "/admin/kalendar", url, appointmentIds: createdIds,
              employeeId: freshEmployee.id, employeeUsername: attempt.employeeId,
              clientName: client.name || "", startTs: attempt.start.getTime(),
            },
          }),
        }).catch((error) => console.warn("BookingTime: notifikacija nije poslata", error));
      } catch (error) { console.warn("BookingTime: notifikacija nije poslata", error); }

      if (remaining.length) {
        nav("/booking/employee", { state: { info: `Ostalo za zakazivanje: ${remaining.length} usluga` } });
      } else {
        const timer = setTimeout(() => {
          toastTimers.current.delete(timer);
          if (mountedRef.current) nav("/home");
        }, 2600);
        toastTimers.current.add(timer);
      }
    } catch (error) {
      console.error("BookingTime: potvrda rezervacije", error);
      if (mountedRef.current) {
        setConfirmOpen(false);
        setConfirmData(null);
        setReloadKey((key) => key + 1);
        pushToast(error.userMessage || "Rezervacija nije potvrđena. Proveri vezu i pokušaj ponovo.");
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  const headerName = chosenEmployeeId === "firstFree" ? "Prvi dostupan" :
    (chosenEmployee ? `${chosenEmployee.firstName || ""} ${chosenEmployee.lastName || ""}`.trim() || chosenEmployee.username : chosenEmployeeId);
  function toggleSel(id) {
    if (savingRef.current) return;
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }
  function selectAllForEmployee() {
    if (savingRef.current || !employeesState.ready || !servicesState.ready) return;
    setSelectedIds(cart.filter((s) => chosenEmployeeId === "firstFree" || canEmployeeDo(s, chosenEmployee)).map((s) => s.serviceId));
    pushToast(chosenEmployeeId === "firstFree" ? "Sve usluge uključene." : "Uključene usluge koje ova radnica radi.");
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
        <button className="back" disabled={saving} onClick={()=>nav(-1)}>Nazad</button>
        <div className="title">{nice(anchor,{month:"long", year:"numeric"})}</div>
        <div className="sub">{headerName}</div>

        {/* KALENDAR */}
        <div className="cal">
          <div className="mbar">
            <button
              className="btnx"
              disabled={saving || !canGoPrev}
              onClick={()=>{ if(!canGoPrev) return; const x=new Date(anchor); x.setMonth(anchor.getMonth()-1); setAnchor(x); }}
              title={canGoPrev ? "Prethodni mesec" : "Nije dostupno"}>
              ◀︎
            </button>
            <div style={{fontWeight:900}}>{nice(anchor,{month:"long", year:"numeric"})}</div>
            <button
              className="btnx"
              disabled={saving || !canGoNext}
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
                const disabled = saving || isOff || isPastDay || isTooFar;
                const title = disabled
                  ? (isPastDay ? "Dan je prošao" : (isTooFar ? "Zakazivanje moguće najviše 14 dana unapred" : "Salon ne radi"))
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

        {/* Dostupnost se prikazuje tek kada je proverena za ovaj datum. */}
        {availabilityError ? (
          <div className="msg" role="alert">
            {availabilityError}
            <div style={{ marginTop: 10 }}>
              <button className="btnx" disabled={saving} onClick={retryAvailability}>Pokušaj ponovo</button>
            </div>
          </div>
        ) : loadingSlots ? (
          <div className="msg" role="status">Učitavam dostupne termine…</div>
        ) : selectedDay < today0 ? (
          <div className="msg">Izaberite današnji ili neki naredni datum.</div>
        ) : selectedDay > maxDate ? (
          <div className="msg">Zakazivanje je moguće samo u naredne dve nedelje.</div>
        ) : !selectedServices.length ? (
          <div className="msg">Izaberite bar jednu uslugu ispod da biste videli termine.</div>
        ) : !selectionValid ? (
          <div className="msg">Trajanje ili cena izabrane usluge nisu ispravno podešeni. Kontaktirajte salon.</div>
        ) : chosenEmployeeId !== "firstFree" && !selectedServices.every((s) => canEmployeeDo(s, chosenEmployee)) ? (
          <div className="msg">Ova radnica nije dostupna za sve izabrane usluge. Promenite izbor usluga ili radnicu.</div>
        ) : slots.length === 0 ? (
          <div className="msg">
            Nema dostupnih termina za odabrani datum.&nbsp;
            {anyWork ? "Pokušaj drugi dan." : "Nema odgovarajuće smene za ovaj izbor."}
          </div>
        ) : (
          <div className="slots">
            {slots.map((s) => {
              const emp = chosenEmployeeId === "firstFree"
                ? (employees.find((e) => e.username === s.employeeId)?.firstName || s.employeeId)
                : null;
              return (
                <button
                  key={`${s.start.getTime()}-${s.employeeId}`}
                  className={`slot ${emp ? "emp" : ""}`}
                  onClick={() => pickSlot(s)}
                  disabled={saving || !availabilityReady || s.start < new Date()}
                  title={s.start < new Date() ? "Vreme je prošlo" : ""}
                >
                  {hhmm(s.start)}{emp ? ` • ${emp}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {/* Rezime + odabir usluga */}
        <div className="res">
          <div className="helpers">
            <button className="pill" disabled={saving || !employeesState.ready || !servicesState.ready} onClick={selectAllForEmployee}>Uključi sve koje ova radnica radi</button>
            <button className="pill" disabled={saving} onClick={()=>{ setSelectedIds([]); pushToast("Ništa nije izabrano."); }}>Poništi sve</button>
          </div>

          {cart.map(it=>(
            <div key={it.serviceId} className="svc">
              <div className="l">
                <button
                  className={`chk ${selectedIds.includes(it.serviceId)?"on":""}`}
                  disabled={saving || !servicesState.ready}
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
                <button className="btn btn-dark" disabled={saving || !confirmationValid} onClick={confirmBooking}>
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
          <button className="btn btn-dark" disabled={saving} onClick={()=>nav(-1)}>Nazad</button>
          <button
            className="btn btn-dark"
            disabled={saving || !baseReady}
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