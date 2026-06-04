"use client";

import dynamic from "next/dynamic";
import { LocaleProvider } from "@/lib/i18n";

const AppShell = dynamic(() => import("./AppShell").then((mod) => mod.AppShell), {
  ssr: false,
  loading: () => <div style={{ height: "100dvh", background: "var(--bg)" }} />,
});

export function ClientOnlyAppShell() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}
