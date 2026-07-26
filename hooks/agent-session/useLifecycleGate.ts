import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LifecycleToken } from "./helpers";
import { isLifecycleTokenCurrent } from "./helpers";

export function useLifecycleGate(identity: string) {
  const tokenRef = useRef<LifecycleToken>({ generation: 0, identity });
  const mountedRef = useRef(true);
  if (tokenRef.current.identity !== identity) {
    tokenRef.current = { generation: tokenRef.current.generation + 1, identity };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      tokenRef.current = { generation: tokenRef.current.generation + 1, identity: tokenRef.current.identity };
    };
  }, []);

  const capture = useCallback((): LifecycleToken => ({ ...tokenRef.current }), []);
  const isCurrent = useCallback((token: LifecycleToken) => (
    mountedRef.current && isLifecycleTokenCurrent(token, tokenRef.current)
  ), []);

  return useMemo(() => ({ tokenRef, mountedRef, capture, isCurrent }), [capture, isCurrent]);
}
