"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";

function BoltIcon({ children, size = 13 }: { children?: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children ?? <path d="m13 2-8 11h7l-1 9 8-12h-7l1-8Z" />}
    </svg>
  );
}

export function QuickChatLauncher({ onOpen }: { onOpen: () => void }) {
  const { t } = useLocale();
  return (
    <div className="pi-quick-chat">
      <button className="pi-quick-chat-launcher" type="button" onClick={onOpen} aria-label={t("quickChat.open")}>
        <BoltIcon />
        {t("quickChat.tab")}
      </button>
    </div>
  );
}

export function QuickChatLoading() {
  const { t } = useLocale();
  return (
    <div className="pi-quick-chat">
      <div className="pi-quick-chat-launcher pi-quick-chat-loader" role="status" aria-live="polite">
        <span className="pi-quick-chat-loader-spinner" aria-hidden="true" />
        {t("deferred.loading", { feature: t("quickChat.title") })}
      </div>
    </div>
  );
}

export function QuickChatLoadError({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useLocale();
  return (
    <div className="pi-quick-chat pi-quick-chat-load-error" role="alert">
      <button className="pi-quick-chat-launcher" type="button" onClick={onDismiss} title={t("deferred.loadFailedHint")}>
        <BoltIcon><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></BoltIcon>
        {t("deferred.loadFailed", { feature: t("quickChat.title") })}
      </button>
      <button
        className="pi-quick-chat-load-reload"
        type="button"
        onClick={() => window.location.reload()}
        aria-label={t("deferred.reload")}
        title={t("deferred.reload")}
      >
        <BoltIcon size={14}><path d="M20 11a8 8 0 1 0-2.34 5.66" /><path d="M20 4v7h-7" /></BoltIcon>
      </button>
    </div>
  );
}
