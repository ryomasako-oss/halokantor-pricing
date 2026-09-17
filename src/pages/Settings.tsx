import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { PasswordInput } from "../components/PasswordInput";
import { pct, rp } from "@shared/format";
import type { PasswordResetRequest, PricingPolicy, Role, User } from "@shared/types";
import type { CompanyInfo } from "../components/QuotationDoc";

export function SettingsPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<PricingPolicy | null>(null);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequest[]>([]);

  const loadUsers = useCallback(() => {
    if (!can("manage_users")) return;
    api.get<{ users: User[] }>("/auth/users").then((r) => setUsers(r.users)).catch(() => undefined);
  }, [can]);

  const loadResetRequests = useCallback(() => {
    if (!can("manage_users")) return;
    api
      .get<{ requests: PasswordResetRequest[] }>("/auth/password-reset-requests")
      .then((r) => setResetRequests(r.requests))
      .catch(() => undefined);
  }, [can]);

  useEffect(() => {
    api
      .get<{ policy: PricingPolicy; company: CompanyInfo }>("/settings")
      .then((r) => {
        setPolicy(r.policy);
        setCompany(r.company);
      })
      .catch((e) => toast(e.message, "error"));
    loadUsers();
    loadResetRequests();
  }, [loadUsers, loadResetRequests, toast]);

  const dismissResetRequest = async (id: number) => {
    try {
      await api.del(`/auth/password-reset-requests/${id}`);
      setResetRequests((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal.", "error");
    }
  };

  const savePolicy = async () => {
    if (!policy) return;
    try {
      await api.put("/settings/policy", policy);
      toast("Kebijakan harga tersimpan.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan.", "error");
    }
  };

  const MAX_LOGO_BYTES = 500_000;

  const onLogoSelected = (file: File | undefined) => {
    if (!file || !company) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast("Format logo harus PNG, JPEG, atau WEBP.", "error");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast("Ukuran logo maksimum 500 KB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCompany({ ...company, logo: reader.result as string });
    reader.readAsDataURL(file);
  };

  const saveCompany = async () => {
    if (!company) return;
    try {
      await api.put("/settings/company", company);
      toast("Identitas perusahaan tersimpan.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan.", "error");
    }
  };

  const changePassword = async () => {
    if (password.next !== password.confirm) {
      toast("Konfirmasi kata sandi tidak cocok.", "error");
      return;
    }
    try {
      await api.post("/auth/password", { current: password.current, next: password.next });
      setPassword({ current: "", next: "", confirm: "" });
      toast("Kata sandi diperbarui.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal mengubah kata sandi.", "error");
    }
  };

  return (
    <main className="hk-main">
      <div className="hk-page-head">
        <div>
          <h1>Pengaturan</h1>
          <p>Kebijakan harga menentukan quotation mana yang wajib lewat persetujuan manajer.</p>
        </div>
      </div>

      <div className="stack">
        {policy && (
          <section className="card">
            <div className="card-head">
              <h2>Kebijakan harga</h2>
              {!can("manage_policy") && <span className="badge grey">Hanya admin yang bisa mengubah</span>}
            </div>
            <div className="card-body">
              <div className="field-grid">
                <label className="field">
                  <span>Net margin minimum ({pct(policy.minNetMargin)})</span>
                  <input
                    className="input" type="number" min="0" max="90" step="0.5" disabled={!can("manage_policy")}
                    value={+(policy.minNetMargin * 100).toFixed(2)}
                    onChange={(e) => setPolicy({ ...policy, minNetMargin: Number(e.target.value) / 100 })}
                  />
                </label>
                <label className="field">
                  <span>Margin minimum per item ({pct(policy.minLineMargin)})</span>
                  <input
                    className="input" type="number" min="-50" max="90" step="0.5" disabled={!can("manage_policy")}
                    value={+(policy.minLineMargin * 100).toFixed(2)}
                    onChange={(e) => setPolicy({ ...policy, minLineMargin: Number(e.target.value) / 100 })}
                  />
                </label>
                <label className="field">
                  <span>Diskon basket maksimum ({pct(policy.maxBasketDiscount)})</span>
                  <input
                    className="input" type="number" min="0" max="100" step="1" disabled={!can("manage_policy")}
                    value={+(policy.maxBasketDiscount * 100).toFixed(2)}
                    onChange={(e) => setPolicy({ ...policy, maxBasketDiscount: Number(e.target.value) / 100 })}
                  />
                </label>
                <label className="field">
                  <span>Ambang nilai wajib persetujuan</span>
                  <input
                    className="input" type="number" min="0" step="1000000" disabled={!can("manage_policy")}
                    value={policy.approvalValueThreshold}
                    onChange={(e) =>
                      setPolicy({ ...policy, approvalValueThreshold: Number(e.target.value) })
                    }
                  />
                  <span className="muted small">{rp(policy.approvalValueThreshold)} per bulan</span>
                </label>
              </div>
              <label className="toggle" style={{ marginTop: 14 }}>
                <input
                  type="checkbox"
                  disabled={!can("manage_policy")}
                  checked={policy.allowBelowCost}
                  onChange={(e) => setPolicy({ ...policy, allowBelowCost: e.target.checked })}
                />
                <span>Izinkan item dijual di bawah landed cost</span>
              </label>
              {can("manage_policy") && (
                <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button className="btn primary" onClick={savePolicy}>Simpan kebijakan</button>
                </div>
              )}
            </div>
          </section>
        )}

        {company && (
          <section className="card">
            <div className="card-head"><h2>Identitas di dokumen penawaran</h2></div>
            <div className="card-body">
              <label className="field" style={{ marginBottom: 12 }}>
                <span>Logo perusahaan</span>
                <div className="row" style={{ gap: 12, alignItems: "center" }}>
                  {company.logo ? (
                    <img
                      src={company.logo}
                      alt="Logo"
                      style={{ maxHeight: 44, maxWidth: 160, objectFit: "contain", border: "1px solid var(--rule)", borderRadius: 6, padding: 4 }}
                    />
                  ) : (
                    <span className="muted small">Belum ada logo — dokumen memakai nama merek dagang sebagai teks.</span>
                  )}
                  {can("manage_company") && (
                    <>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        onChange={(e) => onLogoSelected(e.target.files?.[0])}
                      />
                      <label htmlFor="logo-upload" className="btn small ghost" style={{ cursor: "pointer" }}>
                        {company.logo ? "Ganti logo" : "Unggah logo"}
                      </label>
                      {company.logo && (
                        <button className="btn small ghost" onClick={() => setCompany({ ...company, logo: "" })}>
                          Hapus
                        </button>
                      )}
                    </>
                  )}
                </div>
                <span className="muted small">PNG, JPEG, atau WEBP, maksimum 500 KB.</span>
              </label>
              <div className="field-grid">
                {([
                  ["brand", "Merek dagang"],
                  ["name", "Nama badan hukum"],
                  ["tagline", "Tagline"],
                  ["phone", "Telepon"],
                  ["email", "Email"],
                  ["npwp", "NPWP"],
                ] as const).map(([key, label]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      className="input"
                      disabled={!can("manage_company")}
                      value={company[key]}
                      onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Alamat</span>
                <textarea
                  className="textarea" rows={2} disabled={!can("manage_company")}
                  value={company.address}
                  onChange={(e) => setCompany({ ...company, address: e.target.value })}
                />
              </label>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Rekening pembayaran</span>
                <input
                  className="input" disabled={!can("manage_company")}
                  value={company.bank}
                  onChange={(e) => setCompany({ ...company, bank: e.target.value })}
                />
              </label>
              {can("manage_company") && (
                <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button className="btn primary" onClick={saveCompany}>Simpan identitas</button>
                </div>
              )}
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head"><h2>Kata sandi saya</h2></div>
          <div className="card-body">
            <div className="field-grid">
              <label className="field">
                <span>Kata sandi saat ini</span>
                <PasswordInput
                  autoComplete="current-password"
                  value={password.current}
                  onChange={(v) => setPassword({ ...password, current: v })}
                />
              </label>
              <label className="field">
                <span>Kata sandi baru (min. 8 karakter)</span>
                <PasswordInput
                  autoComplete="new-password"
                  value={password.next}
                  onChange={(v) => setPassword({ ...password, next: v })}
                />
              </label>
              <label className="field">
                <span>Ulangi kata sandi baru</span>
                <PasswordInput
                  autoComplete="new-password"
                  value={password.confirm}
                  onChange={(v) => setPassword({ ...password, confirm: v })}
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button
                className="btn primary"
                onClick={changePassword}
                disabled={!password.current || password.next.length < 8}
              >
                Ubah kata sandi
              </button>
            </div>
          </div>
        </section>

        {can("manage_users") && resetRequests.length > 0 && (
          <section className="card">
            <div className="card-head"><h2>Permintaan reset kata sandi</h2></div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="l">Email</th>
                    <th className="l">Diminta</th>
                    <th className="l">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {resetRequests.map((r) => {
                    const target = users.find((u) => u.email.toLowerCase() === r.email.toLowerCase());
                    return (
                      <tr key={r.id}>
                        <td className="l">{r.email}</td>
                        <td className="l muted">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                        <td className="l">
                          <div className="row-wrap" style={{ gap: 6 }}>
                            {target && (
                              <button className="btn ghost small" onClick={() => setResettingUser(target)}>
                                Reset kata sandi
                              </button>
                            )}
                            <button className="btn ghost small" onClick={() => dismissResetRequest(r.id)}>
                              Tandai selesai
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {can("manage_users") && (
          <section className="card">
            <div className="card-head">
              <h2>Pengguna</h2>
              <button className="btn small primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={14} /> Tambah pengguna
              </button>
            </div>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="l">Nama</th>
                    <th className="l">Email</th>
                    <th className="l">Peran</th>
                    <th className="l">Status</th>
                    <th className="l">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="l">
                        {u.name}
                        {u.id === user?.id && <span className="badge grey" style={{ marginLeft: 6 }}>Anda</span>}
                      </td>
                      <td className="l muted">{u.email}</td>
                      <td className="l">
                        <select
                          className="cell"
                          style={{ width: 110 }}
                          value={u.role}
                          disabled={u.id === user?.id}
                          onChange={async (e) => {
                            try {
                              await api.patch(`/auth/users/${u.id}`, { role: e.target.value as Role });
                              loadUsers();
                              toast("Peran diperbarui.", "success");
                            } catch (err) {
                              toast(err instanceof Error ? err.message : "Gagal.", "error");
                            }
                          }}
                        >
                          <option value="rep">Sales</option>
                          <option value="manager">Manajer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="l">
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={!!u.active}
                            disabled={u.id === user?.id}
                            onChange={async (e) => {
                              try {
                                await api.patch(`/auth/users/${u.id}`, { active: e.target.checked });
                                loadUsers();
                              } catch (err) {
                                toast(err instanceof Error ? err.message : "Gagal.", "error");
                              }
                            }}
                          />
                          <span className="small">{u.active ? "Aktif" : "Nonaktif"}</span>
                        </label>
                      </td>
                      <td className="l">
                        <div className="row-wrap" style={{ gap: 6 }}>
                          <button
                            className="btn ghost small"
                            onClick={() => navigate(`/quotes?user_id=${u.id}&user_name=${encodeURIComponent(u.name)}`)}
                          >
                            Lihat quotation
                          </button>
                          {u.id !== user?.id && (
                            <button className="btn ghost small" onClick={() => setResettingUser(u)}>
                              Reset kata sandi
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {creating && (
        <NewUserModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            loadUsers();
            toast("Pengguna dibuat.", "success");
          }}
        />
      )}

      {resettingUser && (
        <ResetPasswordModal
          targetUser={resettingUser}
          onClose={() => setResettingUser(null)}
          onDone={() => {
            const resolved = resetRequests.filter(
              (r) => r.email.toLowerCase() === resettingUser.email.toLowerCase(),
            );
            resolved.forEach((r) => dismissResetRequest(r.id));
            setResettingUser(null);
            toast("Kata sandi pengguna direset.", "success");
          }}
        />
      )}
    </main>
  );
}

function ResetPasswordModal({
  targetUser,
  onClose,
  onDone,
}: {
  targetUser: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (next !== confirm) {
      toast("Konfirmasi kata sandi tidak cocok.", "error");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/auth/users/${targetUser.id}`, { password: next });
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal mereset kata sandi.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Reset kata sandi — ${targetUser.name}`}
      sub="Sampaikan kata sandi baru ke pengguna, lalu minta mereka menggantinya di menu Pengaturan."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn primary" disabled={next.length < 8 || saving} onClick={submit}>
            {saving ? "Menyimpan…" : "Reset kata sandi"}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <label className="field">
          <span>Kata sandi baru (min. 8 karakter)</span>
          <PasswordInput autoComplete="new-password" value={next} onChange={setNext} />
        </label>
        <label className="field">
          <span>Ulangi kata sandi baru</span>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={setConfirm} />
        </label>
      </div>
    </Modal>
  );
}

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "rep" as Role });

  return (
    <Modal
      title="Tambah pengguna"
      sub="Sampaikan kata sandi awal ke pengguna, lalu minta mereka menggantinya di menu Pengaturan."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button
            className="btn primary"
            disabled={!form.name || !form.email || form.password.length < 8}
            onClick={async () => {
              try {
                await api.post("/auth/users", form);
                onCreated();
              } catch (e) {
                toast(e instanceof Error ? e.message : "Gagal membuat pengguna.", "error");
              }
            }}
          >
            Buat pengguna
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <label className="field">
          <span>Nama lengkap</span>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Email kantor</span>
          <input
            className="input" type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Kata sandi awal (min. 8 karakter)</span>
          <PasswordInput
            autoComplete="new-password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
          />
        </label>
        <label className="field">
          <span>Peran</span>
          <select
            className="select"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            <option value="rep">Sales — membuat dan mengajukan quotation sendiri</option>
            <option value="manager">Manajer — menyetujui dan melihat semua quotation</option>
            <option value="admin">Admin — mengatur kebijakan dan pengguna</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
