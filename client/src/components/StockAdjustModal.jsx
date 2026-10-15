import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea } from "./ui/Input";
import { adjustStock } from "../services/stock.service";
import { getErrorMessage } from "../utils/errors";
import { clearFieldError, focusFirstError, validateForm } from "../utils/formValidation";

export function StockAdjustModal({ product, open, onClose, onAdjusted }) {
  const [quantityChange, setQuantityChange] = useState("0");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    setQuantityChange("0");
    setReason("");
    setError("");
    setFieldErrors({});
  }, [product?.id, open]);

  async function onSubmit(event) {
    event.preventDefault();
    if (!product || saving) return;
    const errors = validateForm(event.currentTarget);
    const change = Number(quantityChange);
    if (!Number.isSafeInteger(change) || change === 0) {
      errors.quantityChange = "Enter a non-zero whole number for the quantity change.";
    }
    if (!Number.isSafeInteger(Number(product.quantity) + change) || Number(product.quantity) + change < 0 || Number(product.quantity) + change > 2147483647) {
      errors.quantityChange = "This adjustment would put stock below zero or exceed the supported quantity. Enter a smaller change.";
    }
    if (!reason.trim()) {
      errors.reason = "Enter a reason so the stock change can be traced in the audit history.";
    }
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) {
      focusFirstError(event.currentTarget, errors);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await adjustStock({
        productId: product.id,
        quantityChange: change,
        reason: reason.trim() || undefined,
      });
      onAdjusted?.(result);
      onClose();
      setQuantityChange("0");
      setReason("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!product) return null;

  return (
    <Modal
      open={open}
      title={`Adjust stock · ${product.sku}`}
      dismissible={!saving}
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="stock-adjust-form" loading={saving}>Apply adjustment</Button>
        </>
      }
    >
      <form id="stock-adjust-form" noValidate onSubmit={onSubmit} aria-busy={saving} className="flex flex-col gap-space-md">
        <p className="font-body-sm text-on-surface-variant">
          Current on-hand quantity for {product.name}: <span className="font-mono-data text-on-surface">{product.quantity}</span>
        </p>
        <Input
          id="quantityChange"
          name="quantityChange"
          label="Quantity change"
          error={fieldErrors.quantityChange}
          hint="Use a positive number to receive stock, or a negative number to issue stock."
          type="number"
          step="1"
          min={-Number(product.quantity)}
          max={2147483647 - Number(product.quantity)}
          disabled={saving}
          value={quantityChange}
          onChange={(e) => { setQuantityChange(e.target.value); setFieldErrors(current => clearFieldError(current, "quantityChange")); }}
          required
        />
        <p className="font-body-sm">Quantity after adjustment: <strong className="font-mono-data">{Number.isSafeInteger(Number(quantityChange)) ? Number(product.quantity) + Number(quantityChange) : "—"}</strong></p>
        <Textarea id="reason" name="reason" label="Reason for adjustment" error={fieldErrors.reason} placeholder="For example: supplier delivery received, or damaged units removed" maxLength={500} disabled={saving} required value={reason} onChange={(e) => { setReason(e.target.value); setFieldErrors(current => clearFieldError(current, "reason")); }} />
        {error ? <p className="font-caption text-caption text-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
