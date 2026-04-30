"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const gateway = () =>
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010";

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("operator1");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch(`${gateway()}/api/auth/dev-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const j = (await r.json()) as { accessToken: string };
    localStorage.setItem("crm_token", j.accessToken);
    router.push("/");
  }

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Авторизация</h1>
          <p className="page-subtitle">Dev вход через JWT для админ-панели CRM.</p>
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <label>
            User ID
            <input value={userId} onChange={(e) => setUserId(e.target.value)} />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="submit">Войти</button>
          </div>
        </div>
        {err && <p className="muted">{err}</p>}
      </form>
    </main>
  );
}
