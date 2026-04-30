"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Keyword = { word: string; action: string; count: number };

type HotCall = {
  id: string;
  callId: string;
  reviewStatus: "PENDING_REVIEW" | "IN_PROGRESS" | "REVIEWED" | "CLOSED" | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  telegramSent: boolean;
  detectedKeywords: Keyword[] | null;
  summary: string | null;
  transcript: string | null;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string } | null;
  callDirection: string;
  callStatus: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING_REVIEW: { label: "⏳ Ожидает", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  IN_PROGRESS:    { label: "🔥 В работе", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  REVIEWED:       { label: "✅ Проверен", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  CLOSED:         { label: "🔒 Закрыт",   color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const FILTER_TABS = [
  { key: "", label: "Все" },
  { key: "PENDING_REVIEW", label: "⏳ Ожидают" },
  { key: "IN_PROGRESS",    label: "🔥 В работе" },
  { key: "REVIEWED",       label: "✅ Проверены" },
  { key: "CLOSED",         label: "🔒 Закрыты" },
];

export default function HotCallsPage() {
  const [calls, setCalls] = useState<HotCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<HotCall | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function load(status = filter) {
    setLoading(true);
    try {
      const url = status
        ? `/api/admin/hot-calls?status=${status}`
        : "/api/admin/hot-calls";
      const data = await api<HotCall[]>(url);
      setCalls(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function applyFilter(key: string) {
    setFilter(key);
    void load(key);
  }

  async function updateStatus(id: string, reviewStatus: string, reviewNote?: string) {
    setSaving(true);
    try {
      await api(`/api/admin/hot-calls/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ reviewStatus, reviewNote }),
      });
      await load();
      if (selected?.id === id) {
        setSelected((s) => s ? { ...s, reviewStatus: reviewStatus as HotCall["reviewStatus"], reviewNote: reviewNote ?? s.reviewNote } : s);
      }
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = calls.filter((c) => c.reviewStatus === "PENDING_REVIEW" || c.reviewStatus === "IN_PROGRESS").length;

  return (
    <main className="stack">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            🚨 Горячие звонки
            {pendingCount > 0 && (
              <span style={{
                marginLeft: 10, fontSize: 14, fontWeight: 700,
                background: "#ef4444", color: "#fff",
                borderRadius: 20, padding: "2px 10px",
              }}>
                {pendingCount}
              </span>
            )}
          </h1>
          <p className="page-subtitle">
            Звонки с обнаруженными стоп-словами. Telegram-уведомления отправляются автоматически.
          </p>
        </div>
        <button onClick={() => void load()} className="secondary">🔄 Обновить</button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => applyFilter(t.key)}
            className={filter === t.key ? "" : "secondary"}
            style={{ fontSize: 13 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : calls.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <p style={{ color: "#aaa", margin: 0 }}>Нет звонков с стоп-словами</p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          {/* Call list */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {calls.map((c) => {
              const st = STATUS_LABELS[c.reviewStatus ?? "PENDING_REVIEW"] ?? STATUS_LABELS.PENDING_REVIEW;
              const isSelected = selected?.id === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => { setSelected(c); setNoteInput(c.reviewNote ?? ""); }}
                  className="card"
                  style={{
                    cursor: "pointer",
                    border: isSelected ? "1px solid #3b82f6" : undefined,
                    transition: "border-color 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600, padding: "2px 8px",
                          borderRadius: 8, background: st.bg, color: st.color,
                        }}>
                          {st.label}
                        </span>
                        {c.telegramSent && (
                          <span style={{ fontSize: 12, color: "#60a5fa" }}>✈️ TG</span>
                        )}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
                        {c.contact?.name ?? "Неизвестный клиент"}{" "}
                        <span style={{ color: "#888", fontWeight: 400, fontSize: 13 }}>
                          {c.contact?.phone ?? "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {(c.detectedKeywords ?? []).map((kw, i) => (
                          <span key={i} style={{
                            fontSize: 11, padding: "2px 6px", borderRadius: 6,
                            background: "rgba(239,68,68,0.15)", color: "#f87171",
                            fontWeight: 600,
                          }}>
                            {kw.word} ×{kw.count}
                          </span>
                        ))}
                      </div>
                      {c.summary && (
                        <p style={{ fontSize: 13, color: "#888", marginTop: 6, marginBottom: 0 }}>
                          {c.summary.slice(0, 120)}{c.summary.length > 120 ? "..." : ""}
                        </p>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#555", whiteSpace: "nowrap" }}>
                      {new Date(c.createdAt).toLocaleString("ru")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{ width: 400, flexShrink: 0 }}>
              <div className="card" style={{ position: "sticky", top: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>Детали звонка</h3>
                  <button className="secondary" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setSelected(null)}>✕</button>
                </div>

                {/* Client info */}
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "#aaa", marginBottom: 4 }}>👤 Клиент</div>
                  <div style={{ fontWeight: 600 }}>{selected.contact?.name ?? "Неизвестно"}</div>
                  <div style={{ color: "#60a5fa", fontSize: 14 }}>{selected.contact?.phone ?? "—"}</div>
                </div>

                {/* Keywords */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>🔑 Стоп-слова</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(selected.detectedKeywords ?? []).map((kw, i) => (
                      <span key={i} style={{
                        fontSize: 12, padding: "3px 8px", borderRadius: 8,
                        background: "rgba(239,68,68,0.2)", color: "#f87171", fontWeight: 600,
                      }}>
                        {kw.word} ×{kw.count} [{kw.action}]
                      </span>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                {selected.summary && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: "#aaa", marginBottom: 4 }}>📋 Итог звонка</div>
                    <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{selected.summary}</p>
                  </div>
                )}

                {/* Transcript */}
                {selected.transcript && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>💬 Транскрипт</div>
                    <div style={{
                      background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: 10,
                      maxHeight: 200, overflowY: "auto", fontSize: 12, lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}>
                      {selected.transcript}
                    </div>
                  </div>
                )}

                {/* Note */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>📝 Заметка оператора</div>
                  <textarea
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Напишите заметку..."
                    rows={3}
                    style={{ width: "100%", resize: "vertical", fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, color: "#aaa", marginBottom: 2 }}>Изменить статус:</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {["PENDING_REVIEW", "IN_PROGRESS", "REVIEWED", "CLOSED"].map((s) => {
                      const st = STATUS_LABELS[s];
                      const isActive = selected.reviewStatus === s;
                      return (
                        <button
                          key={s}
                          disabled={saving || isActive}
                          onClick={() => void updateStatus(selected.id, s, noteInput)}
                          style={{
                            fontSize: 12, padding: "6px 8px",
                            background: isActive ? st.bg : undefined,
                            color: isActive ? st.color : undefined,
                            border: isActive ? `1px solid ${st.color}` : undefined,
                            opacity: isActive ? 1 : undefined,
                          }}
                          className={isActive ? "" : "secondary"}
                        >
                          {st.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
