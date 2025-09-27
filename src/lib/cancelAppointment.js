// src/lib/cancelAppointment.js
import { db } from "../firebase";
import { doc, getDoc, deleteDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";

// par sitnih helpera samo za lep tekst u notifikaciji
const hhmm = (d) => (d instanceof Date ? d : new Date(d))
  .toLocaleTimeString("sr-RS", { hour: "2-digit", minute: "2-digit" });
const niceDate = (d) => (d instanceof Date ? d : new Date(d))
  .toLocaleDateString("sr-RS", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export async function cancelAppointment(appointmentId) {
  // 1) Učitaj termin (da znamo radnicu, ime usluge, vreme…)
  const snap = await getDoc(doc(db, "appointments", appointmentId));
  if (!snap.exists()) throw new Error("Termin ne postoji ili je već otkazan.");

  const a = snap.data();
  const start = a.start?.toDate?.() || new Date(a.start);

  // Ime klijenta (isti izvor kao u ostatku app-a)
  const prof = JSON.parse(localStorage.getItem("clientProfile") || "{}");
  const clientName = `${prof.firstName || ""} ${prof.lastName || ""}`.trim() || "Klijent";

  // “prva usluga” za tekst
  const firstServiceName =
    (Array.isArray(a.services) && a.services[0]?.name) ||
    a.servicesFirstName || "uslugu";

  // 2) Obriši termin iz Firestore-a
  await deleteDoc(doc(db, "appointments", appointmentId));

  // 3) Enqueue notifikacija “otkazano” (isti princip kao zakazano)
  const notifRef = await addDoc(collection(db, "notifications"), {
    kind: "appointment_cancelled",
    title: "❌ Termin otkazan",
    body: `${clientName} je otkazao ${firstServiceName} — ${niceDate(start)} u ${hhmm(start)}`,

    // kome šaljemo:
    toRoles: ["admin", "salon"],
    toEmployeeId: a.employeeUsername || null,

    // deep-link za admin kalendar (otvaramo kolonu radnice)
    data: {
      url: `/admin/calendar?employeeId=${encodeURIComponent(a.employeeUsername || "")}`,
      screen: "/admin/calendar"
    },

    createdAt: serverTimestamp(),
    sent: false
  });

  // 4) Odmah pinguj backend da pošalje push
  fetch("/api/sendNotifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notifId: notifRef.id })
  }).catch(() => {});
}
