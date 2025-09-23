import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDH0mxtNU3poGUhYFfZkcX-kWljSw9hgg4",
  authDomain: "impresivnaisvoja-7da43.firebaseapp.com",
  projectId: "impresivnaisvoja-7da43",
  storageBucket: "impresivnaisvoja-7da43.appspot.com",
  messagingSenderId: "184235668413",
  appId: "1:184235668413:web:bb7a87ba08411ca67418d4"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ✅ helper funkcija za dobijanje FCM tokena
export async function getFcmToken() {
  if (!(await isSupported())) return null;
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: "BK4128ixBhpZ5V40LkeaFRbaVou7tMHno-5wT_bOQpwfbklMKiBsHN_k5IMrQDZg5jTr2w7vWgUJo9ocPOe-4qs"
    });
    return token;
  } catch (e) {
    console.error("Greška pri dobijanju FCM tokena:", e);
    return null;
  }
}
