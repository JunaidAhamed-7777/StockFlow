import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { deleteProduct, listProducts } from "../../services/product.service";
import { getCategories, getSuppliers } from "../../services/discovery.service";
import { getErrorMessage } from "../../utils/errors";
import { enrichProducts, formatCurrency, stockStatus } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { Select } from "../../components/ui/Input";
import { StatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { ConfirmModal } from "../../components/ui/Modal";
import { Icon } from "../../components/ui/Icon";

export function AdminProducts() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialSearch = new URLSearchParams(location.search).get("search") || "";
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const requestId = useRef(0);

  async function load(searchOverride) {
    const activeRequest = ++requestId.current;
    const searchValue = (typeof searchOverride === "string" ? searchOverride : search).trim();
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (searchValue) params.search = searchValue;
      if (category) params.category = category;
      if (supplier) params.supplier = supplier;
      const [rows, cats, sups] = await Promise.all([listProducts(params), getCategories(), getSuppliers()]);
      if (activeRequest !== requestId.current) return;
      setCategories(cats || []);
      setSuppliers(sups || []);
      const catalog = enrichProducts(rows || [], cats || [], sups || []);
      setProducts(lowStock ? catalog.filter((item) => stockStatus(item) !== "IN") : catalog);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    const next = new URLSearchParams(location.search).get("search") || "";
    setSearch(next);
    load(next);
    return () => { requestId.current += 1; };
  }, [location.search]);

  const columns = useMemo(
    () => [
      { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
      { key: "name", header: "Product" },
      { key: "category", header: "Category", render: (row) => row.category?.name || "—" },
      { key: "supplier", header: "Supplier", render: (row) => row.supplier?.companyName || "—" },
      { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
      { key: "quantity", header: "Qty", align: "right", render: (row) => <span className="tabular">{row.quantity}</span> },
      { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
      {
        key: "actions",
        header: "",
        render: (row) => (
          <div className="flex justify-end gap-space-xs">
            <Button variant="outline" onClick={() => navigate(`/admin/products/${row.id}/edit`)}>Edit</Button>
            <Button variant="danger" onClick={() => setPendingDelete(row)}>Delete</Button>
          </div>
        ),
      },
    ],
    [navigate]
  );

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteProduct(pendingDelete.id);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Inventory</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">SKU Catalog</span></>}
        title="Product catalog"
        description="Manage products, supplier ownership, pricing, and stock availability."
        actions={<Button variant="dark" onClick={() => navigate("/admin/products/new")} icon={<Icon name="add" size={16} />}>Add Product</Button>}
      />
      <Card className="p-space-base">
      <form onSubmit={(event) => { event.preventDefault(); load(); }} className="flex flex-col xl:flex-row gap-space-sm xl:items-center" aria-label="Filter inventory catalog">
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name, SKU, description" />
        <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select aria-label="Filter by supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}
        </Select>
        <label className="flex items-center gap-space-xs font-label-sm whitespace-nowrap">
          <input type="checkbox" checked={lowStock} onChange={(e) => setLowStock(e.target.checked)} className="accent-secondary" />
          Low stock
        </label>
        <Button type="submit" disabled={loading}>Apply filters</Button>
      </form>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {loading ? <PageSkeleton /> : !error && (
        <Card>
          <Table rows={products} columns={columns} empty={<EmptyState icon="inventory_2" title="No products found" description="Adjust filters or create a new SKU." actionLabel="Add Product" onAction={() => navigate("/admin/products/new")} />} />
        </Card>
      )}
      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete product"
        message={`Delete ${pendingDelete?.name}? This is only allowed if the SKU is not referenced by orders or stock history.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
      />
    </>
  );
}
