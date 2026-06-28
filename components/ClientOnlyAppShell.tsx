"use client";

import dynamic from "next/dynamic";
import { LocaleProvider } from "@/lib/i18n";

const AppShell = dynamic(() => import("./AppShell").then((mod) => mod.AppShell), {
  ssr: false,
  loading: () => <div className="pi-app-loading-shell" aria-hidden="true" />,
});

export function ClientOnlyAppShell() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}
