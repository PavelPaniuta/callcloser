"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type SipTrunk = {
  id: string;
  endpointName: string;
  host: string;
  port: number;
  username: string | null;
  isDefault: boolean;
  providerId: string;
};

type VapiConfig = {
  assistantId: string;
  phoneNumberId: string;
  webhookSecret: string;
  apiKeySet: boolean;
};

type Tab = "sip" | "vapi" | "security";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("sip");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function notify(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">⚙️ Настройки</h1>
          <p className="page-subtitle">SIP-телефония, VAPI и безопасность аккаунта.</p>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: "10px 16px", borderRadius: 8, fontSize: 14,
          background: msg.ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
          border: `1px solid ${msg.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
          color: msg.ok ? "#4ade80" : "#f87171",
        }}>
          {msg.ok ? "✅ " : "❌ "}{msg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 0 }}>
        {([
          { key: "sip", label: "📞 SIP транки" },
          { key: "vapi", label: "🤖 VAPI AI" },
          { key: "security", label: "🔒 Безопасность" },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none", border: "none",
              borderBottom: tab === t.key ? "2px solid #3b82f6" : "2px solid transparent",
              borderRadius: 0, padding: "10px 16px", cursor: "pointer",
              fontSize: 14, fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "#60a5fa" : "#888",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sip"      && <SipSection notify={notify} />}
      {tab === "vapi"     && <VapiSection notify={notify} />}
      {tab === "security" && <SecuritySection notify={notify} />}
    </main>
  );
}

// ── SIP Section ───────────────────────────────────────────────────────────────

function SipSection({ notify }: { notify: (ok: boolean, text: string) => void }) {
  const [trunks, setTrunks] = useState<SipTrunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: 5060,
    username: "",
    password: "",
  });

  async function load() {
    setLoading(true);
    try {
      const t = await api<SipTrunk[]>("/api/settings/sip-trunks");
      setTrunks(t);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Step 1: create integration provider
      const provider = await api<{ id: string }>("/api/settings/integrations", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: "SIP",
          endpointUrl: `sip:${form.host}:${form.port}`,
          secret: form.password || undefined,
        }),
      });

      // Step 2: create SIP trunk linked to provider
      await api("/api/settings/sip-trunks", {
        method: "POST",
        body: JSON.stringify({
          providerId: provider.id,
          endpointName: `trunk-${form.name.toLowerCase().replace(/\s+/g, "-")}`,
          host: form.host,
          port: form.port,
          username: form.username || undefined,
          isDefault: trunks.length === 0,
        }),
      });

      notify(true, `SIP транк "${form.name}" добавлен`);
      setForm({ name: "", host: "", port: 5060, username: "", password: "" });
      await load();
    } catch (e) {
      notify(false, (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTrunk(id: string, providerId: string) {
    if (!confirm("Удалить этот SIP транк?")) return;
    try {
      await api(`/api/settings/sip-trunks/${id}`, { method: "DELETE" });
      await api(`/api/settings/integrations/${providerId}`, { method: "DELETE" });
      notify(true, "Транк удалён");
      await load();
    } catch (e) {
      notify(false, (e as Error).message);
    }
  }

  async function setDefault(id: string) {
    try {
      // Re-add with isDefault=true — or just reload after patch
      // For simplicity, delete and re-add is complex; let's just show info
      notify(true, "Установите транк как основной через активацию интеграции");
    } catch (e) {
      notify(false, (e as Error).message);
    }
  }
  void setDefault;

  return (
    <div className="stack">
      {/* Add new SIP trunk */}
      <section className="card">
        <h2 className="section-title">Добавить SIP транк</h2>
        <p className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
          Введите данные вашего SIP-провайдера (Zadarma, Binotel, Twilio, и др.)
        </p>
        <form onSubmit={(e) => void save(e)} className="form-grid">
          <label>
            Название провайдера
            <input
              value={form.name}
              onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              placeholder="Zadarma"
              required
            />
          </label>
          <label>
            SIP сервер (хост)
            <input
              value={form.host}
              onChange={(e) => setForm((v) => ({ ...v, host: e.target.value }))}
              placeholder="pbx.zadarma.com"
              required
            />
          </label>
          <label>
            Порт
            <input
              type="number"
              value={form.port}
              onChange={(e) => setForm((v) => ({ ...v, port: Number(e.target.value) }))}
              placeholder="5060"
              required
            />
          </label>
          <label>
            Логин (SIP username)
            <input
              value={form.username}
              onChange={(e) => setForm((v) => ({ ...v, username: e.target.value }))}
              placeholder="564813-102"
            />
          </label>
          <label>
            Пароль (SIP secret)
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((v) => ({ ...v, password: e.target.value }))}
              placeholder="••••••••"
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" disabled={saving}>
              {saving ? "Сохранение..." : "Добавить транк"}
            </button>
          </div>
        </form>
      </section>

      {/* Existing trunks */}
      <section className="card">
        <h2 className="section-title">Активные SIP транки</h2>
        {loading ? (
          <p className="muted">Загрузка...</p>
        ) : trunks.length === 0 ? (
          <p className="muted">Нет настроенных транков</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trunks.map((t) => (
              <div key={t.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "12px 16px",
                border: t.isDefault ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.06)",
              }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>📞 {t.endpointName}</span>
                    {t.isDefault && (
                      <span style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 8,
                        background: "rgba(59,130,246,0.2)", color: "#60a5fa", fontWeight: 600,
                      }}>
                        Основной
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
                    {t.host}:{t.port}
                    {t.username && <span style={{ marginLeft: 8 }}>· {t.username}</span>}
                  </div>
                </div>
                <button
                  className="danger"
                  style={{ fontSize: 12 }}
                  onClick={() => void deleteTrunk(t.id, t.providerId)}
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 8,
          background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
          fontSize: 12, color: "#93c5fd",
        }}>
          💡 Endpoint транка используется в Asterisk как <code>PJSIP/$&#123;phone&#125;@trunk-имя</code>.
          Убедитесь, что в <code>pjsip.conf</code> на сервере есть соответствующий transport.
        </div>
      </section>
    </div>
  );
}

// ── VAPI Section ──────────────────────────────────────────────────────────────

function VapiSection({ notify }: { notify: (ok: boolean, text: string) => void }) {
  const [config, setConfig] = useState<VapiConfig>({
    assistantId: "", phoneNumberId: "", webhookSecret: "", apiKeySet: false,
  });
  const [form, setForm] = useState({ apiKey: "", assistantId: "", phoneNumberId: "", webhookSecret: "" });

  useEffect(() => {
    api<VapiConfig>("/api/settings/vapi/config")
      .then((c) => {
        setConfig(c);
        setForm((f) => ({ ...f, assistantId: c.assistantId, phoneNumberId: c.phoneNumberId, webhookSecret: c.webhookSecret }));
      })
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const saved = await api<VapiConfig>("/api/settings/vapi/config", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setConfig(saved);
      setForm((f) => ({ ...f, apiKey: "" }));
      notify(true, "VAPI настройки сохранены");
    } catch (e) {
      notify(false, (e as Error).message);
    }
  }

  async function test() {
    try {
      const r = await api<{ ok: boolean; details: string }>("/api/settings/vapi/test", { method: "POST" });
      notify(r.ok, `Тест VAPI: ${r.details}`);
    } catch (e) {
      notify(false, (e as Error).message);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://callcloser.live";

  return (
    <section className="card stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>VAPI AI Voice</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Исходящие звонки через VAPI. Промпт передаётся из CRM автоматически.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            fontSize: 12, padding: "3px 10px", borderRadius: 8, fontWeight: 600,
            background: config.apiKeySet ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
            color: config.apiKeySet ? "#4ade80" : "#fbbf24",
          }}>
            {config.apiKeySet ? "✓ Подключён" : "Не настроен"}
          </span>
          <button className="secondary" onClick={() => void test()}>Тест</button>
        </div>
      </div>

      <form onSubmit={(e) => void save(e)} className="form-grid">
        <label>
          API Key{config.apiKeySet && <span className="muted"> (уже задан — введи для обновления)</span>}
          <input
            type="password"
            placeholder={config.apiKeySet ? "••••••••" : "Введите VAPI API key"}
            value={form.apiKey}
            onChange={(e) => setForm((v) => ({ ...v, apiKey: e.target.value }))}
          />
        </label>
        <label>
          Phone Number ID <span className="muted">(из VAPI Dashboard → Phone Numbers)</span>
          <input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={form.phoneNumberId}
            onChange={(e) => setForm((v) => ({ ...v, phoneNumberId: e.target.value }))}
          />
        </label>
        <label>
          Assistant ID <span className="muted">(необязательно, если используем CRM промпт)</span>
          <input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={form.assistantId}
            onChange={(e) => setForm((v) => ({ ...v, assistantId: e.target.value }))}
          />
        </label>
        <label>
          Webhook Secret <span className="muted">(необязательно)</span>
          <input
            placeholder="my-webhook-secret"
            value={form.webhookSecret}
            onChange={(e) => setForm((v) => ({ ...v, webhookSecret: e.target.value }))}
          />
        </label>
        <div style={{ gridColumn: "1 / -1" }}>
          <button type="submit">Сохранить</button>
          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12,
            background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
            color: "#93c5fd",
          }}>
            📌 Webhook URL для VAPI Dashboard:{" "}
            <code style={{ background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: 4 }}>
              {origin}/webhooks/vapi
            </code>
          </div>
        </div>
      </form>
    </section>
  );
}

// ── Security Section ──────────────────────────────────────────────────────────

function SecuritySection({ notify }: { notify: (ok: boolean, text: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { notify(false, "Пароли не совпадают"); return; }
    if (next.length < 6) { notify(false, "Минимум 6 символов"); return; }
    setLoading(true);
    try {
      await api("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      notify(true, "Пароль успешно изменён");
      setCurrent(""); setNext(""); setConfirm("");
    } catch {
      notify(false, "Неверный текущий пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 440 }}>
      <h2 className="section-title">Смена пароля</h2>
      <form onSubmit={(e) => void submit(e)} className="form-grid">
        <label>
          Текущий пароль
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label>
          Новый пароль
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} placeholder="Минимум 6 символов" />
        </label>
        <label>
          Повторите новый пароль
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="submit" disabled={loading}>
            {loading ? "Сохранение..." : "Сменить пароль"}
          </button>
        </div>
      </form>
    </section>
  );
}
