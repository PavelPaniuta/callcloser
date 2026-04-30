"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { api, getToken } from "@/lib/api";

type Contact = {
  id: string;
  phone: string;
  name: string | null;
  _count?: { calls: number };
};

type Call = {
  id: string;
  status: string;
  direction: string;
  createdAt: string;
  failureReason?: string | null;
};

export default function ContactsPage() {
  const [items, setItems] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const gatewayWs = useMemo(
    () => typeof window !== "undefined" ? window.location.origin : "",
    [],
  );

  useEffect(() => {
    Promise.all([
      api<Contact[]>("/api/contacts"),
      api<Call[]>("/api/calls").catch(() => []),
    ])
      .then(([contacts, callsResp]) => {
        setItems(contacts);
        setCalls(callsResp);
      })
      .catch((e) => setErr(String(e.message)));
  }, []);

  useEffect(() => {
    const socket: Socket = io(gatewayWs, { transports: ["websocket"] });
    socket.on("call", (payload: { callId?: string; event?: string; status?: string }) => {
      setLog((l) =>
        [
          `${payload.event ?? "call"} ${payload.callId ?? ""} ${payload.status ?? ""}`.trim(),
          ...l,
        ].slice(0, 12),
      );
      void api<Call[]>("/api/calls")
        .then((rows) => setCalls(rows))
        .catch(() => undefined);
    });
    return () => {
      socket.disconnect();
    };
  }, [gatewayWs]);

  async function cancelCall(callId: string) {
    setActionBusy(true);
    setErr(null);
    try {
      await api(`/api/calls/${callId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled by user from dashboard" }),
      });
      const rows = await api<Call[]>("/api/calls");
      setCalls(rows);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteContact(contactId: string) {
    if (!confirm("Удалить контакт?")) return;
    setActionBusy(true);
    setErr(null);
    try {
      const token = getToken();
      const r = await fetch(`${gatewayWs}/api/contacts/${contactId}`, {
        method: "DELETE",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(await r.text());
      const [contacts, callsResp] = await Promise.all([
        api<Contact[]>("/api/contacts"),
        api<Call[]>("/api/calls").catch(() => []),
      ]);
      setItems(contacts);
      setCalls(callsResp);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setActionBusy(false);
    }
  }

  const metrics = useMemo(() => {
    const totalCalls = calls.length;
    const successCalls = calls.filter((c) => c.status === "ENDED").length;
    const answered = calls.filter((c) => c.status === "ANSWERED" || c.status === "ENDED").length;
    const answerRate = totalCalls === 0 ? 0 : Math.round((answered / totalCalls) * 100);
    return {
      contacts: items.length,
      totalCalls,
      successCalls,
      answerRate,
    };
  }, [items, calls]);

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI CRM — Панель управления</h1>
          <p className="page-subtitle">Статусы, контакты и управление звонками в одном месте.</p>
        </div>
        <a className="btn" href="/admin">Открыть админ-мониторинг</a>
      </div>

      {err && <p className="muted">{err}</p>}

      <section className="card stack">
        <h2 className="section-title">Что происходит сейчас</h2>
        {calls.some((c) => ["CREATED", "QUEUED", "RINGING", "ANSWERED"].includes(c.status)) ? (
          calls
            .filter((c) => ["CREATED", "QUEUED", "RINGING", "ANSWERED"].includes(c.status))
            .slice(0, 3)
            .map((c) => (
              <div key={c.id} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{c.id.slice(0, 8)}...</strong>{" "}
                  <span className="badge">{c.status}</span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={actionBusy}
                  onClick={() => void cancelCall(c.id)}
                >
                  Отменить звонок
                </button>
              </div>
            ))
        ) : (
          <p className="muted">Активных звонков нет.</p>
        )}
        {log.length > 0 ? (
          <div className="stack">
            {log.map((entry, idx) => (
              <div key={idx} className="muted">
                {entry}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Live-логи появятся во время звонка.</p>
        )}
      </section>

      <section className="grid kpi-grid">
        <article className="card kpi-card">
          <h3>Всего звонков</h3>
          <div className="kpi-value">{metrics.totalCalls}</div>
        </article>
        <article className="card kpi-card">
          <h3>Успешно завершено</h3>
          <div className="kpi-value">{metrics.successCalls}</div>
        </article>
        <article className="card kpi-card">
          <h3>Контактов</h3>
          <div className="kpi-value">{metrics.contacts}</div>
        </article>
        <article className="card kpi-card">
          <h3>Answer rate</h3>
          <div className="kpi-value">{metrics.answerRate}%</div>
        </article>
      </section>

      <section className="card">
        <h2 className="section-title">Контакты</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Телефон</th>
                <th>Звонков</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">Загрузка данных...</td>
                </tr>
              )}
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name ?? "Без имени"}</td>
                  <td>{c.phone}</td>
                  <td>{c._count?.calls ?? 0}</td>
                  <td>
                    <div className="row">
                      <Link className="btn" href={`/contacts/${c.id}`}>Открыть</Link>
                      <button
                        type="button"
                        className="danger"
                        disabled={actionBusy}
                        onClick={() => void deleteContact(c.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title">Последние звонки</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Направление</th>
                <th>Статус</th>
                <th>Время</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, 10).map((c) => (
                <tr key={c.id}>
                  <td>{c.id.slice(0, 8)}...</td>
                  <td>{c.direction}</td>
                  <td>
                    <span className={c.status === "ENDED" ? "badge ok" : c.status === "FAILED" ? "badge warn" : "badge"}>
                      {c.status}
                    </span>
                    {c.status === "FAILED" && c.failureReason ? (
                      <div className="muted">{c.failureReason}</div>
                    ) : null}
                  </td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">Пока нет звонков</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
