import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Input";
import { Card } from "./ui/Card";
import { ErrorState } from "./ui/ErrorState";
import { Icon } from "./ui/Icon";
import { PageHeader } from "./ui/PageHeader";
import { getErrorMessage } from "../utils/errors";
import { createProduct, getProduct, updateProduct } from "../services/product.service";
import { getCategories, getSuppliers } from "../services/discovery.service";
import { useAuth } from "../context/AuthContext";
import { Loading } from "./ui/Loading";

const emptyForm = {
  name: "",
  description: "",
  sku: "",
  price: "",
  quantity: "",
  lowStockThreshold: "10",
  categoryId: "",
  supplierId: "",
};

export function ProductForm({ productId, cancelTo, successTo }) {
  const navigate = useNavigate();
  const { role, supplier } = useAuth();
  const isEdit = Boolean(productId);
  const [form, setForm] = useState(emptyForm);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setLoadError("");
      try {
        const [cats, sups] = await Promise.all([getCategories(), role === "ADMIN" ? getSuppliers() : Promise.resolve([])]);
        if (cancelled) return;
        setCategories(cats || []);
        setSuppliers(sups || []);
        if (isEdit) {
          const product = await getProduct(productId);
          if (cancelled) return;
          if (role === "SUPPLIER" && Number(product.supplierId) !== Number(supplier?.id)) {
            setLoadError("You can only edit products assigned to your supplier profile.");
            return;
          }
          setForm({
            name: product.name || "",
            description: product.description || "",
            sku: product.sku || "",
            price: String(product.price ?? ""),
            quantity: String(product.quantity ?? ""),
            lowStockThreshold: String(product.lowStockThreshold ?? 10),
            categoryId: String(product.categoryId ?? ""),
            supplierId: String(product.supplierId ?? ""),
          });
        } else if (role === "SUPPLIER" && supplier?.id) {
          setForm({ ...emptyForm, supplierId: String(supplier.id) });
        } else if (role === "SUPPLIER") {
          setLoadError("No supplier profile is linked to this account. A supplier profile is required to manage products.");
        } else {
          setForm(emptyForm);
        }
      } catch (err) {
        if (!cancelled) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [isEdit, productId, role, supplier?.id, reloadKey]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      sku: form.sku.trim(),
      price: Number(form.price),
      lowStockThreshold: Number(form.lowStockThreshold),
      categoryId: Number(form.categoryId),
    };
    const initialQuantity = Number(form.quantity);
    const validStock = isEdit || (form.quantity !== "" && Number.isSafeInteger(initialQuantity) && initialQuantity >= 0 && initialQuantity <= 2147483647);
    if (!isEdit) payload.quantity = initialQuantity;
    if (!payload.name || !payload.sku || !Number.isSafeInteger(payload.categoryId) || payload.categoryId < 1 || !Number.isFinite(payload.price) || payload.price < 0 || !validStock || !Number.isSafeInteger(payload.lowStockThreshold) || payload.lowStockThreshold < 0 || payload.lowStockThreshold > 2147483647 || form.price === "" || form.lowStockThreshold === "") {
      setError("Enter a name, SKU and category, a valid non-negative price, and non-negative whole numbers for stock and threshold.");
      setSaving(false);
      return;
    }
    if (role === "ADMIN") {
      payload.supplierId = Number(form.supplierId);
      if (!Number.isSafeInteger(payload.supplierId) || payload.supplierId < 1) {
        setError("Select a supplier.");
        setSaving(false);
        return;
      }
    }
    if (role === "SUPPLIER" && !supplier?.id) {
      setError("No supplier profile is linked to this account. Product create/update is blocked until a supplier record exists.");
      setSaving(false);
      return;
    }
    try {
      if (isEdit) {
        await updateProduct(productId, payload);
      } else {
        await createProduct(payload);
      }
      navigate(successTo);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Loading label="Loading product form…" />;
  }
  if (loadError) return <ErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />;

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <span>Products</span>
            <span className="text-outline-variant">/</span>
            <span className="text-secondary font-medium">{isEdit ? "Edit specification" : "Create SKU"}</span>
          </>
        }
        title={isEdit ? "Edit product" : "Create product"}
        description="Keep product information, pricing, and replenishment thresholds up to date."
        actions={
          <>
            <Button variant="outline" disabled={saving} onClick={() => navigate(cancelTo)}>Cancel</Button>
            <Button variant="dark" type="submit" form="product-form" loading={saving} disabled={role === "SUPPLIER" && !supplier?.id} icon={<Icon name="publish" size={16} />}>
              {isEdit ? "Save SKU" : "Publish SKU"}
            </Button>
          </>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <form id="product-form" onSubmit={onSubmit}>
      <fieldset disabled={saving} className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl min-w-0">
        <legend className="sr-only">Product information</legend>
        <Card className="lg:col-span-8 p-space-xl flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <Icon name="fingerprint" className="text-secondary" />
            <h2 className="font-headline-sm text-headline-sm">Core Identification</h2>
          </div>
          <Input id="name" label="Product name" maxLength={200} value={form.name} onChange={(e) => setField("name", e.target.value)} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <Input id="sku" label="SKU" maxLength={100} value={form.sku} onChange={(e) => setField("sku", e.target.value)} required />
            <Select id="categoryId" label="Category" value={form.categoryId} onChange={(e) => setField("categoryId", e.target.value)} required>
              <option value="">Select category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </div>
          <Textarea id="description" label="Description" maxLength={4000} value={form.description} onChange={(e) => setField("description", e.target.value)} />
        </Card>
        <Card className="lg:col-span-4 p-space-xl flex flex-col gap-space-md">
          <div className="flex items-center gap-space-xs">
            <Icon name="payments" className="text-secondary" />
            <h2 className="font-headline-sm text-headline-sm">Pricing & Stock</h2>
          </div>
          <Input id="price" label="Unit price" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setField("price", e.target.value)} required />
          <Input id="quantity" label={isEdit ? "Stock when form opened" : "Initial quantity"} hint={isEdit ? "Reference only. Product edits do not change inventory." : "Opening stock for this new product."} readOnly={isEdit} type="number" min="0" max="2147483647" step="1" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} required={!isEdit} />
          {isEdit ? <p className="font-caption text-on-surface-variant"><Link className="text-secondary underline underline-offset-2" to={role === "ADMIN" ? "/admin/inventory" : "/supplier/stock"}>Record a stock adjustment</Link> to receive or issue units with an audit reason.</p> : null}
          <Input id="lowStockThreshold" label="Low-stock threshold" hint="Flag this product when stock reaches this quantity or lower." type="number" min="0" max="2147483647" step="1" value={form.lowStockThreshold} onChange={(e) => setField("lowStockThreshold", e.target.value)} required />
          {role === "ADMIN" ? (
            <Select id="supplierId" label="Supplier" value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} required>
              <option value="">Select supplier</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>{item.companyName}</option>
              ))}
            </Select>
          ) : (
            <div className="font-body-sm text-body-sm text-on-surface-variant bg-surface-container-low rounded-lg p-space-sm">
              Supplier ownership is assigned automatically to {supplier?.companyName || "your supplier profile"}.
            </div>
          )}
          <Button type="submit" variant="dark" loading={saving} disabled={role === "SUPPLIER" && !supplier?.id}>{isEdit ? "Save changes" : "Create product"}</Button>
        </Card>
      </fieldset>
      </form>
    </>
  );
}
