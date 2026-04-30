"use client";

import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { api, getToken } from "@/lib/api";

type StopWordRule = {
  word: string;
  action: "DNC" | "TAG" | "NOTIFY";
  tag?: string;
};

type ServiceHealth = {
  service: string;
  ok: boolean;
  statusCode: number;
  latencyMs: number | null;
};

type HealthResponse = {
  ok: boolean;
  checkedAt: string;
  services: ServiceHealth[];
};

type AuditEntry = {
  id: string;
  actorId: string | null;
  action: string;
  resource: string;
  createdAt: string;
  payload?: unknown;
};

type CallRow = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "CREATED" | "QUEUED" | "RINGING" | "ANSWERED" | "ENDED" | "FAILED";
  createdAt: string;
  failureReason: string | null;
  contact?: { id: string; name: string | null; phone: string } | null;
};

type CallsOverview = {
  total: number;
  byStatus: Record<string, number>;
  topFailureReasons: Array<{ reason: string; count: number }>;
};

const statusTitle: Record<CallRow["status"], string> = {
  CREATED: "Создан",
  QUEUED: "В очереди",
  RINGING: "Идут гудки",
  ANSWERED: "Отвечен",
  ENDED: "Завершен",
  FAILED: "Ошибка",
};

const statusHint: Record<CallRow["status"], string> = {
  CREATED: "Создан в CRM и готовится к отправке в telephony контур.",
  QUEUED: "Звонок поставлен в очередь и ожидает originate.",
  RINGING: "SIP-провайдер пытается соединить абонента.",
  ANSWERED: "Абонент ответил, голосовой сценарий в работе.",
  ENDED: "Звонок завершен штатно.",
  FAILED: "Проверьте причину ошибки и конфигурацию маршрута/SIP.",
};

type CallAnalytics = {
  transcript?: string | null;
  summary?: string | null;
  improvements?: string | null;
  detectedKeywords?: Array<{ word: string; action: string; count: number }> | null;
};

