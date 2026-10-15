import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../../services/dashboard.service";
import { getLowStock } from "../../services/stock.service";
import { listOrders } from "../../services/order.service";
import { listProducts } from "../../services/product.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatNumber, stockStatus } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { Card, CardHeader } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { StatusBadge, OrderStatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";

export function AdminDashboard() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [dash, stock, orderRows, productRows] = await Promise.all([
        getDashboard(),
        getLowStock(),
        listOrders(),
        listProducts(),
      ]);
      setMetrics(dash.metrics);
      setLowStock(stock || []);
      setOrders((orderRows || []).slice(0, 8));
      setProducts((productRows || []).slice(0, 8));
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
        breadcrumb={
          <>
            <span>Admin Console</span>
            <span className="text-outline-variant">/</span>
            <span className="text-secondary font-medium">Executive Command Center</span>
          </>
        }
        title="Operations overview"
        description="Monitor stock availability, review recent orders, and act on inventory exceptions."
        badge={
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-on-surface text-label-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-secondary" />
            Inventory overview
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/admin/inventory")}>Stock Control</Button>
            <Button variant="dark" onClick={() => navigate("/admin/products")}>Open catalog</Button>
          </>
        }
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-base">
        <StatCard label="Total Products" value={formatNumber(metrics?.totalProducts)} icon="inventory_2" hint={`${formatNumber(metrics?.totalStock)} units on hand`} />
        <StatCard label="Low-stock products" value={formatNumber(lowStock.length)} icon="warning" tone="danger" hint="Products at or below their reorder threshold" />
        <StatCard label="Total Orders" value={formatNumber(metrics?.totalOrders)} icon="receipt_long" hint={`${formatNumber(metrics?.pendingOrders)} pending`} />
        <StatCard label="Customers" value={formatNumber(metrics?.totalCustomers)} icon="groups" hint={`${formatNumber(metrics?.totalSuppliers)} suppliers in your network`} />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-7">
          <CardHeader title="Exception queue · low stock" icon={<span className="material-symbols-outlined text-secondary">fmd_bad</span>} action={<Button variant="outline" onClick={() => navigate("/admin/inventory")}>Review all</Button>} />
          <Table
            rows={lowStock}
            empty={<EmptyState icon="inventory_2" title="No low-stock items" description="All tracked SKUs are above their thresholds." />}
            columns={[
              { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
              { key: "name", header: "Product" },
              { key: "quantity", header: "Qty", align: "right", render: (row) => <span className="tabular">{row.quantity}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            ]}
          />
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader title="Recent sales orders" action={<Button variant="outline" onClick={() => navigate("/admin/orders")}>Open ledger</Button>} />
          <Table
            rows={orders}
            empty={<EmptyState icon="shopping_cart" title="No orders yet" />}
            onRowClick={(_row) => navigate(`/admin/orders`)}
            columns={[
              { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
              { key: "totalAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.totalAmount) },
              { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            ]}
          />
        </Card>
      </section>
      <Card>
        <CardHeader title="Master SKU snapshot" action={<Button variant="outline" onClick={() => navigate("/admin/products")}>Full catalog</Button>} />
        <Table
          rows={products}
          empty={<EmptyState icon="inventory_2" title="No products found" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Name" },
            { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
            { key: "quantity", header: "Qty", align: "right" },
          ]}
        />
      </Card>
    </>
  );
}
