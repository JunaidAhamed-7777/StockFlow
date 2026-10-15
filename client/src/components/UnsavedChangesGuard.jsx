import { useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { ConfirmModal } from "./ui/Modal";

export function UnsavedChangesGuard({ dirty, busy = false }) {
  const blocker = useUnsavedChanges(dirty, busy);
  return (
    <ConfirmModal
      open={blocker.state === "blocked"}
      title="Discard unsaved changes?"
      message="Your changes have not been saved. Stay on this page to continue editing, or discard them to leave."
      confirmLabel="Discard changes"
      danger
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
    />
  );
}
