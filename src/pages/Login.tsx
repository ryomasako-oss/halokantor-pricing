import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icon";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
        <h1>Halokantor Pricing</h1>
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
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="notice error">{error}</p>}
          <button className="btn primary block" type="submit" disabled={busy || !email || !password}>
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </div>

        <p className="muted small" style={{ marginTop: 18, marginBottom: 0 }}>
          <Icon name="shield" size={13} /> Belum punya akun? Minta admin membuatkannya di menu
          Pengaturan.
        </p>
      </form>
    </div>
  );
}
