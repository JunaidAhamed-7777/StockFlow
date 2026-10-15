import { useEffect, useRef, useState } from "react";
import { useListFilters, usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
import { useNavigate } from "react-router-dom";
import { listOrders } from "../../services/order.service";
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
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { filters, setFilters } = useListFilters({ search: "", status: "" });
  const [search, setSearch] = useState(filters.search);
  const requestId = useRef(0);
  const filtered = orders.filter((order) => (!filters.status || order.status === filters.status) && (!filters.search || String(order.id).includes(filters.search.replace(/^#/, ""))));
  const pagination = usePaginatedRows(filtered, { ready: !loading && !error });
  useEffect(() => { setSearch(filters.search); }, [filters.search]);

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const rows = await listOrders();
      if (activeRequest === requestId.current) setOrders(rows);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, []);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Orders"
        description="Review your purchase history and the latest fulfillment status."
      />
      <Card className="p-space-base">
        <form className="flex flex-col sm:flex-row gap-space-sm" aria-label="Filter your orders" onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }}>
          <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Find an order number" label="Search orders" />
          <Select value={filters.status} aria-label="Filter orders by status" onChange={(event) => setFilters({ status: event.target.value })}>
            <option value="">All statuses</option>
            {["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((item) => <option key={item} value={item}>{item.charAt(0) + item.slice(1).toLowerCase()}</option>)}
          </Select>
          <Button type="submit">Search</Button>
        </form>
      </Card>
      <Card>
        <Table
          rows={pagination.rows}
          caption="Your orders"
          empty={<EmptyState icon="receipt_long" title={orders.length ? "No matching orders" : "No orders yet"} description={orders.length ? "Try another order number or status." : "Your completed checkouts will appear here."} actionLabel={orders.length ? "Clear filters" : "Browse catalog"} onAction={() => orders.length ? setFilters({ search: "", status: "" }) : navigate("/customer/products")} />}
          columns={[
            { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
            { key: "createdAt", header: "Placed", render: (row) => formatDate(row.createdAt) },
            { key: "items", header: "Lines", align: "right", render: (row) => row.orderItems?.length || 0 },
            { key: "totalAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.totalAmount) },
            { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View order ${row.id}`} onClick={(event) => { event.stopPropagation(); navigate(`/customer/orders/${row.id}`); }}>View order</Button> },
          ]}
        />
        <Pagination {...pagination} onPageChange={pagination.setPage} label="Orders" />
      </Card>
    </>
  );
}
