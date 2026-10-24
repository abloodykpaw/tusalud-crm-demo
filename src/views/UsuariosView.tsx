import { useMemo, useState } from "react";
import { useStore, formatDate } from "@/lib/store";
import { useToast } from "@/components/Toast";
import { ROLE_LABELS, ROLE_MODULES } from "@/lib/roles";
import type { Role } from "@/lib/types";
import { Icons } from "@/components/Icons";
import { generateSecurePassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";

const ALL_ROLES: Role[] = ["admin", "encargado", "nomina", "agente"];

function rolePillClass(role: Role) {
  if (role === "admin") return "new";
  if (role === "encargado") return "contact";
  if (role === "nomina") return "quote";
  return "closed";
}

export function UsuariosView() {
  const {
    user: sessionUser,
    viewUser: user,
    viewAs,
    setViewAs,
    data,
    canManageUsers,
    isAdmin,
    isStaff,
    createUser,
    updateUserRole,
    updateUserStatus,
    updateOwnAccount,
  } = useStore();
  const { toast } = useToast();
  const [tab, setTab] = useState<"lista" | "crear" | "cuenta" | "roles">(
    canManageUsers ? "lista" : user?.role === "agente" ? "cuenta" : "lista"
  );

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agente");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [phone, setPhone] = useState("");

  const previewOnly = !!viewAs && !!user && !!sessionUser && user.id !== sessionUser.id;
  const [ownName, setOwnName] = useState(user?.fullName || "");
  const [ownPhone, setOwnPhone] = useState(user?.phone || "");
  const [ownPass, setOwnPass] = useState("");

  const list = useMemo(() => {
    if (!user) return [];
    if (canManageUsers) return [...data.profiles].sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (user.role === "encargado") {
      return data.profiles.filter((p) => p.role !== "admin" || p.id === user.id);
    }
    if (user.role === "nomina") {
      return data.profiles.filter((p) => p.role === "agente" || p.role === "nomina" || p.id === user.id);
    }
    return data.profiles.filter((p) => p.id === user.id);
  }, [data.profiles, user, canManageUsers]);

  if (!user) return null;

  const counts = ALL_ROLES.map((r) => ({
    role: r,
    n: data.profiles.filter((p) => p.role === r && p.status === "activo").length,
  }));

  return (
    <>
      <div className="week-strip">
        <div>
          <div className="label">
            {canManageUsers ? "Usuarios y roles" : user.role === "agente" ? "Mi cuenta" : "Equipo"}
          </div>
          <div className="value">
            Vista como <strong>{ROLE_LABELS[user.role]}</strong>
            {canManageUsers
              ? " · puedes crear usuarios y cambiar roles"
              : user.role === "agente"
                ? " · solo tu cuenta"
                : " · solo lectura del equipo"}
          </div>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 20 }}>
        {(canManageUsers || isStaff) && (
          <button className={`tab${tab === "lista" ? " active" : ""}`} onClick={() => setTab("lista")}>
            {canManageUsers ? "Usuarios" : "Equipo"}
          </button>
        )}
        {canManageUsers && (
          <button className={`tab${tab === "crear" ? " active" : ""}`} onClick={() => setTab("crear")}>
            Crear usuario
          </button>
        )}
        <button className={`tab${tab === "cuenta" ? " active" : ""}`} onClick={() => setTab("cuenta")}>
          Mi cuenta
        </button>
        {isAdmin && (
          <button className={`tab${tab === "roles" ? " active" : ""}`} onClick={() => setTab("roles")}>
            Vista por rol
          </button>
        )}
      </div>

      {tab === "lista" && (
        <>
          {canManageUsers && (
            <div className="stats-grid" style={{ marginBottom: 20 }}>
              {counts.map((c) => (
                <div key={c.role} className="stat-card">
                  <div className="stat-value">{c.n}</div>
                  <div className="stat-label">{ROLE_LABELS[c.role]}</div>
                </div>
              ))}
            </div>
          )}
          <div className="panel">
            <div className="panel-head">
              <h3>{canManageUsers ? "Todos los usuarios" : "Directorio del equipo"}</h3>
              {!canManageUsers && (
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Solo lectura</span>
              )}
            </div>
            <div className="panel-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Último acceso</th>
                    {canManageUsers && <th>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <span className="cell-name">{p.fullName}</span>
                        {p.phone && <div className="cell-sub">{p.phone}</div>}
                      </td>
                      <td>@{p.username}</td>
                      <td>{p.email || "—"}</td>
                      <td>
                        {canManageUsers && p.id !== user.id ? (
                          <select
                            className="filter-select"
                            value={p.role}
                            onChange={(e) => {
                              updateUserRole(p.id, e.target.value as Role);
                              toast(`Rol → ${ROLE_LABELS[e.target.value as Role]}`);
                            }}
                          >
                            {ALL_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`status-pill ${rolePillClass(p.role)}`}>
                            {ROLE_LABELS[p.role]}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`status-pill ${p.status === "activo" ? "closed" : "late"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>{p.lastAccess ? formatDate(p.lastAccess) : "—"}</td>
                      {canManageUsers && (
                        <td>
                          {p.id === user.id ? (
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>Tú</span>
                          ) : (
                            <button
                              className="btn-action"
                              onClick={() => {
                                const next = p.status === "activo" ? "inactivo" : "activo";
                                updateUserStatus(p.id, next);
                                toast(next === "activo" ? "Usuario activado" : "Usuario desactivado");
                              }}
                            >
                              {p.status === "activo" ? "Desactivar" : "Activar"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "crear" && canManageUsers && (
        <div className="panel" style={{ padding: 24, maxWidth: 520 }}>
          <h3 style={{ marginBottom: 6 }}>Crear usuario</h3>
          <p style={{ fontSize: "0.86rem", color: "var(--muted)", marginBottom: 18 }}>
            El usuario es para iniciar sesión. El email de contacto es opcional.
          </p>
          <div className="field">
            <label>Nombre completo</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre Apellido" />
          </div>
          <div className="field">
            <label>Usuario</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ej. kennedy"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Email de contacto (opcional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@tusalud.com"
            />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="filter-select" style={{ width: "100%" }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Contraseña temporal (mínimo {MIN_PASSWORD_LENGTH} caracteres)</label>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setPassword(generateSecurePassword());
                  setShowPassword(true);
                }}
              >
                Generar contraseña segura
              </button>
              <button
                type="button"
                className="btn"
                disabled={!password}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    toast("Contraseña copiada");
                  } catch {
                    toast("No se pudo copiar", "error");
                  }
                }}
              >
                Copiar
              </button>
              <button type="button" className="btn" onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          <button
            className="btn btn-primary-sm"
            disabled={creating}
            onClick={async () => {
              if (password.length < MIN_PASSWORD_LENGTH) {
                toast(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`, "error");
                return;
              }
              setCreating(true);
              const res = await createUser({ fullName, username, email, role, password, phone });
              setCreating(false);
              if (!res.ok) {
                toast(res.error || "Error", "error");
                return;
              }
              toast("Usuario creado");
              setFullName("");
              setUsername("");
              setEmail("");
              setPhone("");
              setPassword("");
              setShowPassword(false);
              setRole("agente");
              setTab("lista");
            }}
          >
            {Icons.plus} Crear usuario
          </button>
        </div>
      )}

      {tab === "cuenta" && (
        <div className="panel" style={{ padding: 24, maxWidth: 520 }}>
          <div className="profile-hero" style={{ marginBottom: 20, padding: 0, border: "none", background: "transparent" }}>
            <div className="avatar" style={{ width: 56, height: 56 }}>
              {user.fullName
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: "1.35rem" }}>{user.fullName}</h2>
              <div className="sub">
                @{user.username} · {ROLE_LABELS[user.role]}
                {user.email ? ` · ${user.email}` : ""}
              </div>
            </div>
          </div>
          <div className="field">
            <label>Nombre</label>
            <input value={ownName} onChange={(e) => setOwnName(e.target.value)} />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={ownPhone} onChange={(e) => setOwnPhone(e.target.value)} />
          </div>
          <div className="field">
            <label>Nueva contraseña (opcional)</label>
            <input
              type="password"
              value={ownPass}
              onChange={(e) => setOwnPass(e.target.value)}
              placeholder="Dejar vacío para no cambiar"
            />
          </div>
          <button
            className="btn btn-primary-sm"
            disabled={previewOnly}
            onClick={async () => {
              if (previewOnly) {
                toast("Vista previa: no se edita la cuenta real");
                return;
              }
              if (ownPass && ownPass.length < MIN_PASSWORD_LENGTH) {
                toast(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`, "error");
                return;
              }
              const res = await updateOwnAccount({
                fullName: ownName,
                phone: ownPhone,
                password: ownPass || undefined,
              });
              if (!res.ok) {
                toast(res.error || "Error", "error");
                return;
              }
              setOwnPass("");
              toast("Cuenta actualizada");
            }}
          >
            Guardar cambios
          </button>
          {previewOnly && (
            <p style={{ marginTop: 12, fontSize: "0.82rem", color: "var(--muted)" }}>
              Vista previa de {user.fullName}. Usa el selector del header para volver a Admin.
            </p>
          )}
        </div>
      )}

      {tab === "roles" && isAdmin && (
        <>
          <div className="model-legend" style={{ marginBottom: 20 }}>
            <div className="legend-item">
              <span className="legend-dot target" />
              <strong>Tu rol actual:</strong>&nbsp;{ROLE_LABELS[user.role]}
              {viewAs ? " (vista previa)" : ""}
            </div>
          </div>
          <div className="agent-cards">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                className="agent-card"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: r === user.role ? "var(--teal)" : undefined,
                  boxShadow: r === user.role ? "var(--shadow)" : undefined,
                }}
                onClick={() => {
                  setViewAs(r);
                  toast(`Vista: ${ROLE_LABELS[r]}`);
                }}
              >
                <div className="agent-card-top">
                  <div className="avatar" style={{ fontSize: "0.75rem" }}>
                    {ROLE_LABELS[r].slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h4>{ROLE_LABELS[r]}</h4>
                    <span>{r === user.role ? "Vista activa" : "Clic para ver como este rol"}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 4 }}>
                  {ROLE_MODULES[r].map((m) => (
                    <li key={m} style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                      · {m}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
          <p style={{ marginTop: 16, fontSize: "0.84rem", color: "var(--muted)" }}>
            También puedes cambiar de vista con el botón de rol en la barra superior.
          </p>
        </>
      )}
    </>
  );
}
