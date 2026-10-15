import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../../services/dashboard.service";
import { listOrders } from "../../services/order.service";
import { listProducts } from "../../services/product.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatNumber, stockStatus } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { Card, CardHeader } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { OrderStatusBadge, StatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";

export function CustomerDashboard() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [dash, orderRows, catalog] = await Promise.all([getDashboard(), listOrders(), listProducts()]);
      setMetrics(dash.metrics);
      setOrders((orderRows || []).slice(0, 6));
      setProducts((catalog || []).slice(0, 6));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Procurement</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Customer desk</span></>}
        title="Procurement overview"
        description="Your orders, spending, and available supplies in one place."
        actions={<Button variant="dark" onClick={() => navigate("/customer/products")}>Open catalog</Button>}
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-base">
        <StatCard label="Orders" value={formatNumber(metrics?.orderCount)} icon="receipt_long" />
        <StatCard label="Pending" value={formatNumber(metrics?.pendingOrders)} icon="hourglass_top" />
        <StatCard label="Delivered" value={formatNumber(metrics?.deliveredOrders)} icon="local_shipping" />
        <StatCard label="Total spend" value={formatCurrency(metrics?.totalSpending)} icon="payments" />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        <Card>
          <CardHeader title="Recent orders" action={<Button variant="outline" onClick={() => navigate("/customer/orders")}>All orders</Button>} />
          <Table
            rows={orders}
            empty={<EmptyState icon="receipt_long" title="No orders yet" actionLabel="Browse catalog" onAction={() => navigate("/customer/products")} />}
            onRowClick={(row) => navigate(`/customer/orders/${row.id}`)}
            columns={[
              { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
              { key: "totalAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.totalAmount) },
              { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Catalog highlights" action={<Button variant="outline" onClick={() => navigate("/customer/products")}>View all</Button>} />
          <Table
            rows={products}
            empty={<EmptyState icon="storefront" title="No products available" />}
            onRowClick={(row) => navigate(`/customer/products/${row.id}`)}
            columns={[
              { key: "name", header: "Product" },
              { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
              { key: "status", header: "Availability", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            ]}
          />
        </Card>
      </section>
    </>
  );
}
