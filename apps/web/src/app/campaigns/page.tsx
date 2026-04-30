"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { motion } from "framer-motion";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import Stack from "@mui/material/Stack";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PauseCircleRoundedIcon from "@mui/icons-material/PauseCircleRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import ShieldMoonRoundedIcon from "@mui/icons-material/ShieldMoonRounded";
import DashboardCustomizeRoundedIcon from "@mui/icons-material/DashboardCustomizeRounded";

type PromptRow = { id: string; name: string; isActive: boolean };
type CampaignStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
type CampaignPolicy = {
  globalConcurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
};
type CampaignRun = {
  id: string;
  name: string;
  assistantLabel?: string;
  promptVersionId: string;
  engine?: "asterisk" | "vapi";
  status: CampaignStatus;
  total: number;
  processed: number;
  launched: number;
  failed: number;
  createdContacts: number;
  concurrency: number;
  maxAttempts: number;
  retryDelayMs: number;
  logs: string[];
  createdAt: string;
  startedAt: string;
  finishedAt?: string;
  cancelRequested: boolean;
  leads?: { name?: string; phone: string }[];
};

type ParsedLead = {
  name?: string;
  phone: string;
};

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\D/g, "")}`;
  return `+${cleaned.replace(/\D/g, "")}`;
}

function parseLeads(text: string): ParsedLead[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const chunks = line.split(/[;,]/).map((v) => v.trim()).filter(Boolean);
      if (chunks.length === 1) return { phone: normalizePhone(chunks[0]) };
      return { name: chunks[0], phone: normalizePhone(chunks[chunks.length - 1]) };
    })
    .filter((x) => /^\+?[0-9]{10,15}$/.test(x.phone));
}

function statusColor(status: CampaignStatus): "success" | "warning" | "error" | "primary" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "CANCELLED") return "error";
  if (status === "RUNNING") return "primary";
  return "warning";
}

export default function CampaignsPage() {
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [runs, setRuns] = useState<CampaignRun[]>([]);
  const [policy, setPolicy] = useState<CampaignPolicy>({
    globalConcurrency: 8,
    maxAttempts: 2,
    retryDelayMs: 1500,
  });
  const [dncList, setDncList] = useState<string[]>([]);
  const [promptId, setPromptId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [assistantLabel, setAssistantLabel] = useState("");
  const [engine, setEngine] = useState<"asterisk" | "vapi">("asterisk");
  const [concurrency, setConcurrency] = useState(3);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [retryDelayMs, setRetryDelayMs] = useState(1500);
  const [leadsRaw, setLeadsRaw] = useState("");
  const [dncPhone, setDncPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeLogRunId, setActiveLogRunId] = useState<string>("");

  async function reload() {
    const [promptRows, campaignRows, policyRow, dncRows] = await Promise.all([
      api<PromptRow[]>("/api/prompts"),
      api<CampaignRun[]>("/api/admin/campaigns"),
      api<CampaignPolicy>("/api/admin/campaigns/policy"),
      api<string[]>("/api/admin/campaigns/dnc"),
    ]);
    setPrompts(promptRows);
    setRuns(campaignRows);
    setPolicy(policyRow);
    setDncList(dncRows);
    if (!promptId) {
      const active = promptRows.find((x) => x.isActive);
      if (active) setPromptId(active.id);
    }
    setMaxAttempts(policyRow.maxAttempts);
    setRetryDelayMs(policyRow.retryDelayMs);
    if (!activeLogRunId && campaignRows[0]?.id) setActiveLogRunId(campaignRows[0].id);
  }

  useEffect(() => {
    void reload().catch((e) => setErr(String((e as Error).message)));
    const timer = setInterval(() => {
      void Promise.all([
        api<CampaignRun[]>("/api/admin/campaigns"),
        api<CampaignPolicy>("/api/admin/campaigns/policy"),
      ])
        .then(([campaigns, currentPolicy]) => {
          setRuns(campaigns);
          setPolicy(currentPolicy);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  async function startCampaign() {
    const leads = parseLeads(leadsRaw);
    if (!promptId) {
      setErr("Выберите промпт");
      return;
    }
    if (leads.length === 0) {
      setErr("Добавьте список контактов (минимум 1 валидный номер)");
      return;
    }

    setBusy(true);
    setErr(null);
    setInfo(null);

    try {
      const created = await api<CampaignRun>("/api/admin/campaigns/start", {
        method: "POST",
        body: JSON.stringify({
          name: campaignName || undefined,
          assistantLabel: assistantLabel || undefined,
          promptVersionId: promptId,
          engine,
          leads,
          concurrency,
          maxAttempts,
          retryDelayMs,
        }),
      });
      setInfo(`Кампания запущена: ${created.name}`);
      setLeadsRaw("");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy() {
    setErr(null);
    try {
      const next = await api<CampaignPolicy>("/api/admin/campaigns/policy", {
        method: "POST",
        body: JSON.stringify(policy),
      });
      setPolicy(next);
      setInfo("Глобальная политика обновлена");
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function addDnc() {
    const phone = normalizePhone(dncPhone);
    if (!/^\+[0-9]{10,15}$/.test(phone)) {
      setErr("Введите валидный номер для DNC");
      return;
    }
    setErr(null);
    try {
      const rows = await api<string[]>("/api/admin/campaigns/dnc/add", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setDncList(rows);
      setDncPhone("");
      setInfo("Номер добавлен в DNC");
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function removeDnc(phone: string) {
    setErr(null);
    try {
      const rows = await api<string[]>("/api/admin/campaigns/dnc/remove", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setDncList(rows);
      setInfo("Номер удален из DNC");
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function cancelCampaign(id: string) {
    setErr(null);
    try {
      await api(`/api/admin/campaigns/${id}/cancel`, { method: "POST" });
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }

  async function restartCampaign(id: string) {
    setErr(null);
    setBusy(true);
    try {
      const created = await api<{ id: string; name: string }>(`/api/admin/campaigns/${id}/restart`, { method: "POST" });
      setInfo(`Кампания перезапущена: ${created.name}`);
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const runningRuns = runs.filter((r) => r.status === "RUNNING");
  const doneRuns = runs.filter((r) => r.status === "COMPLETED");
  const failedRuns = runs.filter((r) => r.status === "FAILED" || r.status === "CANCELLED");
  const activeLogRun = runs.find((r) => r.id === activeLogRunId) ?? runs[0] ?? null;

  return (
    <Stack spacing={2.1}>
      <Box>
        <Typography variant="h4">Кампании прозвона</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.4 }}>
          Material board для запуска нескольких ассистентов по разным базам в реальном времени.
        </Typography>
      </Box>

      {err && <Alert severity="error">{err}</Alert>}
      {info && <Alert severity="success">{info}</Alert>}

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" },
        }}
      >
        <Box>
          <Paper sx={{ p: 1.7 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1.2, alignItems: "center" }}>
              <DashboardCustomizeRoundedIcon color="primary" />
              <Typography variant="h6">Новая кампания</Typography>
            </Stack>
            <Box
              sx={{
                display: "grid",
                gap: 1.1,
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              }}
            >
              <Box>
                <TextField
                  label="Название кампании"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  fullWidth
                />
              </Box>
              <Box>
                <TextField
                  label="Лейбл ассистента"
                  value={assistantLabel}
                  onChange={(e) => setAssistantLabel(e.target.value)}
                  fullWidth
                />
              </Box>
              <Box>
                <TextField
                  select
                  label="Движок звонков"
                  value={engine}
                  onChange={(e) => setEngine(e.target.value as "asterisk" | "vapi")}
                  fullWidth
                  helperText={
                    engine === "vapi"
                      ? "VAPI.ai — внешний AI (требует настройки в Settings)"
                      : "Asterisk + OpenAI — собственный сервис"
                  }
                >
                  <MenuItem value="asterisk">🔧 Asterisk (свой сервис)</MenuItem>
                  <MenuItem value="vapi">⚡ VAPI.ai</MenuItem>
                </TextField>
              </Box>
              <Box>
                <TextField
                  select
                  label="Промпт для сессии"
                  value={promptId}
                  onChange={(e) => setPromptId(e.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Выбрать</MenuItem>
                  {prompts.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} {p.isActive ? "(ACTIVE)" : ""}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
              <Box>
                <TextField
                  type="number"
                  label="Параллельных звонков"
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value || 1))}
                  fullWidth
                />
              </Box>
              <Box>
                <TextField
                  type="number"
                  label="Max attempts"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value || 1))}
                  fullWidth
                />
              </Box>
              <Box>
                <TextField
                  type="number"
                  label="Retry delay (ms)"
                  value={retryDelayMs}
                  onChange={(e) => setRetryDelayMs(Number(e.target.value || 0))}
                  fullWidth
                />
              </Box>
              <Box sx={{ gridColumn: { xs: "1 / -1" } }}>
                <TextField
                  label="База контактов"
                  value={leadsRaw}
                  onChange={(e) => setLeadsRaw(e.target.value)}
                  fullWidth
                  multiline
                  minRows={8}
                  placeholder="+79990000001&#10;Иван Петров; +79990000002"
                />
              </Box>
            </Box>
            <Stack direction="row" spacing={1} sx={{ mt: 1.4, alignItems: "center" }}>
              <Button
                variant="contained"
                startIcon={<PlayArrowRoundedIcon />}
                disabled={busy}
                onClick={() => void startCampaign()}
              >
                {busy ? "Запуск..." : "Старт кампании"}
              </Button>
              <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                К запуску: {parseLeads(leadsRaw).length} контактов
              </Typography>
            </Stack>
          </Paper>
        </Box>

        <Box>
          <Stack spacing={1.5}>
            <Paper sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
                <SettingsSuggestRoundedIcon color="primary" />
                <Typography variant="h6">Глобальная политика</Typography>
              </Stack>
              <Stack spacing={1}>
                <TextField
                  type="number"
                  label="Global concurrency"
                  value={policy.globalConcurrency}
                  onChange={(e) =>
                    setPolicy((v) => ({
                      ...v,
                      globalConcurrency: Number(e.target.value || 1),
                    }))
                  }
                />
                <TextField
                  type="number"
                  label="Default max attempts"
                  value={policy.maxAttempts}
                  onChange={(e) =>
                    setPolicy((v) => ({
                      ...v,
                      maxAttempts: Number(e.target.value || 1),
                    }))
                  }
                />
                <TextField
                  type="number"
                  label="Default retry delay (ms)"
                  value={policy.retryDelayMs}
                  onChange={(e) =>
                    setPolicy((v) => ({
                      ...v,
                      retryDelayMs: Number(e.target.value || 0),
                    }))
                  }
                />
                <Button variant="outlined" onClick={() => void savePolicy()}>
                  Сохранить
                </Button>
              </Stack>
            </Paper>

            <Paper sx={{ p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
                <ShieldMoonRoundedIcon color="warning" />
                <Typography variant="h6">DNC / Стоп-лист</Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <TextField
                  value={dncPhone}
                  onChange={(e) => setDncPhone(e.target.value)}
                  placeholder="+79990000000"
                  fullWidth
                />
                <Button onClick={() => void addDnc()}>Add</Button>
              </Stack>
              <Stack spacing={0.7} sx={{ maxHeight: 180, overflow: "auto" }}>
                {dncList.length === 0 && (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    Стоп-лист пуст.
                  </Typography>
                )}
                {dncList.map((phone) => (
                  <Stack
                    key={phone}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Typography sx={{ fontSize: 13 }}>{phone}</Typography>
                    <Button color="error" size="small" onClick={() => void removeDnc(phone)}>
                      Remove
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Box>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 1.4,
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr 1fr" },
        }}
      >
        {[
          { title: "RUNNING", rows: runningRuns, color: "primary" as const },
          { title: "COMPLETED", rows: doneRuns, color: "success" as const },
          { title: "FAILED/CANCELLED", rows: failedRuns, color: "error" as const },
        ].map((column) => (
          <Box key={column.title}>
            <Paper sx={{ p: 1.2, minHeight: 280 }}>
              <Stack
                direction="row"
                sx={{ mb: 1, alignItems: "center", justifyContent: "space-between" }}
              >
                <Typography variant="h6">{column.title}</Typography>
                <Chip size="small" color={column.color} label={column.rows.length} />
              </Stack>
              <Stack spacing={1}>
                {column.rows.length === 0 && (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    Нет кампаний
                  </Typography>
                )}
                {column.rows.map((r) => {
                  const percent = r.total === 0 ? 0 : Math.round((r.processed / r.total) * 100);
                  return (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0.5, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22 }}
                      whileHover={{ scale: 1.01 }}
                    >
                      <Card
                        onClick={() => setActiveLogRunId(r.id)}
                        sx={{
                          cursor: "pointer",
                          border:
                            activeLogRun?.id === r.id
                              ? "1px solid rgba(111,140,255,.6)"
                              : undefined,
                          ...(r.status === "RUNNING"
                            ? {
                                boxShadow:
                                  "0 0 0 1px rgba(111,140,255,.4), 0 12px 28px rgba(72,98,206,.28)",
                              }
                            : {}),
                        }}
                      >
                        <CardContent sx={{ pb: "12px !important" }}>
                          <Stack
                            direction="row"
                            sx={{ justifyContent: "space-between", alignItems: "center" }}
                          >
                            <Typography variant="subtitle2" sx={{ maxWidth: 210 }} noWrap>
                              {r.name}
                            </Typography>
                            <Chip size="small" color={statusColor(r.status)} label={r.status} />
                          </Stack>
                          <Stack direction="row" spacing={0.8} sx={{ mt: 0.4, alignItems: "center" }}>
                            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                              {r.assistantLabel ?? "assistant not set"}
                            </Typography>
                            <Chip
                              size="small"
                              label={r.engine === "vapi" ? "VAPI" : "Asterisk"}
                              color={r.engine === "vapi" ? "secondary" : "default"}
                              sx={{ fontSize: 10, height: 18 }}
                            />
                          </Stack>
                          <Box sx={{ mt: 1 }}>
                            <LinearProgress
                              variant="determinate"
                              value={percent}
                              color={statusColor(r.status)}
                            />
                          </Box>
                          <Stack direction="row" sx={{ mt: 0.8, justifyContent: "space-between" }}>
                            <Typography sx={{ fontSize: 12 }} color="text.secondary">
                              {r.processed}/{r.total}
                            </Typography>
                            <Typography sx={{ fontSize: 12 }} color="text.secondary">
                              ok {r.launched} / fail {r.failed}
                            </Typography>
                          </Stack>
                          {r.status === "RUNNING" && !r.cancelRequested && (
                            <Button
                              sx={{ mt: 1 }}
                              size="small"
                              variant="outlined"
                              color="warning"
                              startIcon={<PauseCircleRoundedIcon />}
                              onClick={(e) => {
                                e.stopPropagation();
                                void cancelCampaign(r.id);
                              }}
                            >
                              Stop
                            </Button>
                          )}
                          {(r.status === "COMPLETED" || r.status === "FAILED" || r.status === "CANCELLED") && (
                            <Button
                              sx={{ mt: 1 }}
                              size="small"
                              variant="contained"
                              color="primary"
                              disabled={busy || !r.leads?.length}
                              startIcon={<ReplayRoundedIcon />}
                              onClick={(e) => {
                                e.stopPropagation();
                                void restartCampaign(r.id);
                              }}
                            >
                              Restart
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </Stack>
            </Paper>
          </Box>
        ))}
      </Box>

      <Paper sx={{ p: 1.5 }}>
        <Typography variant="h6">Логи кампании</Typography>
        <Typography color="text.secondary" sx={{ mb: 1, fontSize: 13 }}>
          {activeLogRun ? activeLogRun.name : "Выберите кампанию"}
        </Typography>
        <Divider sx={{ mb: 1 }} />
        <Stack spacing={0.8} sx={{ maxHeight: 300, overflow: "auto" }}>
          {activeLogRun?.logs?.length ? (
            activeLogRun.logs.slice(0, 40).map((line, i) => (
              <Typography key={i} sx={{ fontSize: 12.5 }} color="text.secondary">
                {line}
              </Typography>
            ))
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              Логи появятся после запуска кампании.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
