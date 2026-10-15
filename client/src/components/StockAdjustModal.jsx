import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Textarea } from "./ui/Input";
import { adjustStock } from "../services/stock.service";
import { getErrorMessage } from "../utils/errors";

export function StockAdjustModal({ product, open, onClose, onAdjusted }) {
  const [quantityChange, setQuantityChange] = useState("0");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuantityChange("0");
    setReason("");
    setError("");
  }, [product?.id, open]);

  async function onSubmit(event) {
    event.preventDefault();
    if (!product || saving) return;
    const change = Number(quantityChange);
    if (!Number.isSafeInteger(change) || change === 0) {
      setError("Enter a non-zero whole number for the quantity change.");
      return;
    }
    if (!Number.isSafeInteger(Number(product.quantity) + change) || Number(product.quantity) + change < 0) {
      setError("This adjustment would put stock below zero or exceed the supported quantity. Enter a smaller change.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason so the stock change can be traced in the audit history.");
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
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="stock-adjust-form" loading={saving}>Apply adjustment</Button>
        </>
      }
    >
      <form id="stock-adjust-form" onSubmit={onSubmit} className="flex flex-col gap-space-md">
        <p className="font-body-sm text-on-surface-variant">
          Current on-hand quantity for {product.name}: <span className="font-mono-data text-on-surface">{product.quantity}</span>
        </p>
        <Input
          id="quantityChange"
          label="Quantity change"
          hint="Use a positive number to receive stock, or a negative number to issue stock."
          type="number"
          step="1"
          min={-Number(product.quantity)}
          disabled={saving}
          value={quantityChange}
          onChange={(e) => setQuantityChange(e.target.value)}
          required
        />
        <p className="font-body-sm">Quantity after adjustment: <strong className="font-mono-data">{Number.isSafeInteger(Number(quantityChange)) ? Number(product.quantity) + Number(quantityChange) : "—"}</strong></p>
        <Textarea id="reason" label="Reason for adjustment" placeholder="For example: supplier delivery received, or damaged units removed" maxLength={500} disabled={saving} required value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="font-caption text-caption text-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
