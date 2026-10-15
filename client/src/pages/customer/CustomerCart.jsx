import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../../context/CartContext";
import { createOrder } from "../../services/order.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";

export function CustomerCart() {
  const { items, updateQuantity, removeItem, clear, subtotal } = useCart();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function checkout() {
    if (saving || items.length === 0) return;
    if (items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > item.stock)) {
      setError("Each quantity must be a whole number within the available stock. Update your cart before placing the order.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const order = await createOrder(items.map((item) => ({ productId: item.productId, quantity: item.quantity })));
      clear();
      navigate(`/customer/orders/${order.id}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Procurement</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Wholesale checkout</span></>}
        title="Your cart"
        description="Review quantities and prices before placing your order. Stock and prices are confirmed when you submit."
        actions={<Button variant="outline" onClick={() => navigate("/customer/products")}>Continue shopping</Button>}
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
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
                  <input
                    type="number"
                    min="1"
                    step="1"
                    max={row.stock}
                    aria-label={`Quantity for ${row.name}`}
                    disabled={saving}
                    value={row.quantity}
                    onChange={(e) => updateQuantity(row.productId, Number(e.target.value))}
                    className="w-20 h-9 px-space-xs border border-slate-300 rounded font-mono-data focus:ring-2 focus:ring-blue-500"
                  />
                ),
              },
              { key: "line", header: "Line", align: "right", render: (row) => formatCurrency(row.price * row.quantity) },
              { key: "actions", header: "", render: (row) => <Button variant="danger" disabled={saving} aria-label={`Remove ${row.name} from cart`} onClick={() => removeItem(row.productId)}>Remove</Button> },
            ]}
          />
        </Card>
        <Card className="lg:col-span-4 p-space-xl space-y-space-md h-fit">
          <h2 className="font-headline-sm">Order summary</h2>
          <div className="flex justify-between font-body-sm"><span>Subtotal</span><span className="font-mono-data">{formatCurrency(subtotal)}</span></div>
          <p className="font-caption text-on-surface-variant">Subtotal includes product prices only. Tax and shipping are not calculated. Final product prices and availability are checked when you place your order.</p>
          <Button className="w-full" disabled={items.length === 0} loading={saving} onClick={checkout}>Place order</Button>
        </Card>
      </div>
    </>
  );
}
