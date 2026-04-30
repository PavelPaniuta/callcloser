"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import Stack from "@mui/material/Stack";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import ContactsRoundedIcon from "@mui/icons-material/ContactsRounded";
import PermContactCalendarRoundedIcon from "@mui/icons-material/PermContactCalendarRounded";

type PhoneBase = {
  id: string;
  name: string;
  count: number;
  createdAt: string;
};

type Lead = { phone: string; name?: string };

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\D/g, "")}`;
  return `+${cleaned}`;
}

const PHONE_RE = /^\+?[\d\s\-\(\)]{7,}$/;

function parseText(text: string): Lead[] {
  const leads: Lead[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const chunks = line.split(/[;,\t]/).map((v) => v.trim()).filter(Boolean);
    if (chunks.length === 0) continue;
    if (chunks.length === 1) {
      const phone = normalizePhone(chunks[0]);
      if (phone) leads.push({ phone });
    } else {
      const allPhones = chunks.every((c) => PHONE_RE.test(c));
      if (allPhones) {
        for (const chunk of chunks) {
          const phone = normalizePhone(chunk);
          if (phone) leads.push({ phone });
        }
      } else {
        const phone = normalizePhone(chunks[chunks.length - 1]);
        const name = chunks[0];
        if (phone) leads.push({ name, phone });
      }
    }
  }
  return leads.filter((x) => /^\+?[0-9]{10,15}$/.test(x.phone));
}

export default function PhoneBasesPage() {
  const [bases, setBases] = useState<PhoneBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New base dialog
  const [dlgOpen, setDlgOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<Lead[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<PhoneBase[]>("/api/admin/phone-bases");
      setBases(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    setPreview(parseText(rawText));
  }, [rawText]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
    };
    reader.readAsText(file, "utf-8");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCreate() {
    if (!newName.trim()) { setSaveErr("Введіть назву бази"); return; }
    if (preview.length === 0) { setSaveErr("Немає валідних номерів"); return; }
    setSaving(true);
    setSaveErr(null);
    try {
      await api("/api/admin/phone-bases", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), numbers: preview }),
      });
      setDlgOpen(false);
      setNewName("");
      setRawText("");
      setPreview([]);
      await load();
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api(`/api/admin/phone-bases/${deleteId}`, { method: "DELETE" });
      setDeleteId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mb: 2.5 }}>
        <PermContactCalendarRoundedIcon sx={{ fontSize: 28, color: "primary.main" }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Базы номеров</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Загружайте базы контактов и выбирайте их при создании кампании
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => { setDlgOpen(true); setSaveErr(null); setNewName(""); setRawText(""); setPreview([]); }}
        >
          Новая база
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && bases.length === 0 && (
        <Paper sx={{ p: 4, textAlign: "center", borderRadius: 3, border: "1px dashed", borderColor: "divider" }}>
          <ContactsRoundedIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
          <Typography sx={{ color: "text.secondary" }}>Нет баз номеров. Создайте первую!</Typography>
        </Paper>
      )}

      <Stack spacing={1.5}>
        {bases.map((b) => (
          <Card key={b.id} sx={{ borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
            <CardContent sx={{ py: "12px !important" }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <ContactsRoundedIcon sx={{ color: "primary.main", fontSize: 28 }} />
                <Box sx={{ flexGrow: 1 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: 15 }}>{b.name}</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {new Date(b.createdAt).toLocaleString("uk-UA")}
                  </Typography>
                </Box>
                <Chip label={`${b.count} номеров`} size="small" color="primary" variant="outlined" />
                <Tooltip title="Удалить базу">
                  <IconButton size="small" color="error" onClick={() => setDeleteId(b.id)}>
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* Create dialog */}
      <Dialog open={dlgOpen} onClose={() => !saving && setDlgOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Новая база номеров</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="Название базы"
              fullWidth
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Например: Холодная база апрель 2026"
            />

            <Box>
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                Загрузите CSV/TXT файл или вставьте номера вручную.
                <br />
                Поддерживаемые форматы: один номер на строку, или через <b>;</b> / <b>,</b>
                <br />
                С именем: <code>Иван; +380501234567</code>
              </Typography>
              <Button
                variant="outlined"
                startIcon={<UploadFileRoundedIcon />}
                onClick={() => fileRef.current?.click()}
                size="small"
              >
                Загрузить файл
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </Box>

            <TextField
              label="Номера"
              multiline
              minRows={6}
              maxRows={14}
              fullWidth
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`+380501234567\n+380671234568\nИван; +380991234569`}
              inputProps={{ style: { fontFamily: "monospace", fontSize: 13 } }}
            />

            {rawText && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Chip
                  label={`${preview.length} валидных номеров`}
                  color={preview.length > 0 ? "success" : "error"}
                  size="small"
                />
                {preview.length > 0 && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Первые: {preview.slice(0, 3).map(l => l.phone).join(", ")}
                    {preview.length > 3 ? ` и ещё ${preview.length - 3}...` : ""}
                  </Typography>
                )}
              </Stack>
            )}

            {saveErr && <Alert severity="error">{saveErr}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDlgOpen(false)} disabled={saving}>Отмена</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={saving || preview.length === 0}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {saving ? "Сохраняем..." : `Создать (${preview.length} номеров)`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onClose={() => !deleting && setDeleteId(null)}>
        <DialogTitle>Удалить базу?</DialogTitle>
        <DialogContent>
          <Typography>Это действие необратимо. База будет удалена.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleting}>Отмена</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={16} /> : "Удалить"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
