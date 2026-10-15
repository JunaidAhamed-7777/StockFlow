import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared keyboard containment for modal dialogs and the mobile navigation. */
export function useDialogFocus(ref: RefObject<HTMLElement>, active: boolean, onClose?: () => void, isolate = false): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const inerted: Array<{ element: HTMLElement; inert: boolean }> = [];
    if (isolate) {
      for (const child of Array.from(document.body.children)) {
        if (child instanceof HTMLElement && !child.contains(panel)) {
          inerted.push({ element: child, inert: child.inert });
          child.inert = true;
        }
      }
    }

    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    const focusFirst = () => (controls()[0] || panel).focus();
    const frame = requestAnimationFrame(focusFirst);

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
      }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocus(event: FocusEvent) {
      if (event.target instanceof Node && !panel?.contains(event.target)) focusFirst();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert } of inerted) element.inert = inert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [active, isolate, ref]);
}
