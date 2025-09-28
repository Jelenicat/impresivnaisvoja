import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  try {
    const now = new Date();
    const from = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const to = new Date(from.getTime() + 5 * 60 * 1000); // prozor 5 min

    const snap = await db.collection("appointments")
      .where("type", "==", "appointment")
      .where("status", "==", "booked")
      .where("start", ">=", admin.firestore.Timestamp.fromDate(from))
      .where("start", "<", admin.firestore.Timestamp.fromDate(to))
      .get();

    let count = 0;
    for (const doc of snap.docs) {
      const appt = { id: doc.id, ...doc.data() };
      if (!appt.clientId || appt.remind24Sent) continue;

      // pokupi klijenta
      const clientDoc = await db.collection("clients").doc(appt.clientId).get();
      if (!clientDoc.exists) continue;
      const client = clientDoc.data();

      // pokupi tokene klijenta
      const tokensSnap = await db.collection("fcmTokens")
        .where("ownerId", "==", appt.clientId).get();
      const tokens = tokensSnap.docs.map(d => d.data().token);
      if (!tokens.length) continue;

      const start = appt.start.toDate();
      const msg = {
        notification: {
          title: "Podsetnik za termin",
          body: `Sutra (${start.toLocaleString("sr-RS")}) imate zakazan termin.`,
        },
      };

      await admin.messaging().sendToDevice(tokens, msg);
      await doc.ref.update({ remind24Sent: true, remind24At: admin.firestore.FieldValue.serverTimestamp() });
      count++;
    }

    res.status(200).send(`OK 24h reminders sent: ${count}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error sending 24h reminders");
  }
}
