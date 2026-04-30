import type { Metadata } from "next";
import "./globals.css";
import LayoutShell from "./layout-shell";

export const metadata: Metadata = {
  title: "CallCloser CRM",
  description: "AI Voice CRM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
