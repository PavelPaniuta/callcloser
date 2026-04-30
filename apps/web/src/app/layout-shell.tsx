"use client";

import { usePathname } from "next/navigation";
import AppShell from "./app-shell";

// Render AppShell (sidebar/nav) only when NOT on the login page
export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
