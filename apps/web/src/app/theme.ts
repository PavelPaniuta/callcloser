import { createTheme } from "@mui/material/styles";

export type AppThemeMode = "dark" | "light";

export function getAppTheme(mode: AppThemeMode) {
  const isDark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? "#7f9bff" : "#4f6fff",
        light: isDark ? "#afc1ff" : "#7b91ff",
        dark: isDark ? "#5874eb" : "#3952d9",
      },
      secondary: {
        main: isDark ? "#3edfcf" : "#0fb8b2",
      },
      success: {
        main: "#30c98b",
      },
      warning: {
        main: "#eba840",
      },
      error: {
        main: "#e75b7b",
      },
      background: {
        default: isDark ? "#070b1a" : "#f3f6ff",
        paper: isDark ? "rgba(12, 20, 42, 0.86)" : "rgba(255, 255, 255, 0.84)",
      },
      text: {
        primary: isDark ? "#eff3ff" : "#17203b",
        secondary: isDark ? "#a5b2d4" : "#5f6f97",
      },
      divider: isDark ? "rgba(173, 191, 255, 0.2)" : "rgba(70, 100, 186, 0.17)",
    },
    shape: {
      borderRadius: 14,
    },
    typography: {
      fontFamily: [
        "Inter",
        "ui-sans-serif",
        "system-ui",
        "-apple-system",
        "Segoe UI",
        "Roboto",
        "sans-serif",
      ].join(","),
      h4: {
        fontWeight: 800,
        letterSpacing: "0.01em",
      },
      h5: {
        fontWeight: 700,
      },
      h6: {
        fontWeight: 700,
      },
      button: {
        textTransform: "none",
        fontWeight: 700,
      },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backdropFilter: "blur(10px)",
            border: `1px solid ${isDark ? "rgba(173, 191, 255, 0.2)" : "rgba(70, 100, 186, 0.15)"}`,
            boxShadow: isDark
              ? "0 14px 34px rgba(4, 8, 24, 0.45)"
              : "0 12px 30px rgba(65, 95, 168, 0.14)",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            paddingInline: 14,
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: "small",
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: isDark
              ? "rgba(9, 16, 35, 0.68)"
              : "rgba(245, 248, 255, 0.92)",
          },
        },
      },
    },
  });
}
