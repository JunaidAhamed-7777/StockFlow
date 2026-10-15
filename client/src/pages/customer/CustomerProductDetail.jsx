import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProduct } from "../../services/product.service";
import { useCart } from "../../context/CartContext";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, stockStatus } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { ErrorState } from "../../components/ui/ErrorState";
import { Loading } from "../../components/ui/Loading";
import { Input } from "../../components/ui/Input";
import { ProductImage } from "../../components/ProductImage";

export function CustomerProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await getProduct(id);
        if (!cancelled) {
          setProduct(data);
          setQuantity(1);
          setNotice("");
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading) return <Loading label="Loading product…" />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  if (!product) return <ErrorState message="Product not found." />;

  const status = stockStatus(product);

  function onAdd() {
    if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > Number(product.quantity)) {
      setNotice("Enter a whole number between 1 and the available stock.");
      return;
    }
    addItem(product, quantity);
    setNotice("Added to your cart. Quantities are limited to available stock.");
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Products", to: "/customer/products" }, { label: product.name }]}
        title={product.name}
        badge={<StatusBadge status={status} />}
        actions={<Button variant="outline" onClick={() => navigate("/customer/products")}>Back to catalog</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-8 overflow-hidden">
          <ProductImage product={product} className="h-64 sm:h-80 w-full" showCredit />
          <div className="p-space-xl space-y-space-md">
          <h2 className="font-headline-sm">Product information</h2>
          <p className="font-body-md text-on-surface-variant">{product.description || "Contact the supplier for further product information."}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-md font-body-sm">
            <div><dt className="text-outline uppercase tracking-wider font-caption">SKU</dt><dd className="font-mono-data">{product.sku}</dd></div>
            <div><dt className="text-outline uppercase tracking-wider font-caption">Category</dt><dd>{product.category?.name || "—"}</dd></div>
            <div><dt className="text-outline uppercase tracking-wider font-caption">Supplier</dt><dd>{product.supplier?.companyName || "—"}</dd></div>
            <div><dt className="text-outline uppercase tracking-wider font-caption">Available</dt><dd>{product.quantity}</dd></div>
          </dl>
          </div>
        </Card>
        <Card className="lg:col-span-4 p-space-xl space-y-space-md">
          <div className="font-headline-lg">{formatCurrency(product.price)}</div>
          <Input id="qty" label="Quantity" type="number" min="1" step="1" max={product.quantity} disabled={status === "OUT"} value={quantity} onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))} hint={`${product.quantity} units currently available`} />
          <Button className="w-full" disabled={status === "OUT" || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > Number(product.quantity)} onClick={onAdd}>{status === "OUT" ? "Out of stock" : "Add to cart"}</Button>
          <Button className="w-full" variant="outline" onClick={() => navigate("/customer/cart")}>View cart</Button>
          <p className="font-caption text-secondary" role="status" aria-live="polite">{notice}</p>
        </Card>
      </div>
    </>
  );
}
