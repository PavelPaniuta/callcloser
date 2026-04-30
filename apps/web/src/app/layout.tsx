import type { Metadata } from "next";
import "./globals.css";
import AppShell from "./app-shell";

export const metadata: Metadata = {
  title: "CRM Call Center",
  description: "Asterisk + AI CRM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
