import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icon";
import { PasswordInput } from "../components/PasswordInput";
import { Modal } from "../components/Modal";
import { api } from "../api";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal masuk.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="hk-logo" aria-hidden="true">h</span>
        <h1>Pricing Engine Salvator</h1>
        <p className="sub">Mesin harga dan quotation B2B, PT Salvator Inti Pratama.</p>

        <div className="col" style={{ gap: 12 }}>
          <label className="field">
            <span>Email kantor</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@salvator.co.id"
            />
          </label>
          <label className="field">
            <span>Kata sandi</span>
            <PasswordInput
              autoComplete="current-password"
              required
              value={password}
              onChange={setPassword}
            />
          </label>
          {error && <p className="notice error">{error}</p>}
          <button className="btn primary block" type="submit" disabled={busy || !email || !password}>
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
          <button
            type="button"
            className="link-btn"
            style={{ alignSelf: "center" }}
            onClick={() => setForgotOpen(true)}
          >
            Lupa kata sandi?
          </button>
        </div>

        <p className="muted small" style={{ marginTop: 18, marginBottom: 0 }}>
          <Icon name="shield" size={13} /> Belum punya akun? Minta admin membuatkannya di menu
          Pengaturan.
        </p>
      </form>

      {forgotOpen && <ForgotPasswordModal onClose={() => setForgotOpen(false)} />}
    </div>
  );
}

function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim permintaan.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      title="Lupa kata sandi"
      sub={
        sent
          ? undefined
          : "Permintaan akan diteruskan ke admin untuk mereset kata sandi Anda secara manual."
      }
      onClose={onClose}
      footer={
        sent ? (
          <button className="btn primary" onClick={onClose}>Tutup</button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Batal</button>
            <button className="btn primary" disabled={!email || sending} onClick={submit}>
              {sending ? "Mengirim…" : "Kirim permintaan"}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <p className="notice ok">
          Permintaan reset kata sandi terkirim. Admin akan menghubungi Anda dengan kata sandi baru.
        </p>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <label className="field">
            <span>Email kantor</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@salvator.co.id"
            />
          </label>
          {error && <p className="notice error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
