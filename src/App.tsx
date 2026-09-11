import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./context/AuthContext";
import { Icon } from "./components/Icon";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { QuoteEditorPage } from "./pages/QuoteEditor";
import { ApprovalsPage } from "./pages/Approvals";
import { CatalogPage } from "./pages/Catalog";
import { ClientsPage } from "./pages/Clients";
import { SettingsPage } from "./pages/Settings";
import type { Approval } from "@shared/types";

function TopBar() {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(0);

  // Keep the approvals badge fresh as the user moves around the app.
  useEffect(() => {
    if (!can("manager")) return;
    api
      .get<{ approvals: Approval[] }>("/approvals?decision=pending")
      .then((r) => setPending(r.approvals.length))
      .catch(() => undefined);
  }, [can, location.pathname]);

  return (
    <header className="hk-top">
      <NavLink to="/" className="hk-brand">
        <span className="hk-logo" aria-hidden="true">h</span>
        <span>
          <span className="hk-title" style={{ display: "block" }}>Halokantor Pricing</span>
          <span className="hk-sub">PT Salvator Inti Pratama</span>
        </span>
      </NavLink>

      <nav className="hk-nav" aria-label="Navigasi utama">
        <NavLink to="/quotes" className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon name="quote" size={16} />
          <span className="label">Quotation</span>
        </NavLink>
        {can("manager") && (
          <NavLink to="/approvals" className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon name="shield" size={16} />
            <span className="label">Persetujuan</span>
            {pending > 0 && <span className="count">{pending}</span>}
          </NavLink>
        )}
        <NavLink to="/catalog" className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon name="box" size={16} />
          <span className="label">Katalog</span>
        </NavLink>
        <NavLink to="/clients" className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon name="building" size={16} />
          <span className="label">Klien</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon name="gear" size={16} />
          <span className="label">Pengaturan</span>
        </NavLink>
      </nav>

      <div className="row">
        <span className="muted small hide-sm">
          {user?.name}
          <span className="badge grey" style={{ marginLeft: 6 }}>
            {user?.role === "admin" ? "Admin" : user?.role === "manager" ? "Manajer" : "Sales"}
          </span>
        </span>
        <button className="icon-btn" onClick={() => void logout()} title="Keluar" aria-label="Keluar">
          <Icon name="logout" size={17} />
        </button>
      </div>
    </header>
  );
}

function RequireRole({ min, children }: { min: "manager" | "admin"; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(min)) {
    return (
      <div className="hk-main">
        <div className="card">
          <div className="card-body empty">
            <Icon name="shield" size={28} />
            <h3>Halaman ini khusus {min === "admin" ? "admin" : "manajer"}</h3>
            <p>Akun Anda tidak punya akses ke bagian ini.</p>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-wrap">
        <div className="loading">
          <span className="dots"><i /><i /><i /></span>
          Memuat…
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="hk-app">
      <TopBar />
      <Routes>
        <Route path="/" element={<Navigate to="/quotes" replace />} />
        <Route path="/quotes" element={<DashboardPage />} />
        <Route path="/quotes/:id" element={<QuoteEditorPage />} />
        <Route
          path="/approvals"
          element={
            <RequireRole min="manager">
              <ApprovalsPage />
            </RequireRole>
          }
        />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/quotes" replace />} />
      </Routes>
    </div>
  );
}
