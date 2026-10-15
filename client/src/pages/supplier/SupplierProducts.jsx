import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useListFilters } from "../../hooks/useListState";
import { useRemotePagination } from "../../hooks/useRemotePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useAuth } from "../../context/AuthContext";
import { listProductPage } from "../../services/product.service";
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
  const [productPage, setProductPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedRequestKey, setLoadedRequestKey] = useState("");
  const requestId = useRef(0);
  const requestController = useRef(null);
  const pagination = useRemotePagination(productPage, { filters: { ...filters, supplier: supplier?.id || "" }, loadedRequestKey, ready: !loading && !error });
  const { requestedPage, requestKey } = pagination;
  const busy = loading || (!error && !pagination.ready);

  async function load() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const activeRequest = ++requestId.current;
    if (!supplier?.id) {
      setProductPage(null);
      setLoading(false);
      setError("No supplier profile is linked to this account, so owned SKUs cannot be loaded.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = { page: requestedPage, pageSize: 20, supplier: supplier.id };
      if (filters.search) params.search = filters.search;
      const [result, cats] = await Promise.all([listProductPage(params, { signal: controller.signal }), getCategories()]);
      if (activeRequest !== requestId.current || controller.signal.aborted) return;
      setProductPage({ ...result, rows: enrichProducts(result.rows, cats || [], [supplier]) });
      setLoadedRequestKey(requestKey);
    } catch (err) {
      if (activeRequest === requestId.current && !controller.signal.aborted) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    setSearch(filters.search);
  }, [filters.search]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; requestController.current?.abort(); };
  }, [requestKey]);

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
      <form noValidate onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }} className="flex flex-col sm:flex-row gap-space-sm" aria-label="Search your products">
        <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Search name or SKU" label="Search products" />
        <Button type="submit" disabled={busy}>Search</Button>
      </form>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {busy ? <PageSkeleton /> : !error && (
        <Card>
          <Table rows={pagination.rows} columns={columns} caption="Your products" empty={<EmptyState icon="inventory_2" title="No products found" description="Try another search or create your first product." actionLabel="Create product" onAction={() => navigate("/supplier/products/new", { state: { returnTo } })} />} />
          <Pagination {...pagination} onPageChange={pagination.setPage} label="Products" />
        </Card>
      )}
    </>
  );
}
