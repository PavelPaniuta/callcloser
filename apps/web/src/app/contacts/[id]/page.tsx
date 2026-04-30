"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { api, getToken } from "@/lib/api";

type Call = {
  id: string;
  direction: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  analytics?: { summary: string | null; improvements: string | null } | null;
};

type ContactDetail = {
  id: string;
  phone: string;
  name: string | null;
  calls: Call[];
};

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [data, setData] = useState<ContactDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<{ id: string; name: string }[]>([]);
  const [promptId, setPromptId] = useState<string>("");
  const [actionBusy, setActionBusy] = useState(false);

  const gatewayWs = useMemo(
    () => process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:3010",
    [],
  );

  useEffect(() => {
    api<ContactDetail>(`/api/contacts/${id}`)
      .then(setData)
      .catch((e) => setErr(String(e.message)));
    Promise.all([
      api<{ id: string; name: string }[]>("/api/prompts"),
      api<{ id: string; name: string }>("/api/prompts/active"),
    ])
      .then(([list, active]) => {
        setPrompts(list);
        setPromptId(active.id);
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    const socket: Socket = io(gatewayWs, { transports: ["websocket"] });
    socket.on("call", (payload: { callId?: string; event?: string }) => {
      setLog((l) => [`${payload.event ?? "call"}: ${payload.callId ?? ""}`, ...l].slice(0, 10));
      void api<ContactDetail>(`/api/contacts/${id}`).then(setData);
    });
    return () => {
      socket.disconnect();
    };
  }, [gatewayWs, id]);

  async function startCall() {
    if (!data) return;
    setActionBusy(true);
    setErr(null);
    const token = getToken();
    const r = await fetch(`${gatewayWs}/api/calls/outbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        phone: data.phone,
        contactId: data.id,
        promptVersionId: promptId || undefined,
      }),
    });
    if (!r.ok) {
      setErr(await r.text());
      setActionBusy(false);
      return;
    }
    void api<ContactDetail>(`/api/contacts/${id}`).then(setData);
    setActionBusy(false);
  }

  async function cancelCall(callId: string) {
    setActionBusy(true);
    setErr(null);
    const token = getToken();
    const r = await fetch(`${gatewayWs}/api/calls/${callId}/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ reason: "Cancelled by user from CRM UI" }),
    });
    if (!r.ok) {
      setErr(await r.text());
      setActionBusy(false);
      return;
    }
    void api<ContactDetail>(`/api/contacts/${id}`).then(setData);
    setActionBusy(false);
  }

  async function openRecording(callId: string) {
    const token = getToken();
    const r = await fetch(`${gatewayWs}/api/recordings/${callId}/url`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return;
    const j = (await r.json()) as { url: string | null };
    if (j.url) window.open(j.url, "_blank");
  }

  async function clearHistory() {
    if (!confirm("Очистить историю звонков по этому контакту?")) return;
    setActionBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/calls?contactId=${id}`, {
        method: "DELETE",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(await r.text());
      const next = await api<ContactDetail>(`/api/contacts/${id}`);
      setData(next);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteCall(callId: string) {
    if (!confirm("Удалить этот звонок из истории?")) return;
    setActionBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/calls/${callId}`, {
        method: "DELETE",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(await r.text());
      const next = await api<ContactDetail>(`/api/contacts/${id}`);
      setData(next);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteContact() {
    if (!confirm("Удалить контакт? Это действие нельзя отменить.")) return;
    setActionBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/contacts/${id}`, {
        method: "DELETE",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(await r.text());
      router.push("/");
    } catch (e) {
      setErr(String((e as Error).message));
      setActionBusy(false);
    }
  }

  if (err && !data) return <p className="muted">{err}</p>;
  if (!data) return <p className="muted">Загрузка…</p>;

  const activeCall = data.calls.find((c) =>
    ["CREATED", "QUEUED", "RINGING", "ANSWERED"].includes(c.status),
  );

  const statusHint = (call: Call) => {
    if (call.status === "CREATED") return "Создано, готовим дозвон.";
    if (call.status === "QUEUED") return "Задача в очереди на исходящий вызов.";
    if (call.status === "RINGING") return "Идут гудки у провайдера.";
    if (call.status === "ANSWERED") return "Абонент ответил, диалог активен.";
    if (call.status === "FAILED")
      return call.failureReason ?? "Вызов не завершился успешно.";
    return "Звонок завершён.";
  };

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">{data.name ?? "Карточка контакта"}</h1>
          <p className="page-subtitle">{data.phone}</p>
        </div>
        <div className="row">
          <button type="button" className="secondary" disabled={actionBusy} onClick={() => void clearHistory()}>
            Очистить историю
          </button>
          <button type="button" className="danger" disabled={actionBusy} onClick={() => void deleteContact()}>
            Удалить контакт
          </button>
        </div>
      </div>

      {err && <p className="muted">{err}</p>}

      <section className="card">
        <h2 className="section-title">Быстрые действия</h2>
        <div className="form-grid">
          <div>
            <label>Промпт</label>
            <select value={promptId} onChange={(e) => setPromptId(e.target.value)}>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button type="button" disabled={actionBusy} onClick={() => void startCall()}>
              Исходящий ИИ-звонок
            </button>
          </div>
        </div>
        {activeCall ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <div>
              <strong>Текущий звонок:</strong>{" "}
              <span className="badge">{activeCall.status}</span>
            </div>
            <div className="muted">{statusHint(activeCall)}</div>
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={actionBusy}
                onClick={() => void cancelCall(activeCall.id)}
              >
                Отменить звонок
              </button>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            Активного звонка сейчас нет.
          </p>
        )}
      </section>

      {log.length > 0 && (
        <section className="card">
          <h2 className="section-title">Live события</h2>
          <div className="stack">
            {log.map((entry, idx) => (
              <div key={idx} className="muted">{entry}</div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="section-title">История звонков</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Направление</th>
                <th>Статус</th>
                <th>Действия</th>
                <th>Итог AI</th>
              </tr>
            </thead>
            <tbody>
              {data.calls.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                  <td>{c.direction}</td>
                  <td>
                    <span className={c.status === "ENDED" ? "badge ok" : c.status === "FAILED" ? "badge warn" : "badge"}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void openRecording(c.id)}
                      >
                        Запись
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={actionBusy}
                        onClick={() => void deleteCall(c.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                  <td style={{ minWidth: 280, whiteSpace: "normal" }}>
                    {c.analytics ? (
                      <>
                        <div><strong>Итог:</strong> {c.analytics.summary ?? "-"}</div>
                        <div className="muted"><strong>Улучшить:</strong> {c.analytics.improvements ?? "-"}</div>
                      </>
                    ) : c.status === "FAILED" ? (
                      <span className="muted">
                        Ошибка: {c.failureReason ?? "неизвестная причина"}
                      </span>
                    ) : (
                      <span className="muted">Аналитика в обработке</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.calls.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">Звонков пока нет</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}