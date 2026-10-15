import { useEffect, useMemo, useRef, useState } from "react";
import { useListFilters, usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
import { Button } from "../../components/ui/Button";
import { listOrders } from "../../services/order.service";
import { getDashboard } from "../../services/dashboard.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatDate } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { StatCard } from "../../components/ui/StatCard";

export function AdminCustomers() {
  const [orders, setOrders] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { filters, setFilters } = useListFilters({ search: "" });
  const [search, setSearch] = useState(filters.search);
  const requestId = useRef(0);
  useEffect(() => { setSearch(filters.search); }, [filters.search]);

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [dash, rows] = await Promise.all([getDashboard(), listOrders()]);
      if (activeRequest !== requestId.current) return;
      setMetrics(dash.metrics);
      setOrders(rows || []);
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

  const customers = useMemo(() => {
    const map = new Map();
    for (const order of orders) {
      const customer = order.customer;
      if (!customer?.id) continue;
      const current = map.get(customer.id) || {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        orderCount: 0,
        spend: 0,
        lastOrderAt: null,
      };
      current.orderCount += 1;
      current.spend += Number(order.totalAmount || 0);
      if (!current.lastOrderAt || new Date(order.createdAt) > new Date(current.lastOrderAt)) {
        current.lastOrderAt = order.createdAt;
      }
      map.set(customer.id, current);
    }
    return Array.from(map.values());
  }, [orders]);
  const filtered = customers.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(filters.search.toLowerCase()));
  const pagination = usePaginatedRows(filtered, { ready: !loading && !error });

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Customers with purchase history appear below. The registered count includes customers who have not placed an order."
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-space-base">
        <StatCard label="Registered customers" value={metrics?.totalCustomers ?? 0} hint="All registered customer accounts" icon="groups" />
        <StatCard label="Customers with orders" value={customers.length} hint="Customers with recorded purchases" icon="receipt_long" />
      </section>
      <Card className="p-space-base">
        <form className="flex flex-col sm:flex-row gap-space-sm" aria-label="Search customers" onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }}>
          <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Search name or email" label="Search customers" />
          <Button type="submit">Search</Button>
        </form>
      </Card>
      <Card>
        <Table
          rows={pagination.rows}
          caption="Customers with recorded orders"
          empty={<EmptyState icon="groups" title={filters.search ? "No matching customers" : "No customers with recorded orders"} description={filters.search ? "Try another name or email." : "Customer details appear here after their first order."} />}
          columns={[
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            { key: "orderCount", header: "Orders", align: "right" },
            { key: "spend", header: "Spend", align: "right", render: (row) => formatCurrency(row.spend) },
            { key: "lastOrderAt", header: "Last order", render: (row) => formatDate(row.lastOrderAt) },
          ]}
        />
        <Pagination {...pagination} onPageChange={pagination.setPage} label="Customers" />
      </Card>
    </>
  );
}
