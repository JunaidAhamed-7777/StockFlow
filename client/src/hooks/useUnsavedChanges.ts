import { useCallback, useEffect } from "react";
import { useBlocker } from "react-router-dom";

/** Protect unsaved forms during route changes and actual document exits. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const active = dirty && !busy;
  const shouldBlock = useCallback(({ currentLocation, nextLocation }: { currentLocation: { pathname: string; search: string }; nextLocation: { pathname: string; search: string } }) => active && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search), [active]);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  return blocker;
}
