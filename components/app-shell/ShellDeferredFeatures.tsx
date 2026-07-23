"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import { DeferredFeatureBoundary, DeferredFeatureError, DeferredFeatureLoading } from "../DeferredFeature";
import { QuickChatLauncher, QuickChatLoadError, QuickChatLoading } from "../QuickChatLauncher";
import type { SessionInfo } from "@/lib/types";

const ModelsConfig = dynamic(() => import("../ModelsConfig").then((module) => module.ModelsConfig), {
  ssr: false,
  loading: () => <DeferredFeatureLoading featureKey="nav.models" variant="modal" />,
});

const CapabilitiesConfig = dynamic(() => import("../CapabilitiesConfig").then((module) => module.CapabilitiesConfig), {
  ssr: false,
  loading: () => <DeferredFeatureLoading featureKey="nav.capabilities" variant="modal" />,
});

const QuickChatPanel = dynamic(() => import("../QuickChatPanel").then((module) => module.QuickChatPanel), {
  ssr: false,
  loading: () => <QuickChatLoading />,
});

interface Props {
  modelsOpen: boolean;
  onCloseModels: () => void;
  onDismissModels: () => void;
  quickChatRequested: boolean;
  onRequestQuickChat: () => void;
  onDismissQuickChat: () => void;
  activeCwd: string | null;
  modelsRefreshKey: number;
  onOpenModels: () => void;
  onPromoted: (session: SessionInfo) => void;
  capabilitiesOpen: boolean;
  capabilitiesCwd: string | null;
  onCloseCapabilities: () => void;
}

export const ShellDeferredFeatures = memo(function ShellDeferredFeatures(props: Props) {
  return <>
    {props.modelsOpen && <DeferredFeatureBoundary resetKey="models" fallback={<DeferredFeatureError featureKey="nav.models" variant="modal" onDismiss={props.onDismissModels} />}><ModelsConfig onClose={props.onCloseModels} /></DeferredFeatureBoundary>}
    {props.quickChatRequested ? <DeferredFeatureBoundary resetKey="quick-chat" fallback={<QuickChatLoadError onDismiss={props.onDismissQuickChat} />}><QuickChatPanel activeCwd={props.activeCwd} modelsRefreshKey={props.modelsRefreshKey} initiallyOpen onOpenModels={props.onOpenModels} onPromoted={props.onPromoted} /></DeferredFeatureBoundary> : <QuickChatLauncher onOpen={props.onRequestQuickChat} />}
    {props.capabilitiesOpen && props.capabilitiesCwd && <DeferredFeatureBoundary resetKey={`capabilities:${props.capabilitiesCwd}`} fallback={<DeferredFeatureError featureKey="nav.capabilities" variant="modal" onDismiss={props.onCloseCapabilities} />}><CapabilitiesConfig cwd={props.capabilitiesCwd} onClose={props.onCloseCapabilities} /></DeferredFeatureBoundary>}
  </>;
});
