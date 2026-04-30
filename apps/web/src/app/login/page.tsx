"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const gateway = () =>
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010";

type View = "login" | "setup";

export default function LoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`${gateway()}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: "Ошибка входа" }));
        setErr(body.message ?? "Ошибка входа");
        return;
      }
      const j = (await r.json()) as { accessToken: string };
      localStorage.setItem("crm_token", j.accessToken);
      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`${gateway()}/api/auth/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name, setupKey }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: "Ошибка" }));
        setErr(body.message ?? "Ошибка создания пользователя");
        return;
      }
      const j = (await r.json()) as { accessToken: string };
      localStorage.setItem("crm_token", j.accessToken);
      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0f0f0f)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "0 16px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
            CallCloser
          </h1>
          <p style={{ color: "var(--muted, #888)", marginTop: 8, fontSize: 14 }}>
            {view === "login" ? "Вход в CRM систему" : "Первоначальная настройка"}
          </p>
        </div>

        <div className="card">
          {view === "login" ? (
            <form onSubmit={submitLogin}>
              <div className="stack" style={{ gap: 16 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@callcloser.live"
                    required
                    autoFocus
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Пароль</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={4}
                  />
                </label>
                {err && (
                  <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>{err}</p>
                )}
                <button type="submit" disabled={loading} style={{ width: "100%" }}>
                  {loading ? "Вход..." : "Войти"}
                </button>
                <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted, #888)", margin: 0 }}>
                  Первый запуск?{" "}
                  <button
                    type="button"
                    onClick={() => { setView("setup"); setErr(null); }}
                    style={{ background: "none", border: "none", color: "var(--accent, #60a5fa)", cursor: "pointer", fontSize: 13, padding: 0 }}
                  >
                    Создать админа
                  </button>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={submitSetup}>
              <div className="stack" style={{ gap: 16 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Имя</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Администратор"
                    required
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@callcloser.live"
                    required
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Пароль</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    required
                    minLength={6}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Setup Key</span>
                  <input
                    value={setupKey}
                    onChange={(e) => setSetupKey(e.target.value)}
                    placeholder="Из переменной SETUP_KEY на сервере"
                    required
                  />
                </label>
                {err && (
                  <p style={{ color: "#f87171", fontSize: 13, margin: 0 }}>{err}</p>
                )}
                <button type="submit" disabled={loading} style={{ width: "100%" }}>
                  {loading ? "Создание..." : "Создать аккаунт и войти"}
                </button>
                <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted, #888)", margin: 0 }}>
                  <button
                    type="button"
                    onClick={() => { setView("login"); setErr(null); }}
                    style={{ background: "none", border: "none", color: "var(--accent, #60a5fa)", cursor: "pointer", fontSize: 13, padding: 0 }}
                  >
                    ← Назад ко входу
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
