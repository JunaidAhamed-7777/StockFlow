import { useEffect, useRef, useState } from "react";
import { useListFilters } from "../../hooks/useListState";
import { useRemotePagination } from "../../hooks/useRemotePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useLocation, useNavigate } from "react-router-dom";
import { listOrderPage } from "../../services/order.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatDate } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Input";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { OrderStatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";

export function CustomerOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const [orderPage, setOrderPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { filters, setFilters } = useListFilters({ search: "", status: "" });
  const [search, setSearch] = useState(filters.search);
  const [loadedRequestKey, setLoadedRequestKey] = useState("");
  const requestId = useRef(0);
  const requestController = useRef(null);
  const pagination = useRemotePagination(orderPage, { filters, loadedRequestKey, ready: !loading && !error });
  const { requestedPage, requestKey } = pagination;
  const busy = loading || (!error && !pagination.ready);
  const hasFilters = Boolean(filters.search || filters.status);
  useEffect(() => { setSearch(filters.search); }, [filters.search]);

  async function load() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await listOrderPage({ page: requestedPage, pageSize: 20, search: filters.search || undefined, status: filters.status || undefined }, { signal: controller.signal });
      if (activeRequest !== requestId.current || controller.signal.aborted) return;
      setOrderPage(result);
      setLoadedRequestKey(requestKey);
    } catch (err) {
      if (activeRequest === requestId.current && !controller.signal.aborted) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { requestId.current += 1; requestController.current?.abort(); };
  }, [requestKey]);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Review your purchase history and the latest fulfillment status."
      />
      <Card className="p-space-base">
        <form noValidate className="flex flex-col sm:flex-row gap-space-sm" aria-label="Filter your orders" onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }}>
          <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Find an order number" label="Search orders" />
          <Select value={filters.status} aria-label="Filter orders by status" onChange={(event) => setFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            {["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((item) => <option key={item} value={item}>{item.charAt(0) + item.slice(1).toLowerCase()}</option>)}
          </Select>
          <Button type="submit" disabled={busy}>Search</Button>
        </form>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {busy ? <PageSkeleton /> : !error && <Card>
        <Table
          rows={pagination.rows}
          caption="Your orders"
          empty={<EmptyState icon="receipt_long" title={hasFilters ? "No matching orders" : "No orders yet"} description={hasFilters ? "Try another order number or status." : "Your completed checkouts will appear here."} actionLabel={hasFilters ? "Clear filters" : "Browse catalog"} onAction={() => hasFilters ? setFilters({ search: "", status: "" }) : navigate("/customer/products")} />}
          columns={[
            { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
            { key: "createdAt", header: "Placed", render: (row) => formatDate(row.createdAt) },
            { key: "visibleLineCount", header: "Lines", align: "right" },
            { key: "visibleAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.visibleAmount) },
            { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View order ${row.id}`} onClick={() => navigate(`/customer/orders/${row.id}`, { state: { returnTo } })}>View order</Button> },
          ]}
        />
        <Pagination {...pagination} onPageChange={pagination.setPage} label="Orders" />
      </Card>}
    </>
  );
}
