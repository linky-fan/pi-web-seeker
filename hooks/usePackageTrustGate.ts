"use client";

import { useRef, useSyncExternalStore } from "react";
import { PackageTrustGateController } from "@/lib/package-trust-gate";

export function usePackageTrustGate() {
  const controllerRef = useRef<PackageTrustGateController | null>(null);
  if (!controllerRef.current) controllerRef.current = new PackageTrustGateController();
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  return {
    ...snapshot,
    runWithTrust: controller.runWithTrust,
    resolve: controller.resolve,
    dismiss: controller.dismiss,
  };
}