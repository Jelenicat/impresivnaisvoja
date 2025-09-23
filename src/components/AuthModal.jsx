import React, { useState, useEffect, useRef } from "react";

export default function AuthModal({ open, onClose, onSubmit }) {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [phone,     setPhone]     = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const firstInputRef = useRef(null);

  // reset forme kad se modal otvori
  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setError("");
      setLoading(false);
      // fokus na prvo polje
      setTimeout(() => firstInputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  function normPhone(p) {
    return String(p || "").replace(/\D+/g, "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return; // spreči dupli submit

    const phoneNorm = normPhone(phone);
    const emailOk = /.+@.+\..+/.test(email);

    if (!firstName || !lastName || !email || !phoneNorm) {
      setError("Molimo popunite sva polja.");
      return;
    }
    if (!emailOk) {
      setError("Unesite ispravnu email adresu.");
      return;
    }
    if (phoneNorm.length < 7) {
      setError("Unesite ispravan broj telefona.");
      return;
    }

    const profile = { firstName, lastName, email: email.trim().toLowerCase(), phone: phoneNorm };
    setError("");
    setLoading(true);

    try {
      // Napomena: u Home.jsx onSubmit odmah zatvara modal i navigira (optimistic nav)
      await onSubmit?.(profile);
    } finally {
      // čak i ako parent odmah zatvori modal, držimo robustno stanje ovde
      setLoading(false);
    }
  }

  function handleBackdrop(e) {
    if (loading) return; // dok traje submit, ne dozvoli zatvaranje klikom van
    onClose?.();
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} aria-modal="true" role="dialog">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Prijava za zakazivanje</h3>
        <p className="helper">Unesite podatke — koristićemo ih pri svakom zakazivanju.</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="firstName">Ime</label>
            <input
              id="firstName"
              ref={firstInputRef}
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Vaše ime"
              autoComplete="given-name"
              disabled={loading}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="lastName">Prezime</label>
            <input
              id="lastName"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Vaše prezime"
              autoComplete="family-name"
              disabled={loading}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ime@domen.com"
              autoComplete="email"
              inputMode="email"
              disabled={loading}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="phone">Telefon</label>
            <input
              id="phone"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+381 6x xxx xxxx"
              autoComplete="tel"
              inputMode="tel"
              pattern="[0-9+\s()-]*"
              disabled={loading}
              required
            />
          </div>

          {error && <div style={{ color: "crimson", marginBottom: 8 }}>{error}</div>}

          <div className="actions">
            <button type="button" className="btn btn-outline" onClick={() => !loading && onClose?.()} disabled={loading}>
              Otkaži
            </button>
            <button type="submit" className="btn btn-accent" disabled={loading}>
              {loading ? "Sačuvavam…" : "Sačuvaj"}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal {
          background: #fff;
          padding: 24px;
          border-radius: 14px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          animation: fadeIn .2s ease;
        }
        h3 {
          margin: 0 0 6px;
          font-size: 20px;
        }
        .helper {
          margin: 0 0 16px;
          font-size: 14px;
          color: #555;
        }
        .field { margin-bottom: 14px; }
        label {
          display:block;
          font-size: 13px;
          margin-bottom: 4px;
          color: #333;
        }
        .input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 10px;
          font-size: 14px;
        }
        .input:disabled {
          background: #f6f6f6;
          color: #888;
        }
        .input:focus {
          border-color: #1f1f1f;
          outline: none;
          box-shadow: 0 0 0 2px hsla(0, 0%, 0%, 0.20);
        }
        .actions {
          display:flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 12px;
        }
        .btn {
          padding: 10px 16px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          font-weight: 600;
        }
        .btn[disabled] {
          opacity: 0.6;
          cursor: default;
        }
        .btn-outline {
          background:#fff;
          border:1px solid #ccc;
        }
        .btn-accent {
          background: #1f1f1f;
          color: #fff;
        }
        .btn-accent:hover { background: #333; }
        @keyframes fadeIn {
          from { opacity:0; transform: translateY(-8px); }
          to { opacity:1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