export default function AdminPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [overview, setOverview] = useState<CallsOverview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [directionFilter, setDirectionFilter] = useState<string>("");
  // Stop words
  const [stopWords, setStopWords] = useState<StopWordRule[]>([]);
  const [newWord, setNewWord] = useState("");
  const [newAction, setNewAction] = useState<"DNC" | "TAG" | "NOTIFY">("DNC");
  const [newTag, setNewTag] = useState("");
  // Call transcript modal
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [callAnalytics, setCallAnalytics] = useState<CallAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const gatewayWs = useMemo(
    () => process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010",
    [],
  );

  const loadAll = async () => {
    const params = new URLSearchParams();
    params.set("limit", "80");
    if (statusFilter) params.set("status", statusFilter);
    if (directionFilter) params.set("direction", directionFilter);

    const [h, ov, au, cl] = await Promise.all([
      api<HealthResponse>("/api/admin/health"),
      api<CallsOverview>("/api/admin/calls/overview"),
      api<AuditEntry[]>("/api/admin/audit?limit=60"),
      api<CallRow[]>(`/api/calls?${params.toString()}`),
    ]);
    setHealth(h);
    setOverview(ov);
    setAudit(au);
    setCalls(cl);
  };

  const loadStopWords = async () => {
    try {
      const configs = await api<Array<{ key: string; value: unknown }>>("/api/settings/system-config");
      const sw = configs.find((c) => c.key === "analytics.stopWords");
      setStopWords((sw?.value as StopWordRule[] | null) ?? []);
    } catch { setStopWords([]); }
  };

  const saveStopWords = async (updated: StopWordRule[]) => {
    await api("/api/settings/system-config", {
      method: "POST",
      body: JSON.stringify({ key: "analytics.stopWords", value: updated }),
    });
    setStopWords(updated);
  };

  const addStopWord = async () => {
    if (!newWord.trim()) return;
    const rule: StopWordRule = { word: newWord.trim(), action: newAction, ...(newAction === "TAG" && newTag ? { tag: newTag } : {}) };
    await saveStopWords([...stopWords, rule]);
    setNewWord(""); setNewTag("");
  };

  const removeStopWord = async (idx: number) => {
    await saveStopWords(stopWords.filter((_, i) => i !== idx));
  };

  const openCallAnalytics = async (callId: string) => {
    setSelectedCallId(callId);
    setCallAnalytics(null);
    setAnalyticsLoading(true);
    try {
      const data = await api<{ analytics?: CallAnalytics }>(`/api/calls/${callId}`);
      setCallAnalytics(data.analytics ?? null);
    } catch { setCallAnalytics(null); }
    finally { setAnalyticsLoading(false); }
  };

  useEffect(() => {
    void loadAll().catch((e) => setErr(String((e as Error).message)));
    void loadStopWords();
  }, [statusFilter, directionFilter]);

  useEffect(() => {
    const timer = setInterval(() => {
      void api<HealthResponse>("/api/admin/health")
        .then(setHealth)
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket: Socket = io(gatewayWs, { transports: ["websocket"] });
    socket.on("call", (payload: { event?: string; callId?: string; status?: string }) => {
      setLiveEvents((prev) =>
        [
          `${payload.event ?? "call"} ${payload.callId ?? ""} ${payload.status ?? ""}`.trim(),
          ...prev,
        ].slice(0, 15),
      );
      void loadAll().catch(() => undefined);
    });
    return () => {
      socket.disconnect();
    };
  }, [gatewayWs, statusFilter, directionFilter]);

  const activeCalls = calls.filter((c) =>
    ["CREATED", "QUEUED", "RINGING", "ANSWERED"].includes(c.status),
  ).length;

  async function cancelCall(callId: string) {
    setBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/calls/${callId}/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: "Cancelled by admin monitor" }),
      });
      if (!r.ok) throw new Error(await r.text());
      await loadAll();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function retryCall(callId: string) {
    setBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/calls/${callId}/retry`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(await r.text());
      await loadAll();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">Админ-мониторинг</h1>
          <p className="page-subtitle">
            Health сервисов, live-статусы звонков, retry/cancel и аудит действий.
          </p>
        </div>
      </div>

      {err && <div className="card muted">{err}</div>}

      <section className="grid kpi-grid">
        <article className="card kpi-card">
          <h3>Активные звонки</h3>
          <div className="kpi-value">{activeCalls}</div>
        </article>
        <article className="card kpi-card">
          <h3>Всего (последние 100)</h3>
          <div className="kpi-value">{overview?.total ?? 0}</div>
        </article>
        <article className="card kpi-card">
          <h3>Ошибок FAILED</h3>
          <div className="kpi-value">{overview?.byStatus?.FAILED ?? 0}</div>
        </article>
        <article className="card kpi-card">
          <h3>Сервисов OK</h3>
          <div className="kpi-value">
            {health ? health.services.filter((s) => s.ok).length : 0}/{health?.services.length ?? 0}
          </div>
        </article>
      </section>

      <section className="card stack">
        <h2 className="section-title">Health-панель</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Сервис</th>
                <th>Статус</th>
                <th>HTTP</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {(health?.services ?? []).map((s) => (
                <tr key={s.service}>
                  <td>{s.service}</td>
                  <td>
                    <span className={s.ok ? "badge ok" : "badge warn"}>
                      {s.ok ? "OK" : "FAIL"}
                    </span>
                  </td>
                  <td>{s.statusCode}</td>
                  <td>{s.latencyMs ?? "-"} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2 className="section-title">Live события</h2>
        {liveEvents.length === 0 ? (
          <p className="muted">События появятся после новых call.updated/call.ended.</p>
        ) : (
          <div className="stack">
            {liveEvents.map((line, i) => (
              <div key={i} className="muted">
                {line}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <div className="row">
          <h2 className="section-title" style={{ margin: 0 }}>Монитор звонков</h2>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="CREATED">CREATED</option>
            <option value="QUEUED">QUEUED</option>
            <option value="RINGING">RINGING</option>
            <option value="ANSWERED">ANSWERED</option>
            <option value="ENDED">ENDED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
            <option value="">Все направления</option>
            <option value="OUTBOUND">OUTBOUND</option>
            <option value="INBOUND">INBOUND</option>
          </select>
          <button className="secondary" type="button" onClick={() => void loadAll()}>
            Обновить
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Call ID</th>
                <th>Контакт</th>
                <th>Статус</th>
                <th>Пояснение</th>
                <th>Время</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>{c.id.slice(0, 10)}...</td>
                  <td>{c.contact?.name ?? c.contact?.phone ?? "-"}</td>
                  <td>
                    <span className={c.status === "ENDED" ? "badge ok" : c.status === "FAILED" ? "badge warn" : "badge"}>
                      {statusTitle[c.status]}
                    </span>
                  </td>
                  <td style={{ minWidth: 280, whiteSpace: "normal" }}>
                    <div>{statusHint[c.status]}</div>
                    {c.failureReason ? (
                      <div className="muted">Причина: {c.failureReason}</div>
                    ) : null}
                  </td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="row">
                      {["CREATED", "QUEUED", "RINGING", "ANSWERED"].includes(c.status) ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void cancelCall(c.id)}
                        >
                          Отменить
                        </button>
                      ) : null}
                      {["FAILED", "ENDED"].includes(c.status) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void retryCall(c.id)}
                        >
                          Повторить
                        </button>
                      ) : null}
                      {c.status === "ENDED" ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void openCallAnalytics(c.id)}
                        >
                          📝 Транскрипт
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {calls.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={6}>
                    По выбранным фильтрам звонков нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2 className="section-title">Топ причин ошибок</h2>
        {(overview?.topFailureReasons ?? []).length === 0 ? (
          <p className="muted">Ошибок пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Причина</th>
                  <th>Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.topFailureReasons ?? []).map((item) => (
                  <tr key={item.reason}>
                    <td style={{ whiteSpace: "normal" }}>{item.reason}</td>
                    <td>{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Stop words config ── */}
      <section className="card stack">
        <h2 className="section-title">Стоп-слова</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Если клиент произносит стоп-слово — система автоматически выполняет действие после звонка.
          DNC — добавить в стоп-лист, TAG — добавить тег на контакт, NOTIFY — записать уведомление.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="стоп-слово (напр. не интересно)"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select value={newAction} onChange={(e) => setNewAction(e.target.value as "DNC" | "TAG" | "NOTIFY")}>
            <option value="DNC">DNC (стоп-лист)</option>
            <option value="TAG">TAG (тег)</option>
            <option value="NOTIFY">NOTIFY (уведомление)</option>
          </select>
          {newAction === "TAG" && (
            <input
              placeholder="название тега"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              style={{ width: 140 }}
            />
          )}
          <button type="button" onClick={() => void addStopWord()}>Добавить</button>
        </div>
        {stopWords.length === 0 ? (
          <p className="muted">Стоп-слова не настроены.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Слово</th><th>Действие</th><th>Тег</th><th></th></tr></thead>
              <tbody>
                {stopWords.map((sw, i) => (
                  <tr key={i}>
                    <td><strong>{sw.word}</strong></td>
                    <td><span className={sw.action === "DNC" ? "badge warn" : "badge"}>{sw.action}</span></td>
                    <td>{sw.tag ?? "-"}</td>
                    <td><button type="button" className="secondary" onClick={() => void removeStopWord(i)}>Удалить</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Call transcript modal ── */}
      {selectedCallId && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}
          onClick={() => setSelectedCallId(null)}
        >
          <div style={{ background: "var(--card-bg, #1e1e2e)", borderRadius: 12, padding: 24, maxWidth: 700, width: "95%", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Транскрипт звонка</h2>
              <button type="button" className="secondary" onClick={() => setSelectedCallId(null)}>✕</button>
            </div>
            {analyticsLoading ? <p className="muted">Загрузка...</p> : !callAnalytics ? (
              <p className="muted">Транскрипт ещё не готов. Аналитика обрабатывается после завершения звонка.</p>
            ) : (
              <div className="stack">
                {callAnalytics.summary && (
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Итог</p>
                    <p className="muted">{callAnalytics.summary}</p>
                  </div>
                )}
                {callAnalytics.detectedKeywords && callAnalytics.detectedKeywords.length > 0 && (
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Обнаружены стоп-слова</p>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {callAnalytics.detectedKeywords.map((k, i) => (
                        <span key={i} className="badge warn" style={{ padding: "2px 8px" }}>
                          {k.word} ({k.action} ×{k.count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {callAnalytics.transcript ? (
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Разговор</p>
                    <pre style={{ background: "rgba(255,255,255,.05)", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}>
                      {callAnalytics.transcript}
                    </pre>
                  </div>
                ) : <p className="muted">Транскрипт отсутствует.</p>}
                {callAnalytics.improvements && (
                  <div>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>Что улучшить боту</p>
                    <p className="muted">{callAnalytics.improvements}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <section className="card stack">
        <h2 className="section-title">Аудит действий</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Кто</th>
                <th>Action</th>
                <th>Resource</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.actorId ?? "system"}</td>
                  <td>{row.action}</td>
                  <td>{row.resource}</td>
                </tr>
              ))}
              {audit.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={4}>
                    Пока нет действий в журнале.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
