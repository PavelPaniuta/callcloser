"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppBar,
  Badge,
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import Stack from "@mui/material/Stack";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { AppThemeMode, getAppTheme } from "./theme";
import { clearToken, api } from "@/lib/api";
import { useRouter } from "next/navigation";
import LocalFireDepartmentRoundedIcon from "@mui/icons-material/LocalFireDepartmentRounded";
import PermContactCalendarRoundedIcon from "@mui/icons-material/PermContactCalendarRounded";

const drawerWidth = 272;

const navItems = [
  { href: "/", label: "Дашборд", icon: <HomeRoundedIcon /> },
  { href: "/admin", label: "Мониторинг", icon: <MonitorHeartRoundedIcon /> },
  {
    href: "/settings",
    label: "Интеграции и SIP",
    icon: <SettingsSuggestRoundedIcon />,
  },
  { href: "/prompts", label: "Промпты", icon: <DescriptionRoundedIcon /> },
  { href: "/phone-bases", label: "Базы номеров", icon: <PermContactCalendarRoundedIcon /> },
  { href: "/campaigns", label: "Кампании", icon: <CampaignRoundedIcon /> },
  { href: "/hot-calls", label: "Горячие звонки", icon: <LocalFireDepartmentRoundedIcon />, hot: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [hotCount, setHotCount] = React.useState(0);

  React.useEffect(() => {
    api<{ count: number }>("/api/admin/hot-calls/count")
      .then((d) => setHotCount(d.count))
      .catch(() => {});
    const t = setInterval(() => {
      api<{ count: number }>("/api/admin/hot-calls/count")
        .then((d) => setHotCount(d.count))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  function logout() {
    clearToken();
    router.push("/login");
  }
  const [mode, setMode] = React.useState<AppThemeMode>("dark");
  const toggleDrawer = () => setMobileOpen((v) => !v);
  const appTheme = React.useMemo(() => getAppTheme(mode), [mode]);

  React.useEffect(() => {
    const saved = window.localStorage.getItem("crm-theme");
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      return;
    }
    const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setMode(preferredDark ? "dark" : "light");
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    window.localStorage.setItem("crm-theme", mode);
  }, [mode]);

  const toggleTheme = () => setMode((v) => (v === "dark" ? "light" : "dark"));

  const drawer = (
    <Stack sx={{ height: "100%", p: 1.2, gap: 1 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          px: 1.4,
          py: 1.2,
          borderRadius: 2,
          bgcolor: mode === "dark" ? "rgba(20,31,67,0.65)" : "rgba(235, 241, 255, 0.9)",
          border: "1px solid",
          borderColor: "divider",
          alignItems: "center",
        }}
      >
        <AutoAwesomeRoundedIcon color="primary" />
        <Box sx={{ flexGrow: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 15 }}>AI CRM Control Center</Typography>
          <Typography variant="caption" color="text.secondary">
            Voice Ops Platform
          </Typography>
        </Box>
        <Tooltip title={mode === "dark" ? "Светлая тема" : "Темная тема"}>
          <IconButton size="small" onClick={toggleTheme}>
            {mode === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
          </IconButton>
        </Tooltip>
      </Stack>

      <List sx={{ py: 0.5 }}>
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const isHot = (item as { hot?: boolean }).hot;
          const showBadge = isHot && hotCount > 0;
          return (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              sx={{
                mb: 0.5,
                borderRadius: 2,
                border: "1px solid",
                borderColor: active ? (isHot ? "#ef4444" : "primary.main") : "transparent",
                bgcolor: active
                  ? isHot
                    ? "rgba(239,68,68,0.15)"
                    : mode === "dark" ? "rgba(81,106,216,0.2)" : "rgba(79,111,255,0.12)"
                  : "transparent",
                "&:hover": {
                  bgcolor: isHot ? "rgba(239,68,68,0.1)" : mode === "dark" ? "rgba(81,106,216,0.16)" : "rgba(79,111,255,0.09)",
                  transform: "translateX(2px)",
                },
                transition: "all .16s ease",
              }}
            >
              <ListItemIcon sx={{ minWidth: 36, color: active ? (isHot ? "#f87171" : "primary.light") : isHot ? "#f87171" : "text.secondary" }}>
                {item.icon}
              </ListItemIcon>
              <Typography
                sx={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "text.primary" : isHot ? "#f87171" : "text.secondary",
                  flexGrow: 1,
                }}
              >
                {item.label}
              </Typography>
              {showBadge && (
                <Box sx={{
                  background: "#ef4444", color: "#fff",
                  borderRadius: 10, fontSize: 11, fontWeight: 700,
                  px: 0.8, py: 0.1, minWidth: 20, textAlign: "center",
                }}>
                  {hotCount}
                </Box>
              )}
            </ListItemButton>
          );
        })}
      </List>

      <Box sx={{ mt: "auto", pt: 1 }}>
        <ListItemButton
          onClick={logout}
          sx={{
            borderRadius: 2,
            border: "1px solid transparent",
            "&:hover": { bgcolor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)" },
            transition: "all .16s ease",
          }}
        >
          <ListItemIcon sx={{ minWidth: 36, color: "error.light" }}>
            <LogoutRoundedIcon />
          </ListItemIcon>
          <Typography sx={{ fontWeight: 500, color: "error.light" }}>
            Выйти
          </Typography>
        </ListItemButton>
      </Box>
    </Stack>
  );

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <AppBar
          position="fixed"
          color="transparent"
          elevation={0}
          sx={{
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid",
            borderColor: "divider",
            display: { xs: "block", lg: "none" },
          }}
        >
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={toggleDrawer}>
              <MenuRoundedIcon />
            </IconButton>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700 }}>
              AI CRM
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Tooltip title="Campaign hub">
              <IconButton color="inherit">
                <Badge color="secondary" variant="dot">
                  <CampaignRoundedIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === "dark" ? "Светлая тема" : "Темная тема"}>
              <IconButton color="inherit" onClick={toggleTheme}>
                {mode === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box component="nav" sx={{ width: { lg: drawerWidth }, flexShrink: { lg: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={toggleDrawer}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: "block", lg: "none" },
              "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box" },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: "none", lg: "block" },
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                boxSizing: "border-box",
                borderRight:
                  mode === "dark"
                    ? "1px solid rgba(168, 189, 255, 0.18)"
                    : "1px solid rgba(79, 111, 255, 0.18)",
                background:
                  mode === "dark"
                    ? "linear-gradient(180deg, rgba(6,11,28,0.92) 0%, rgba(7,12,31,0.96) 100%)"
                    : "linear-gradient(180deg, rgba(246,249,255,0.98) 0%, rgba(239,244,255,0.98) 100%)",
              },
            }}
          >
            {drawer}
          </Drawer>
        </Box>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            width: { lg: `calc(100% - ${drawerWidth}px)` },
            pt: { xs: 9, lg: 2.4 },
            px: { xs: 1.2, md: 2.1, lg: 2.6 },
            pb: 2.4,
            background:
              mode === "dark"
                ? "radial-gradient(1000px 520px at -10% -20%, rgba(91,124,250,0.22), transparent 55%), radial-gradient(900px 500px at 110% 5%, rgba(77,225,216,0.14), transparent 55%), linear-gradient(180deg, #060b1c 0%, #050816 45%, #040712 100%)"
                : "radial-gradient(1000px 520px at -10% -20%, rgba(82,120,255,0.22), transparent 55%), radial-gradient(900px 500px at 110% 5%, rgba(36,201,194,0.15), transparent 55%), linear-gradient(180deg, #f8faff 0%, #eef3ff 45%, #e8efff 100%)",
          }}
        >
          {children}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
