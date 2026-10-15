import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Input";
import { Card } from "./ui/Card";
import { ErrorState } from "./ui/ErrorState";
import { PageHeader } from "./ui/PageHeader";
import { getErrorMessage } from "../utils/errors";
import { createProduct, getProduct, updateProduct } from "../services/product.service";
import { getCategories, getSuppliers } from "../services/discovery.service";
import { useAuth } from "../context/AuthContext";
import { Loading } from "./ui/Loading";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { clearFieldError, focusFirstError, validateForm } from "../utils/formValidation";

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
  const [initialForm, setInitialForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
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
          const values = {
            name: product.name || "",
            description: product.description || "",
            sku: product.sku || "",
            price: String(product.price ?? ""),
            quantity: String(product.quantity ?? ""),
            lowStockThreshold: String(product.lowStockThreshold ?? 10),
            categoryId: String(product.categoryId ?? ""),
            supplierId: String(product.supplierId ?? ""),
          };
          setForm(values);
          setInitialForm(values);
        } else if (role === "SUPPLIER" && supplier?.id) {
          const values = { ...emptyForm, supplierId: String(supplier.id) };
          setForm(values);
          setInitialForm(values);
        } else if (role === "SUPPLIER") {
          setLoadError("No supplier profile is linked to this account. A supplier profile is required to manage products.");
        } else {
          setForm(emptyForm);
          setInitialForm(emptyForm);
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
    setFieldErrors((current) => clearFieldError(current, key));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const errors = validateForm(event.currentTarget);
    if (!categories.some((category) => Number(category.id) === Number(form.categoryId))) errors.categoryId = "Select an available category.";
    if (role === "ADMIN" && !suppliers.some((owner) => Number(owner.id) === Number(form.supplierId))) errors.supplierId = "Select an available supplier.";
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length) { focusFirstError(event.currentTarget, errors); return; }
    setSaving(true);
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
      <UnsavedChangesGuard dirty={JSON.stringify(form) !== JSON.stringify(initialForm)} busy={loading || saving} />
      <PageHeader
        breadcrumb={
          <>
            <span>Products</span>
            <span className="text-outline-variant">/</span>
            <span className="text-secondary font-medium">{isEdit ? "Edit product" : "New product"}</span>
          </>
        }
        title={isEdit ? "Edit product" : "Create product"}
        description="Keep product information, pricing, and replenishment thresholds up to date."
        actions={
          <>
            <Button variant="outline" disabled={saving} onClick={() => navigate(cancelTo)}>Cancel</Button>
            <Button type="submit" form="product-form" loading={saving} disabled={role === "SUPPLIER" && !supplier?.id}>
              {isEdit ? "Save changes" : "Create product"}
            </Button>
          </>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <form id="product-form" noValidate onSubmit={onSubmit} aria-busy={saving}>
      <fieldset disabled={saving} className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl min-w-0">
        <legend className="sr-only">Product information</legend>
        <Card className="lg:col-span-8 p-space-xl flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm">Product details</h2>
          <Input id="name" name="name" label="Product name" error={fieldErrors.name} maxLength={200} value={form.name} onChange={(e) => setField("name", e.target.value)} required />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <Input id="sku" name="sku" label="SKU" error={fieldErrors.sku} maxLength={100} value={form.sku} onChange={(e) => setField("sku", e.target.value)} required />
            <Select id="categoryId" name="categoryId" label="Category" error={fieldErrors.categoryId} value={form.categoryId} onChange={(e) => setField("categoryId", e.target.value)} required>
              <option value="">Select category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </Select>
          </div>
          <Textarea id="description" name="description" label="Description" error={fieldErrors.description} className="resize-none" maxLength={4000} value={form.description} onChange={(e) => setField("description", e.target.value)} />
        </Card>
        <Card className="lg:col-span-4 p-space-xl flex flex-col gap-space-md">
          <h2 className="font-headline-sm text-headline-sm">Pricing and stock</h2>
          <Input id="price" name="price" label="Unit price" error={fieldErrors.price} type="number" min="0" step="0.01" value={form.price} onChange={(e) => setField("price", e.target.value)} required />
          <Input id="quantity" name="quantity" label={isEdit ? "Stock when form opened" : "Initial quantity"} error={fieldErrors.quantity} hint={isEdit ? "Reference only. Product edits do not change inventory." : "Opening stock for this new product."} readOnly={isEdit} type="number" min="0" max="2147483647" step="1" value={form.quantity} onChange={(e) => setField("quantity", e.target.value)} required={!isEdit} />
          {isEdit ? <p className="font-caption text-on-surface-variant"><Link className="text-secondary underline underline-offset-2" to={role === "ADMIN" ? "/admin/inventory" : "/supplier/stock"}>Record a stock adjustment</Link> to receive or issue units with an audit reason.</p> : null}
          <Input id="lowStockThreshold" name="lowStockThreshold" label="Low-stock threshold" error={fieldErrors.lowStockThreshold} hint="Flag this product when stock reaches this quantity or lower." type="number" min="0" max="2147483647" step="1" value={form.lowStockThreshold} onChange={(e) => setField("lowStockThreshold", e.target.value)} required />
          {role === "ADMIN" ? (
            <Select id="supplierId" name="supplierId" label="Supplier" error={fieldErrors.supplierId} value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} required>
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
          <Button type="submit" loading={saving} disabled={role === "SUPPLIER" && !supplier?.id}>{isEdit ? "Save changes" : "Create product"}</Button>
        </Card>
      </fieldset>
      </form>
    </>
  );
}
