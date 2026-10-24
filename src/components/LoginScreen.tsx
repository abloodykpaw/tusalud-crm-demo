import { useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { useI18n, loginErrorKey } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/roles";
import {
  clearRememberedLogin,
  loadRememberedLogin,
  type RememberedLogin,
} from "@/lib/remember-login";
import type { Role } from "@/lib/types";
import { BrandLogo } from "./BrandLogo";
import { Icons } from "./Icons";

function quickAccessIcon(role: Role) {
  if (role === "admin") return { glyph: "🛡", className: "admin" };
  if (role === "nomina" || role === "encargado") return { glyph: "💸", className: "enc" };
  return { glyph: "👤", className: "agent" };
}

export function LoginScreen() {
  const { login } = useStore();
  const { dark, toggleTheme } = useTheme();
  const { t, locale, toggleLocale } = useI18n();
  const initialRemembered = loadRememberedLogin();
  const [remembered, setRemembered] = useState<RememberedLogin | null>(initialRemembered);
  const [username, setUsername] = useState(initialRemembered?.username || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(!!initialRemembered);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await login(username, password, { remember });
      if (!res.ok) {
        setError(t(loginErrorKey(res.error)));
        return;
      }
      if (remember) {
        setRemembered(loadRememberedLogin());
      } else {
        setRemembered(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onQuickAccess() {
    if (!remembered) return;
    setUsername(remembered.username);
    setRemember(true);
    setError("");
    passwordRef.current?.focus();
  }

  function onUseOtherAccount() {
    clearRememberedLogin();
    setRemembered(null);
    setUsername("");
    setPassword("");
    setRemember(false);
    setError("");
  }

  const quickIcon = remembered ? quickAccessIcon(remembered.role) : null;

  return (
    <div className="login-screen">
      <div className="login-prefs" role="toolbar" aria-label="Preferences">
        <button
          type="button"
          className="pref-pill lang-pill lang-pill-sm"
          onClick={toggleLocale}
          title={locale === "es" ? t("login.lang.toEn") : t("login.lang.toEs")}
          aria-label={t("login.lang")}
        >
          <span className={locale === "es" ? "is-active" : ""}>ES</span>
          <span className="pref-sep">/</span>
          <span className={locale === "en" ? "is-active" : ""}>EN</span>
        </button>
        <button
          type="button"
          className={`pref-pill theme-pill${dark ? " is-dark" : ""}`}
          onClick={toggleTheme}
          title={t("shell.theme")}
          aria-label={t("shell.theme")}
        >
          <span className="theme-switch" aria-hidden="true">
            <span className="theme-knob">{dark ? Icons.moon : Icons.sun}</span>
          </span>
          <span className="theme-label">{dark ? t("shell.theme.dark") : t("shell.theme.light")}</span>
        </button>
      </div>

      <aside className="login-brand">
        <div className="login-brand-inner">
          <BrandLogo size="hero" force="dark" className="login-brand-logo" />
          <h2>{t("login.headline")}</h2>
          <p>{t("login.lead")}</p>
          <div className="feature-list">
            <div className="feature-item">
              <div className="feature-icon">📋</div>
              {t("login.feature.reports")}
            </div>
            <div className="feature-item">
              <div className="feature-icon">📥</div>
              {t("login.feature.import")}
            </div>
            <div className="feature-item">
              <div className="feature-icon">✅</div>
              {t("login.feature.tasks")}
            </div>
            <div className="feature-item">
              <div className="feature-icon">📱</div>
              {t("login.feature.mobile")}
            </div>
          </div>
        </div>
      </aside>

      <div className="login-form-panel">
        <div className="login-card">
          <div className="login-mobile-header">
            <BrandLogo size="lg" />
            <p className="login-mobile-tagline">{t("login.mobileTagline")}</p>
          </div>

          <h3>{t("login.welcome")}</h3>
          <p className="subtitle">{t("login.subtitle")}</p>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="login-username">{t("login.username")}</label>
              <input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">{t("login.password")}</label>
              <input
                id="login-password"
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <label className="checkbox-row login-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>{t("login.remember")}</span>
            </label>
            {error && (
              <p className="login-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? (locale === "en" ? "Signing in…" : "Entrando…") : t("login.submit")}
            </button>
          </form>

          {remembered && quickIcon && (
            <>
              <div className="demo-divider">{t("login.quickAccess")}</div>
              <div className="demo-grid demo-grid-single">
                <button className="demo-card" type="button" onClick={onQuickAccess}>
                  <div className={`demo-card-icon ${quickIcon.className}`}>{quickIcon.glyph}</div>
                  <div className="demo-card-text">
                    <strong>{remembered.fullName}</strong>
                    <span>
                      @{remembered.username} · {ROLE_LABELS[remembered.role]} · {t("login.quickAccessHint")}
                    </span>
                  </div>
                </button>
              </div>
              <button type="button" className="login-switch-account" onClick={onUseOtherAccount}>
                {t("login.notYou")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
