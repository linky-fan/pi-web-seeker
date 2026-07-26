"use client";

import { memo, type RefObject } from "react";
import { AgentsMdStatus } from "../AgentsMdStatus";
import { BrandTypewriterHeader } from "../BrandTypewriter";
import { ChatInput } from "../ChatInput";
import type { ChatInputHandle, ChatInputProps } from "../chat-input/types";
import { ExtensionWidgets } from "./ExtensionUi";
import { areComposerSurfacePropsEqual } from "./memoComparators";
import type { ExtensionWidget } from "./types";

export interface ComposerSurfaceProps {
  empty: boolean;
  isFluid: boolean;
  activeCwd: string | null;
  inputRef?: RefObject<ChatInputHandle | null>;
  inputProps: ChatInputProps;
  aboveWidgets: ExtensionWidget[];
  belowWidgets: ExtensionWidget[];
}

function ComposerContents({ activeCwd, isFluid, inputRef, inputProps, aboveWidgets, belowWidgets }: Omit<ComposerSurfaceProps, "empty">) {
  return (
    <>
      {activeCwd && !isFluid ? <AgentsMdStatus cwd={activeCwd} variant="classic" /> : null}
      <ExtensionWidgets widgets={aboveWidgets} />
      <ChatInput ref={inputRef} {...inputProps} />
      <ExtensionWidgets widgets={belowWidgets} />
    </>
  );
}

function ComposerSurfaceImpl(props: ComposerSurfaceProps) {
  if (props.empty) {
    return (
      <div
        className={`${props.isFluid ? "pi-fluid-empty-chat" : "pi-empty-chat"} flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8`}
        style={props.isFluid ? { padding: "76px 48px 42px", background: "transparent" } : undefined}
      >
        <div className="w-full max-w-[820px]">
          <div className="mb-3" style={{ marginLeft: 16, marginRight: 52 }}><BrandTypewriterHeader /></div>
          <ComposerContents {...props} />
        </div>
      </div>
    );
  }
  return (
    <div
      className={`${props.isFluid ? "pi-fluid-composer-dock" : "pi-composer-dock"} relative`}
      style={props.isFluid ? { background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 82%, transparent) 28px, color-mix(in srgb, var(--bg) 90%, transparent))" } : undefined}
    >
      <ComposerContents {...props} />
    </div>
  );
}

export const ComposerSurface = memo(ComposerSurfaceImpl, areComposerSurfacePropsEqual);
