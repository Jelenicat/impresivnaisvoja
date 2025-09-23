import React, { useState, useEffect } from "react";

export default function AuthModal({ open, onClose, onSubmit }) {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [phone,     setPhone]     = useState("");
  const [error,     setError]     = useState("");

  // svaki put kad se modal otvori resetuj formu
  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setError("");
    }
  }, [open]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) {
      setError("Molimo popunite sva polja.");
      return;
    }
    const emailOk = /.+@.+\..+/.test(email);
    if (!emailOk) {
      setError("Unesite ispravnu email adresu.");
      return;
    }

    const profile = { firstName, lastName, email, phone };
    setError("");
    onSubmit?.(profile);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Prijava za zakazivanje</h3>
        <p className="helper">
          Unesite podatke — koristićemo ih pri svakom zakazivanju.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Ime</label>
            <input
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Vaše ime"
              required
            />
          </div>

          <div className="field">
            <label>Prezime</label>
            <input
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Vaše prezime"
              required
            />
          </div>

          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ime@domen.com"
              required
            />
          </div>

          <div className="field">
            <label>Telefon</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+381 6x xxx xxxx"
              required
            />
          </div>

          {error && (
            <div style={{ color: "crimson", marginBottom: 8 }}>{error}</div>
          )}

          <div className="actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Otkaži
            </button>
            <button type="submit" className="btn btn-accent">
              Sačuvaj
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
        .field {
          margin-bottom: 14px;
        }
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
        .btn-outline {
          background:#fff;
          border:1px solid #ccc;
        }
    .btn-accent {
  background: #1f1f1f;   /* tamno siva / crna */
  color: #fff;
}
.btn-accent:hover {
  background: #333;      /* malo svetlija nijansa na hover */
}

        @keyframes fadeIn {
          from { opacity:0; transform: translateY(-8px); }
          to { opacity:1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
