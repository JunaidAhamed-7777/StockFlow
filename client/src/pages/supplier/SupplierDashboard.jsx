import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getDashboard } from "../../services/dashboard.service";
import { listProducts } from "../../services/product.service";
import { getLowStock } from "../../services/stock.service";
import { listOrders } from "../../services/order.service";
import { getErrorMessage } from "../../utils/errors";
import { formatNumber, stockStatus } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatCard } from "../../components/ui/StatCard";
import { Card, CardHeader } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { StatusBadge, OrderStatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";

export function SupplierDashboard() {
  const { supplier } = useAuth();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supplier?.id) {
      setMetrics(null);
      setProducts([]);
      setLowStock([]);
      setOrders([]);
      setLoading(false);
      setError("No supplier profile is linked to this account. Catalog and stock requests are blocked until a supplier record exists.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [dash, catalog, stock, orderRows] = await Promise.all([
        getDashboard(),
        listProducts({ supplier: supplier.id }),
        getLowStock(),
        listOrders(),
      ]);
      setMetrics(dash.metrics);
      setProducts((catalog || []).slice(0, 8));
      setLowStock(stock || []);
      setOrders((orderRows || []).slice(0, 8));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [supplier?.id]);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Supplier Portal</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Inbound Hub</span></>}
        title={`${supplier?.companyName || "Supplier"} operations`}
        description="Keep your catalog healthy, replenish low stock, and review customer orders."
        actions={<Button variant="dark" onClick={() => navigate("/supplier/products/new")}>Add product</Button>}
      />
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-space-base">
        <StatCard label="Your SKUs" value={formatNumber(metrics?.productCount)} icon="inventory_2" />
        <StatCard label="Units on hand" value={formatNumber(metrics?.stock)} icon="warehouse" />
        <StatCard label="Low-stock SKUs" value={formatNumber(metrics?.lowStock)} icon="warning" tone="danger" />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        <Card>
          <CardHeader title="Low-stock buffers" action={<Button variant="outline" onClick={() => navigate("/supplier/stock")}>Manage</Button>} />
          <Table
            rows={lowStock}
            empty={<EmptyState icon="verified" title="No low-stock items" />}
            columns={[
              { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
              { key: "name", header: "Product" },
              { key: "quantity", header: "Qty", align: "right" },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Inbound orders" action={<Button variant="outline" onClick={() => navigate("/supplier/orders")}>Open</Button>} />
          <Table
            rows={orders}
            empty={<EmptyState icon="local_shipping" title="No supplier orders" />}
            columns={[
              { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
              { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
              { key: "items", header: "Lines", align: "right", render: (row) => row.orderItems?.length || 0 },
            ]}
          />
        </Card>
      </section>
      <Card>
        <CardHeader title="Your catalog" action={<Button variant="outline" onClick={() => navigate("/supplier/products")}>All products</Button>} />
        <Table
          rows={products}
          empty={<EmptyState icon="inventory_2" title="No products yet" actionLabel="Create product" onAction={() => navigate("/supplier/products/new")} />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Name" },
            { key: "quantity", header: "Qty", align: "right" },
          ]}
        />
      </Card>
    </>
  );
}
