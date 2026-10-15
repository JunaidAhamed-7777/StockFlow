import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useListFilters, usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
import { useAuth } from "../../context/AuthContext";
import { listProducts } from "../../services/product.service";
import { getCategories } from "../../services/discovery.service";
import { getErrorMessage } from "../../utils/errors";
import { enrichProducts, formatCurrency, stockStatus } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { StatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Icon } from "../../components/ui/Icon";

export function SupplierProducts() {
  const { supplier } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const { filters, setFilters } = useListFilters({ search: "" });
  const [search, setSearch] = useState(filters.search);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedFilterKey, setLoadedFilterKey] = useState("");
  const requestId = useRef(0);
  const filterKey = `${supplier?.id || ""}:${filters.search}`;
  const pagination = usePaginatedRows(products, { ready: !loading && !error && loadedFilterKey === filterKey });

  async function load() {
    const activeRequest = ++requestId.current;
    if (!supplier?.id) {
      setProducts([]);
      setLoading(false);
      setError("No supplier profile is linked to this account, so owned SKUs cannot be loaded.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = { supplier: supplier.id };
      if (filters.search) params.search = filters.search;
      const [rows, cats] = await Promise.all([listProducts(params), getCategories()]);
      if (activeRequest !== requestId.current) return;
      setProducts(enrichProducts(rows || [], cats || [], [supplier]));
      setLoadedFilterKey(filterKey);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSearch(filters.search);
    load();
    return () => { requestId.current += 1; };
  }, [supplier?.id, filters.search]);

  const columns = useMemo(
    () => [
      { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
      { key: "name", header: "Product" },
      { key: "category", header: "Category", render: (row) => row.category?.name || "—" },
      { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
      { key: "quantity", header: "Qty", align: "right" },
      { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
      { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`Edit ${row.name}`} onClick={() => navigate(`/supplier/products/${row.id}/edit`, { state: { returnTo } })}>Edit</Button> },
    ],
    [navigate, returnTo]
  );

  return (
    <>
      <PageHeader
        title="Products"
        description="Manage the products and stock supplied by your company."
        actions={<Button variant="dark" onClick={() => navigate("/supplier/products/new", { state: { returnTo } })} icon={<Icon name="add" size={16} />}>Create product</Button>}
      />
      <Card className="p-space-base">
      <form onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }} className="flex flex-col sm:flex-row gap-space-sm" aria-label="Search your products">
        <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Search name or SKU" label="Search products" />
        <Button type="submit" disabled={loading}>Search</Button>
      </form>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {loading ? <PageSkeleton /> : !error && (
        <Card>
          <Table rows={pagination.rows} columns={columns} caption="Your products" empty={<EmptyState icon="inventory_2" title="No products found" description="Try another search or create your first product." actionLabel="Create product" onAction={() => navigate("/supplier/products/new", { state: { returnTo } })} />} />
          <Pagination {...pagination} onPageChange={pagination.setPage} label="Products" />
        </Card>
      )}
    </>
  );
}
