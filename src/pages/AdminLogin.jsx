// src/pages/AdminLogin.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, getFcmToken } from "../firebase";
import { doc, setDoc, serverTimestamp, getDoc } from "firebase/firestore";

export default function AdminLogin() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function saveFcmTokenRecord({ token, ownerId, role, username }) {
    if (!token) return;
    try {
      await setDoc(
        doc(db, "fcmTokens", token),
        {
          token,
          ownerId,           // npr. "admin" ili username zaposlenog
          role,              // "admin" | "salon" | "worker"
          username,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          lastSeenAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("Ne mogu da upišem fcmTokens rekord:", e);
    }
  }

  async function submit(e) {
    e.preventDefault();

    const isAdmin = (user === "admin" && pass === "jovanasmolovic1234");
    const isSalon = (user === "salon" && pass === "impresivnaisvoja1234");

    try {
      setLoading(true);

      // Admin / Salon
      if (isAdmin || isSalon) {
        let fcmToken = null;
        try { fcmToken = await getFcmToken(); } catch {}

        await setDoc(
          doc(db, "admins", user),
          {
            username: user,
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );

        // per-device registrovanje tokena (dozvoljeno mnogo uređaja)
        await saveFcmTokenRecord({
          token: fcmToken,
          ownerId: user,
          role: isAdmin ? "admin" : "salon",
          username: user,
        });

        // trajna sesija
        localStorage.setItem("username", user);
        localStorage.setItem("role", isAdmin ? "admin" : "salon");
        nav("/admin");
        return;
      }

      // Zaposleni
      const snap = await getDoc(doc(db, "employees", user));
      if (!snap.exists()) {
        alert("Pogrešno korisničko ime ili lozinka.");
        return;
      }
      const emp = snap.data();
      if (!emp.active) {
        alert("Nalog je deaktiviran. Obratite se administratoru.");
        return;
      }
      if (emp.tempPassword !== pass) {
        alert("Pogrešno korisničko ime ili lozinka.");
        return;
      }

      // Uspešan login zaposlenog
      let fcmToken = null;
      try { fcmToken = await getFcmToken(); } catch {}

      await setDoc(
        doc(db, "employees", emp.username),
        {
          lastLoginAt: serverTimestamp(),
        },
        { merge: true }
      );

      await saveFcmTokenRecord({
        token: fcmToken,
        ownerId: emp.username,
        role: "worker",
        username: emp.username,
      });

      // trajna sesija
      localStorage.setItem("username", emp.username);
      localStorage.setItem("role", "worker");
      localStorage.setItem("employeeId", emp.username);

      nav("/admin");
    } catch (err) {
      console.error("Greška pri loginu:", err);
      alert("Došlo je do greške pri loginu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-wrap">
      <style>{`
        .admin-login-wrap{
          min-height: 100dvh;
          display:flex; align-items:center; justify-content:center;
          background: linear-gradient(135deg,#f7f4ef, #efe7dc);
          padding: 24px;
        }
        .auth-card{
          width: 100%; max-width: 420px; background: #ffffff;
          border-radius: 18px; box-shadow: 0 12px 30px rgba(31,31,31,0.12);
          padding: 22px;
        }
        .auth-title{ font-size: 22px; font-weight: 700; text-align: center; margin: 2px 0 6px; color: #1f1f1f; }
        .auth-sub{ text-align:center; color:#6b6b6b; font-size:14px; margin-bottom: 18px; }
        .field{ margin-bottom: 14px; }
        .label{ display:block; font-size:13px; color:#474747; margin-bottom:6px; }
        .control{ position: relative; }
        .input{
          width:100%; padding: 12px 14px; border-radius: 12px; border: 1px solid #e0ddd6;
          outline: none; font-size: 15px; background: #faf8f5; transition: border-color .2s, background .2s, box-shadow .2s;
        }
        .input:focus{ background: #fff; border-color: #cdb59a; box-shadow: 0 0 0 4px rgba(205,181,154,0.18); }
        .toggle{
          position:absolute; right:10px; top:50%; transform:translateY(-50%);
          border:none; background:transparent; cursor:pointer; font-size:12px; color:#7a6e60;
          padding:4px 6px; border-radius:8px;
        }
        .actions{ margin-top: 16px; display:flex; gap:10px; }
        .btn{
          flex:1; padding: 12px 14px; border-radius: 12px; border: 1px solid transparent; cursor: pointer; font-weight: 600;
          transition: transform .06s ease, box-shadow .2s, background .2s;
        }
        .btn-dark{ background:#1f1f1f; color:#fff; }
        .btn-dark:hover{ box-shadow: 0 6px 18px rgba(31,31,31,0.22); transform: translateY(-1px); }
        .btn-outline{ background:#fff; color:#1f1f1f; border-color:#ddd6cc; }
        .btn[disabled]{ opacity:.6; cursor:not-allowed; transform:none; box-shadow:none; }
        .hint{ text-align:center; font-size:12px; color:#8a8378; margin-top:10px; }
        @media (max-width: 520px){ .auth-card{ padding:18px; border-radius:16px; } .auth-title{ font-size:20px; } .input{ font-size:16px; padding: 13px 14px; } .btn{ padding: 13px 14px; } }
      `}</style>

      <div className="auth-card">
        <h2 className="auth-title">Uloguj se</h2>
        <div className="auth-sub">Pristup panelu za upravljanje zakazivanjima</div>

        <form onSubmit={submit}>
          <div className="field">
            <label className="label">Korisničko ime</label>
            <div className="control">
              <input
                className="input"
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="npr. admin ili korisničko ime zaposlenog"
                required
              />
            </div>
          </div>

          <div className="field">
            <label className="label">Lozinka</label>
            <div className="control">
              <input
                className="input"
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="toggle"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? "Sakrij lozinku" : "Prikaži lozinku"}
              >
                {showPass ? "sakrij" : "prikaži"}
              </button>
            </div>
          </div>

          <div className="actions">
            <button type="button" className="btn btn-outline" onClick={() => nav("/")}>
              Nazad
            </button>
            <button type="submit" className="btn btn-dark" disabled={loading}>
              {loading ? "Prijavljivanje..." : "Uloguj se"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
