import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listProductPage } from "../../services/product.service";
import { listOrderPage } from "../../services/order.service";
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
  const requestId = useRef(0);

  async function load() {
    const activeRequest = ++requestId.current;
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
      const [catalog, stock, orderRows] = await Promise.all([
        listProductPage({ page: 1, pageSize: 8, supplier: supplier.id }),
        listProductPage({ page: 1, pageSize: 8, supplier: supplier.id, stock: "low" }),
        listOrderPage({ page: 1, pageSize: 8 }),
      ]);
      if (activeRequest !== requestId.current) return;
      setMetrics(catalog.summary);
      setProducts(catalog.rows);
      setLowStock(stock.rows);
      setOrders(orderRows.rows);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [supplier?.id]);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Stock and customer orders for ${supplier?.companyName || "your company"}`}
        actions={<Button variant="dark" onClick={() => navigate("/supplier/products/new")}>Create product</Button>}
      />
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-space-base">
        <StatCard label="Products" value={formatNumber(metrics?.productCount)} icon="inventory_2" />
        <StatCard label="Units on hand" value={formatNumber(metrics?.totalQuantity)} icon="warehouse" />
        <StatCard label="Low-stock products" value={formatNumber(metrics?.lowStockCount)} icon="warning" tone="danger" />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        <Card>
          <CardHeader title="Low-stock products" action={<Button variant="outline" onClick={() => navigate("/supplier/stock")}>View inventory</Button>} />
          <Table
            rows={lowStock}
            caption="Your low-stock products, up to eight shown"
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
          <CardHeader title="Recent orders" action={<Button variant="outline" onClick={() => navigate("/supplier/orders")}>View orders</Button>} />
          <Table
            rows={orders}
            caption="Your recent supplied orders, up to eight shown"
            empty={<EmptyState icon="local_shipping" title="No supplier orders" />}
            columns={[
              { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
              { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
              { key: "visibleLineCount", header: "Your items", align: "right" },
            ]}
          />
        </Card>
      </section>
      <Card>
        <CardHeader title="Products" action={<Button variant="outline" onClick={() => navigate("/supplier/products")}>View products</Button>} />
        <Table
          rows={products}
          caption="Your product overview, up to eight shown"
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
