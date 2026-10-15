import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { createOrder } from "../../services/order.service";
import { getProduct } from "../../services/product.service";
import { clearFieldError, focusFirstError, validateForm } from "../../utils/formValidation";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Input } from "../../components/ui/Input";

export function CustomerCart() {
  const { items, addItem, updateQuantity, removeItem, clear, subtotal } = useCart();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [quantityDrafts, setQuantityDrafts] = useState({});
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const validationRequest = useRef(null);
  useEffect(() => () => { validationRequest.current?.abort(); }, []);

  async function checkout(event) {
    event.preventDefault();
    if (saving || uncertain || items.length === 0) return;
    const errors = validateForm(event.currentTarget);
    setFieldErrors(errors);
    if (Object.keys(errors).length) { focusFirstError(event.currentTarget, errors); return; }
    if (items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > item.stock)) {
      setError("Each quantity must be a whole number within the available stock. Update your cart before placing the order.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    validationRequest.current = controller;
    let submittingOrder = false;
    try {
      const productIds = [...new Set(items.map((item) => item.productId))];
      const latest = new Map();
      let nextIndex = 0;
      await Promise.all(Array.from({ length: Math.min(4, productIds.length) }, async () => {
        while (nextIndex < productIds.length) {
          const productId = productIds[nextIndex++];
          try {
            const product = await getProduct(productId, { signal: controller.signal });
            if (Number(product?.id) !== productId) throw new Error("Product availability could not be verified. Try again before placing your order.");
            latest.set(productId, product);
          } catch (err) {
            if (err?.response?.status === 404) latest.set(productId, null);
            else throw err;
          }
        }
      }));
      controller.signal.throwIfAborted();
      let changed = false;
      for (const item of items) {
        const product = latest.get(item.productId);
        if (!product || !Number.isSafeInteger(product.quantity) || product.quantity < 1 || !Number.isFinite(product.price) || product.price < 0) {
          removeItem(item.productId);
          changed = true;
        } else if (product.price !== item.price || product.quantity !== item.stock) {
          removeItem(item.productId);
          addItem(product, Math.min(item.quantity, product.quantity));
          changed = true;
        }
      }
      if (changed) {
        setQuantityDrafts({});
        setNotice("Prices or availability changed. Your cart is updated; unavailable products were removed and quantities were limited to current stock. Review it before placing your order.");
        return;
      }
      submittingOrder = true;
      const order = await createOrder(items.map((item) => ({ productId: item.productId, quantity: item.quantity })));
      if (!Number.isSafeInteger(order?.id) || order.id < 1) throw new Error("Order confirmation was incomplete.");
      clear();
      navigate(`/customer/orders/${order.id}`);
    } catch (err) {
      if (controller.signal.aborted && !submittingOrder) return;
      if (!submittingOrder) controller.abort();
      if (submittingOrder && (!err?.response || err.response.status >= 500)) {
        setUncertain(true);
        setError("We could not confirm whether your order was placed. Check your orders before submitting again to avoid a duplicate order.");
      } else setError(getErrorMessage(err));
    } finally {
      if (validationRequest.current === controller) validationRequest.current = null;
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Products", to: "/customer/products" }, { label: "Cart" }]}
        title="Your cart"
        description="Review quantities and prices before placing your order. Stock and prices are confirmed when you submit."
        actions={<Button variant="outline" onClick={() => navigate("/customer/products")}>Continue shopping</Button>}
      />
      {error ? <ErrorState message={error} /> : null}
      {uncertain ? <Link to="/customer/orders" className="inline-flex mb-5 text-secondary font-semibold underline underline-offset-4">Review your orders</Link> : null}
      {notice ? <p role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</p> : null}
      <form noValidate onSubmit={checkout} aria-busy={saving} className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-8">
          <Table
            rows={items}
            rowKey="productId"
            empty={<EmptyState icon="shopping_cart" title="Your cart is empty" description="Add products from the catalog to build an order." actionLabel="Browse catalog" onAction={() => navigate("/customer/products")} />}
            columns={[
              { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
              { key: "name", header: "Product" },
              { key: "price", header: "Unit", align: "right", render: (row) => formatCurrency(row.price) },
              {
                key: "quantity",
                header: "Qty",
                render: (row) => (
                  <Input
                    id={`quantity-${row.productId}`}
                    name={`quantity-${row.productId}`}
                    type="number"
                    required
                    min="1"
                    step="1"
                    max={row.stock}
                    aria-label={`Quantity for ${row.name}`}
                    disabled={saving}
                    value={quantityDrafts[row.productId] ?? row.quantity}
                    error={fieldErrors[`quantity-${row.productId}`]}
                    onChange={(e) => {
                      const value = e.target.value;
                      setQuantityDrafts((current) => ({ ...current, [row.productId]: value }));
                      setFieldErrors((current) => clearFieldError(current, `quantity-${row.productId}`));
                      const quantity = Number(value);
                      if (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= row.stock) updateQuantity(row.productId, quantity);
                    }}
                    className="min-w-20 font-mono-data"
                  />
                ),
              },
              { key: "line", header: "Line", align: "right", render: (row) => formatCurrency(row.price * row.quantity) },
              { key: "actions", header: "", render: (row) => <Button variant="ghost" disabled={saving} aria-label={`Remove ${row.name} from cart`} onClick={() => removeItem(row.productId)}>Remove</Button> },
            ]}
          />
        </Card>
        <Card className="lg:col-span-4 p-space-xl space-y-space-md h-fit">
          <h2 className="font-headline-sm">Order summary</h2>
          <div className="flex justify-between font-body-sm"><span>Subtotal</span><span className="font-mono-data">{formatCurrency(subtotal)}</span></div>
          <p className="font-caption text-on-surface-variant">Subtotal includes product prices only. Tax and shipping are not calculated. Final product prices and availability are checked when you place your order.</p>
          <Button type="submit" className="w-full" disabled={items.length === 0 || uncertain} loading={saving}>Place order</Button>
        </Card>
      </form>
    </>
  );
}
