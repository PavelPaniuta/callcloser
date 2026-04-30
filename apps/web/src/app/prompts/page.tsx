"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type PromptRow = {
  id: string;
  name: string;
  systemPrompt: string;
  isActive: boolean;
  publishedAt: string | null;
  createdAt: string;
};

export default function PromptsPage() {
  const [items, setItems] = useState<PromptRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    systemPrompt: "",
  });

  async function reload() {
    const rows = await api<PromptRow[]>("/api/prompts");
    setItems(rows);
  }

  useEffect(() => {
    void reload().catch((e) => setErr(String((e as Error).message)));
  }, []);

  async function createPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.systemPrompt.trim()) {
      setErr("Заполните имя и текст промпта");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api("/api/prompts", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          systemPrompt: form.systemPrompt.trim(),
        }),
      });
      setForm({ name: "", systemPrompt: "" });
      setInfo("Промпт создан");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function publishPrompt(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/prompts/${id}/publish`, { method: "POST" });
      setInfo("Промпт опубликован и активирован");
      await reload();
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
          <h1 className="page-title">Промпты AI</h1>
          <p className="page-subtitle">Создавайте версии промптов и публикуйте активную.</p>
        </div>
      </div>

      {err && <div className="card muted">{err}</div>}
      {info && <div className="card muted">{info}</div>}

      <section className="card stack">
        <h2 className="section-title">Новый промпт</h2>
        <form className="stack" onSubmit={createPrompt}>
          <label>
            Название
            <input
              value={form.name}
              onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
              placeholder="sales-qualification-ru"
            />
          </label>
          <label>
            System Prompt
            <textarea
              rows={8}
              value={form.systemPrompt}
              onChange={(e) =>
                setForm((v) => ({ ...v, systemPrompt: e.target.value }))
              }
              placeholder="Ты ассистент колл-центра..."
            />
          </label>
          <div className="row">
            <button type="submit" disabled={busy}>
              Сохранить
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="section-title">Версии промптов</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Статус</th>
                <th>Создан</th>
                <th>Публикация</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div><strong>{p.name}</strong></div>
                    <div className="muted">{p.systemPrompt.slice(0, 110)}...</div>
                  </td>
                  <td>
                    <span className={p.isActive ? "badge ok" : "badge warn"}>
                      {p.isActive ? "ACTIVE" : "DRAFT"}
                    </span>
                  </td>
                  <td>{new Date(p.createdAt).toLocaleString()}</td>
                  <td>{p.publishedAt ? new Date(p.publishedAt).toLocaleString() : "-"}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy || p.isActive}
                      onClick={() => void publishPrompt(p.id)}
                    >
                      Publish
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Пока нет промптов
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
