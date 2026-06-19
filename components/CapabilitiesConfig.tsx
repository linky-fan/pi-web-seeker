"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { revealElement } from "@/lib/motion";
import { SkillsConfig } from "./SkillsConfig";
import { ToolsConfig } from "./ToolsConfig";
import { SubagentsConfig } from "./SubagentsConfig";
import { NetworkConfig } from "./NetworkConfig";

type CapabilityTab = "skills" | "tools" | "subagents" | "network";

interface Props {
  cwd: string;
  onClose: () => void;
}

const TABS: CapabilityTab[] = ["skills", "tools", "subagents", "network"];

export function CapabilitiesConfig({ cwd, onClose }: Props) {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<CapabilityTab>("skills");
  const [closeSignal, setCloseSignal] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tween = revealElement(tabsRef.current, { y: -6, duration: 0.2 });
    return () => { tween?.kill(); };
  }, []);

  return (
    <>
      <div
        ref={tabsRef}
        style={{
          position: "fixed",
          top: 18,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1200,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 4,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        }}
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                height: 30,
                minWidth: 92,
                padding: "0 12px",
                border: "none",
                borderRadius: 6,
                background: selected ? "var(--bg-selected)" : "transparent",
                color: selected ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: selected ? 650 : 500,
              }}
            >
              {t(`capabilities.${tab}`)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCloseSignal((value) => value + 1)}
          title={t("common.close")}
          style={{
            width: 30,
            height: 30,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>
      {activeTab === "skills" && <SkillsConfig cwd={cwd} onClose={onClose} closeSignal={closeSignal} />}
      {activeTab === "tools" && <ToolsConfig cwd={cwd} onClose={onClose} closeSignal={closeSignal} />}
      {activeTab === "subagents" && <SubagentsConfig cwd={cwd} onClose={onClose} closeSignal={closeSignal} />}
      {activeTab === "network" && <NetworkConfig cwd={cwd} onClose={onClose} closeSignal={closeSignal} />}
    </>
  );
}
