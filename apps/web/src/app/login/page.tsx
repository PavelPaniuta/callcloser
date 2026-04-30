"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const gateway = () =>
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch(`${gateway()}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setErr(body.message ?? "Неверный логин или пароль");
        return;
      }
      const j = (await r.json()) as { accessToken: string };
      localStorage.setItem("crm_token", j.accessToken);
      router.push("/");
    } catch {
      setErr("Ошибка подключения к серверу");
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
        background: "#0a0a0a",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380, padding: "0 16px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 24,
            }}
          >
            📞
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "#fff" }}>
            CallCloser
          </h1>
          <p style={{ color: "#666", marginTop: 6, fontSize: 14 }}>
            Войдите в CRM систему
          </p>
        </div>

        <form
          onSubmit={submit}
          style={{
            background: "#111",
            border: "1px solid #222",
            borderRadius: 12,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#aaa" }}>
              Логин
            </span>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin"
              required
              autoFocus
              autoComplete="username"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#aaa" }}>
              Пароль
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </label>

          {err && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#f87171",
                fontSize: 13,
              }}
            >
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: "100%", marginTop: 4 }}
          >
            {loading ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </main>
  );
}
