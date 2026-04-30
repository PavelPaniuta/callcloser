"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type IntegrationType = "SIP" | "VAPI" | "ASR" | "LLM" | "TTS";
type IntegrationStatus = "ACTIVE" | "INACTIVE";

type Provider = {
  id: string;
  name: string;
  type: IntegrationType;
  endpointUrl: string | null;
  status: IntegrationStatus;
  secrets: Array<{ keyName: string; maskedValue: string; version: number }>;
};

type SipTrunk = {
  id: string;
  endpointName: string;
  host: string;
  port: number;
  isDefault: boolean;
};

type RoutingRule = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  matchExpr: string;
  action: "VOICEBOT" | "QUEUE" | "TRANSFER";
  target: string;
  priority: number;
};

type Revision = { id: string; status: string; createdAt: string };
type VapiConfig = { assistantId: string; phoneNumberId: string; webhookSecret: string; apiKeySet: boolean };

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [trunks, setTrunks] = useState<SipTrunk[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [vapiConfig, setVapiConfig] = useState<VapiConfig>({ assistantId: "", phoneNumberId: "", webhookSecret: "", apiKeySet: false });
  const [vapiForm, setVapiForm] = useState({ apiKey: "", assistantId: "", phoneNumberId: "", webhookSecret: "" });

  const [providerForm, setProviderForm] = useState({
    name: "",
    type: "SIP" as IntegrationType,
    endpointUrl: "",
    secret: "",
  });

  const [sipForm, setSipForm] = useState({
    providerId: "",
    endpointName: "trunk-main",
    host: "",
    port: 5060,
  });

  const [ruleForm, setRuleForm] = useState({
    direction: "INBOUND" as "INBOUND" | "OUTBOUND",
    matchExpr: "^\\+",
    action: "VOICEBOT" as "VOICEBOT" | "QUEUE" | "TRANSFER",
    target: "default",
    priority: 100,
  });

  const sipProviders = useMemo(
    () => providers.filter((p) => p.type === "SIP"),
    [providers],
  );

  async function reload() {
    setErr(null);
    const [p, t, r, rev, vc] = await Promise.all([
      api<Provider[]>("/api/settings/integrations"),
      api<SipTrunk[]>("/api/settings/sip-trunks"),
      api<RoutingRule[]>("/api/settings/routing-rules"),
      api<Revision[]>("/api/settings/revisions"),
      api<VapiConfig>("/api/settings/vapi/config"),
    ]);
    setProviders(p);
    setTrunks(t);
    setRules(r);
    setRevisions(rev);
    setVapiConfig(vc);
    setVapiForm((f) => ({
      ...f,
      assistantId: vc.assistantId,
      phoneNumberId: vc.phoneNumberId,
      webhookSecret: vc.webhookSecret,
    }));
  }

  async function saveVapiConfig(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const saved = await api<VapiConfig>("/api/settings/vapi/config", {
        method: "POST",
        body: JSON.stringify(vapiForm),
      });
      setVapiConfig(saved);
      setVapiForm((f) => ({ ...f, apiKey: "" })); // clear key field after save
      setInfo("VAPI конфиг сохранён");
    } catch (e) { setErr(String((e as Error).message)); }
  }

  async function testVapi() {
    setErr(null);
    try {
      const r = await api<{ ok: boolean; details: string }>("/api/settings/vapi/test", { method: "POST" });
      setInfo(`VAPI test: ${r.ok ? "✓" : "✗"} ${r.details}`);
    } catch (e) { setErr(String((e as Error).message)); }
  }

  useEffect(() => {
    void reload().catch((e) => setErr(String(e.message)));
  }, []);

  async function createProvider(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/api/settings/integrations", {
        method: "POST",
        body: JSON.stringify({
          name: providerForm.name,
          type: providerForm.type,
          endpointUrl: providerForm.endpointUrl || undefined,
          secret: providerForm.secret || undefined,
        }),
      });
      setInfo("Интеграция сохранена");
      setProviderForm({ name: "", type: "SIP", endpointUrl: "", secret: "" });
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function saveTrunk(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/api/settings/sip-trunks", {
        method: "POST",
        body: JSON.stringify({ ...sipForm, isDefault: true }),
      });
      setInfo("SIP trunk сохранен");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api("/api/settings/routing-rules", {
        method: "POST",
        body: JSON.stringify(ruleForm),
      });
      setInfo("Routing правило сохранено");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function activateProvider(id: string) {
    await api(`/api/settings/integrations/${id}/activate`, { method: "POST" });
    setInfo("Активировано");
    await reload();
  }

  async function deleteProvider(id: string) {
    if (!confirm("Удалить интеграцию? Все связанные trunk и секреты тоже удалятся.")) return;
    await api(`/api/settings/integrations/${id}`, { method: "DELETE" });
    setInfo("Интеграция удалена");
    await reload();
  }

  async function testProvider(id: string) {
    const r = await api<{ ok: boolean; details?: string }>(
      `/api/settings/integrations/${id}/test`,
      { method: "POST" },
    );
    setInfo(`${r.ok ? "OK" : "FAIL"}: ${r.details ?? ""}`);
  }

  async function applyConfig() {
    await api("/api/settings/config/apply", { method: "POST" });
    setInfo("Ревизия применена");
    await reload();
  }

  async function rollback(id: string) {
    await api(`/api/settings/config/rollback/${id}`, { method: "POST" });
    setInfo("Rollback выполнен");
    await reload();
  }

  async function deleteTrunk(id: string) {
    if (!confirm("Удалить SIP trunk?")) return;
    await api(`/api/settings/sip-trunks/${id}`, { method: "DELETE" });
    setInfo("SIP trunk удален");
    await reload();
  }

  async function deleteRule(id: string) {
    if (!confirm("Удалить routing rule?")) return;
    await api(`/api/settings/routing-rules/${id}`, { method: "DELETE" });
    setInfo("Routing rule удален");
    await reload();
  }

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">SIP и интеграции</h1>
          <p className="page-subtitle">Единый центр настройки телефонии, AI-провайдеров и роутинга.</p>
        </div>
        <button onClick={() => void applyConfig()}>Apply config</button>
      </div>

      {err && <div className="card muted">{err}</div>}
      {info && <div className="card muted">{info}</div>}

      <section className="grid kpi-grid">
        <article className="card kpi-card">
          <h3>Интеграций</h3>
          <div className="kpi-value">{providers.length}</div>
        </article>
        <article className="card kpi-card">
          <h3>Активных SIP trunk</h3>
          <div className="kpi-value">{trunks.filter((t) => t.isDefault).length}</div>
        </article>
        <article className="card kpi-card">
          <h3>Routing rules</h3>
          <div className="kpi-value">{rules.length}</div>
        </article>
        <article className="card kpi-card">
          <h3>Ревизии</h3>
          <div className="kpi-value">{revisions.length}</div>
        </article>
      </section>

      {/* ── VAPI ──────────────────────────────────────────────────────────── */}
      <section className="card stack">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>VAPI AI Voice</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Исходящие звонки через VAPI (vapi.ai). Если настроен — Asterisk не используется.
            </p>
          </div>
          <div className="row">
            <span className={vapiConfig.apiKeySet ? "badge ok" : "badge warn"}>
              {vapiConfig.apiKeySet ? "API Key ✓" : "Не настроен"}
            </span>
            <button className="secondary" type="button" onClick={() => void testVapi()}>Test</button>
          </div>
        </div>
        <form onSubmit={saveVapiConfig} className="form-grid">
          <label>
            API Key {vapiConfig.apiKeySet && <span className="muted">(уже сохранён — введи новый чтобы обновить)</span>}
            <input
              type="password"
              placeholder={vapiConfig.apiKeySet ? "••••••••••••" : "sk-..."}
              value={vapiForm.apiKey}
              onChange={(e) => setVapiForm((v) => ({ ...v, apiKey: e.target.value }))}
            />
          </label>
          <label>
            Assistant ID
            <input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={vapiForm.assistantId}
              onChange={(e) => setVapiForm((v) => ({ ...v, assistantId: e.target.value }))}
            />
          </label>
          <label>
            Phone Number ID <span className="muted">(номер или SIP транк в VAPI)</span>
            <input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={vapiForm.phoneNumberId}
              onChange={(e) => setVapiForm((v) => ({ ...v, phoneNumberId: e.target.value }))}
            />
          </label>
          <label>
            Webhook Secret <span className="muted">(опционально)</span>
            <input
              placeholder="my-secret"
              value={vapiForm.webhookSecret}
              onChange={(e) => setVapiForm((v) => ({ ...v, webhookSecret: e.target.value }))}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8, gridColumn: "1 / -1" }}>
            <button type="submit">Сохранить</button>
            <span className="muted" style={{ fontSize: 12 }}>
              Webhook URL для VAPI: <code>http://&lt;ваш_хост&gt;:3012/webhooks/vapi</code>
            </span>
          </div>
        </form>
      </section>

      <section className="card stack">
        <h2 className="section-title">Новая интеграция</h2>
        <form onSubmit={createProvider} className="form-grid">
          <label>
            Название
            <input value={providerForm.name} onChange={(e) => setProviderForm((v) => ({ ...v, name: e.target.value }))} />
          </label>
          <label>
            Тип
            <select value={providerForm.type} onChange={(e) => setProviderForm((v) => ({ ...v, type: e.target.value as IntegrationType }))}>
              <option value="SIP">SIP</option>
              <option value="VAPI">VAPI</option>
              <option value="ASR">ASR</option>
              <option value="LLM">LLM</option>
              <option value="TTS">TTS</option>
            </select>
          </label>
          <label>
            Endpoint URL
            <input value={providerForm.endpointUrl} onChange={(e) => setProviderForm((v) => ({ ...v, endpointUrl: e.target.value }))} />
          </label>
          <label>
            Secret/API key
            <input value={providerForm.secret} onChange={(e) => setProviderForm((v) => ({ ...v, secret: e.target.value }))} />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="submit">Сохранить</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">Интеграции</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Тип</th>
                <th>Статус</th>
                <th>Endpoint</th>
                <th>Секреты</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.type}</td>
                  <td><span className={p.status === "ACTIVE" ? "badge ok" : "badge warn"}>{p.status}</span></td>
                  <td>{p.endpointUrl ?? "-"}</td>
                  <td>{p.secrets.map((s) => `${s.keyName}:${s.maskedValue}`).join(", ") || "-"}</td>
                  <td className="row">
                    <button className="secondary" onClick={() => void testProvider(p.id)}>Test</button>
                    <button onClick={() => void activateProvider(p.id)}>Activate</button>
                    <button className="danger" onClick={() => void deleteProvider(p.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr><td colSpan={6} className="muted">Нет интеграций</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2 className="section-title">SIP trunk</h2>
        <form className="form-grid" onSubmit={saveTrunk}>
          <label>
            SIP provider
            <select value={sipForm.providerId} onChange={(e) => setSipForm((v) => ({ ...v, providerId: e.target.value }))}>
              <option value="">Выбери</option>
              {sipProviders.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </label>
          <label>
            Endpoint
            <input value={sipForm.endpointName} onChange={(e) => setSipForm((v) => ({ ...v, endpointName: e.target.value }))} />
          </label>
          <label>
            Host
            <input value={sipForm.host} onChange={(e) => setSipForm((v) => ({ ...v, host: e.target.value }))} />
          </label>
          <label>
            Port
            <input type="number" value={sipForm.port} onChange={(e) => setSipForm((v) => ({ ...v, port: Number(e.target.value) }))} />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="submit">Сохранить trunk</button></div>
        </form>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Endpoint</th><th>Host</th><th>Port</th><th>Default</th><th>Действия</th></tr></thead>
            <tbody>
              {trunks.map((t) => (
                <tr key={t.id}>
                  <td>{t.endpointName}</td>
                  <td>{t.host}</td>
                  <td>{t.port}</td>
                  <td>{t.isDefault ? "Да" : "Нет"}</td>
                  <td><button className="danger" onClick={() => void deleteTrunk(t.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2 className="section-title">Routing rules</h2>
        <form className="form-grid" onSubmit={saveRule}>
          <label>
            Direction
            <select value={ruleForm.direction} onChange={(e) => setRuleForm((v) => ({ ...v, direction: e.target.value as "INBOUND" | "OUTBOUND" }))}>
              <option value="INBOUND">INBOUND</option>
              <option value="OUTBOUND">OUTBOUND</option>
            </select>
          </label>
          <label>
            Match expr
            <input value={ruleForm.matchExpr} onChange={(e) => setRuleForm((v) => ({ ...v, matchExpr: e.target.value }))} />
          </label>
          <label>
            Action
            <select value={ruleForm.action} onChange={(e) => setRuleForm((v) => ({ ...v, action: e.target.value as "VOICEBOT" | "QUEUE" | "TRANSFER" }))}>
              <option value="VOICEBOT">VOICEBOT</option>
              <option value="QUEUE">QUEUE</option>
              <option value="TRANSFER">TRANSFER</option>
            </select>
          </label>
          <label>
            Target
            <input value={ruleForm.target} onChange={(e) => setRuleForm((v) => ({ ...v, target: e.target.value }))} />
          </label>
          <label>
            Priority
            <input type="number" value={ruleForm.priority} onChange={(e) => setRuleForm((v) => ({ ...v, priority: Number(e.target.value) }))} />
          </label>
          <div style={{ display: "flex", alignItems: "end" }}><button type="submit">Добавить rule</button></div>
        </form>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Dir</th><th>Match</th><th>Action</th><th>Target</th><th>Priority</th><th>Действия</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.direction}</td>
                  <td>{r.matchExpr}</td>
                  <td>{r.action}</td>
                  <td>{r.target}</td>
                  <td>{r.priority}</td>
                  <td><button className="danger" onClick={() => void deleteRule(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Config revisions</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Статус</th><th>Дата</th><th></th></tr></thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id}>
                  <td>{r.id.slice(0, 10)}...</td>
                  <td>{r.status}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td><button className="secondary" onClick={() => void rollback(r.id)}>Rollback</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}