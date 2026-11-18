"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";

const actions = [
  {
    titleKey: "quickStart.understand",
    badgeKey: "quickStart.readOnly",
    promptKey: "quickStart.prompt.understand",
  },
  {
    titleKey: "quickStart.reviewChanges",
    badgeKey: "quickStart.readOnly",
    promptKey: "quickStart.prompt.reviewChanges",
  },
  {
    titleKey: "quickStart.runTests",
    badgeKey: "quickStart.runsCommands",
    promptKey: "quickStart.prompt.runTests",
  },
] as const;

interface QuickStartActionsProps {
  onPick: (prompt: string) => boolean | undefined;
}

export function QuickStartActions({ onPick }: QuickStartActionsProps) {
  const { t } = useLocale();
  const [draftNotice, setDraftNotice] = useState(false);

  return (
    <div className="mb-4" role="group" aria-label={t("quickStart.title")}>
      <div className="mb-1.5 text-center text-[11px] font-medium text-text-dim">{t("quickStart.title")}</div>
      <div className="grid grid-cols-1 justify-items-center gap-1 sm:grid-cols-3">
        {actions.map((action) => {
          const title = t(action.titleKey);
          const badge = t(action.badgeKey);
          return (
            <button
              key={action.titleKey}
              type="button"
              aria-label={`${title}, ${badge}`}
              onClick={() => setDraftNotice(onPick(t(action.promptKey)) === false)}
              className="inline-flex max-w-full items-center justify-center gap-2 rounded px-2 py-1.5 text-[12px] text-text-muted transition-colors hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span>{title}</span>
              <span className="whitespace-nowrap text-[10px] text-text-dim">{badge}</span>
            </button>
          );
        })}
      </div>
      {draftNotice && <div role="status" className="mt-1 text-center text-[11px] text-text-dim">{t("quickStart.draftExists")}</div>}
    </div>
  );
}
