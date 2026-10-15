import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useListFilters, usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
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
  const returnTo = location.pathname + location.search;
  const { filters, setFilters } = useListFilters({ search: "", category: "", supplier: "", lowStock: "" });
  const [search, setSearch] = useState(filters.search);
  const [category, setCategory] = useState(filters.category);
  const [supplier, setSupplier] = useState(filters.supplier);
  const [lowStock, setLowStock] = useState(filters.lowStock === "1");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [message, setMessage] = useState("");
  const [loadedFilterKey, setLoadedFilterKey] = useState("");
  const requestId = useRef(0);
  const filterKey = JSON.stringify(filters);
  const pagination = usePaginatedRows(products, { ready: !loading && !error && loadedFilterKey === filterKey });

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (filters.search) params.search = filters.search;
      if (filters.category) params.category = filters.category;
      if (filters.supplier) params.supplier = filters.supplier;
      const [rows, cats, sups] = await Promise.all([listProducts(params), getCategories(), getSuppliers()]);
      if (activeRequest !== requestId.current) return;
      setCategories(cats || []);
      setSuppliers(sups || []);
      const catalog = enrichProducts(rows || [], cats || [], sups || []);
      setProducts(filters.lowStock === "1" ? catalog.filter((item) => stockStatus(item) !== "IN") : catalog);
      setLoadedFilterKey(filterKey);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSearch(filters.search);
    setCategory(filters.category);
    setSupplier(filters.supplier);
    setLowStock(filters.lowStock === "1");
    load();
    return () => { requestId.current += 1; };
  }, [filters.search, filters.category, filters.supplier, filters.lowStock]);

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
            <Button variant="outline" aria-label={`Edit ${row.name}`} onClick={() => navigate(`/admin/products/${row.id}/edit`, { state: { returnTo } })}>Edit</Button>
            <Button variant="danger" aria-label={`Delete ${row.name}`} onClick={() => { setDeleteError(""); setPendingDelete(row); }}>Delete</Button>
          </div>
        ),
      },
    ],
    [navigate, returnTo]
  );

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteProduct(pendingDelete.id);
      setPendingDelete(null);
      setMessage("Product deleted.");
      await load();
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Manage products, supplier ownership, pricing, and stock availability."
        actions={<Button variant="dark" onClick={() => navigate("/admin/products/new", { state: { returnTo } })} icon={<Icon name="add" size={16} />}>Create product</Button>}
      />
      <Card className="p-space-base">
      <form noValidate onSubmit={(event) => { event.preventDefault(); setFilters({ search, category, supplier, lowStock: lowStock ? "1" : "" }); }} className="flex flex-col xl:flex-row gap-space-sm xl:items-center" aria-label="Filter products">
        <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Search name, SKU, description" label="Search products" />
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
      {message ? <p role="status" className="text-sm text-secondary">{message}</p> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {loading ? <PageSkeleton /> : !error && (
        <Card>
          <Table rows={pagination.rows} columns={columns} caption="Products" empty={<EmptyState icon="inventory_2" title="No products found" description="Adjust filters or create a product." actionLabel="Create product" onAction={() => navigate("/admin/products/new", { state: { returnTo } })} />} />
          <Pagination {...pagination} onPageChange={pagination.setPage} label="Products" />
        </Card>
      )}
      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete product"
        message={<><span>Delete {pendingDelete?.name}? This permanently removes the product if it has no orders or stock history.</span>{deleteError ? <span className="block mt-space-md text-error" role="alert">{deleteError}</span> : null}</>}
        confirmLabel={deleteError ? "Retry delete" : "Delete product"}
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => { if (!deleting) { setPendingDelete(null); setDeleteError(""); } }}
      />
    </>
  );
}
