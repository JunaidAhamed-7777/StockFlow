import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { Icon } from "./Icon";
import { Button } from "./Button";

export function Modal({ open, title, children, onClose, footer, wide = false, dismissible = true }) {
  const titleId = useId();
  const panelRef = useRef(null);
  useDialogFocus(panelRef, open, dismissible ? onClose : undefined, true);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-space-lg">
      <div className="absolute inset-0 bg-on-surface/40" aria-hidden="true" onClick={dismissible ? onClose : undefined} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative w-full ${wide ? "max-w-3xl" : "max-w-lg"} bg-surface-container-lowest rounded-xl border border-outline-variant shadow-xl max-h-[90dvh] overflow-auto`}>
        <div className="flex items-center justify-between px-space-lg py-space-base border-b border-outline-variant">
          <h2 id={titleId} className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
          <button type="button" onClick={onClose} disabled={!dismissible} aria-label="Close dialog" className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-space-lg">{children}</div>
        {footer ? <div className="px-space-lg py-space-base border-t border-outline-variant flex justify-end gap-space-sm">{footer}</div> : null}
      </div>
    </div>, document.body
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = "Confirm", danger, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" disabled={loading} onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="font-body-sm text-body-sm text-on-surface-variant">{message}</p>
    </Modal>
  );
}
