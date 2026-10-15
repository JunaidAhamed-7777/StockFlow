import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../../services/dashboard.service";
import { listOrderPage } from "../../services/order.service";
import { listProductPage } from "../../services/product.service";
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
  const requestId = useRef(0);

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [dash, stock, orderRows, productRows] = await Promise.all([
        getDashboard(),
        listProductPage({ page: 1, pageSize: 8, stock: "low" }),
        listOrderPage({ page: 1, pageSize: 8 }),
        listProductPage({ page: 1, pageSize: 8 }),
      ]);
      if (activeRequest !== requestId.current) return;
      setMetrics({ ...dash.metrics, totalProducts: productRows.summary.productCount,
        totalStock: productRows.summary.totalQuantity, lowStockCount: productRows.summary.lowStockCount,
        totalOrders: orderRows.summary.orderCount, pendingOrders: orderRows.summary.statusCounts.PENDING });
      setLowStock(stock.rows);
      setOrders(orderRows.rows);
      setProducts(productRows.rows);
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
        title="Overview"
        description="Monitor stock availability, review recent orders, and act on inventory exceptions."
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/admin/inventory")}>View inventory</Button>
            <Button variant="dark" onClick={() => navigate("/admin/products")}>Open catalog</Button>
          </>
        }
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-base">
        <StatCard label="Products" value={formatNumber(metrics?.totalProducts)} icon="inventory_2" hint={`${formatNumber(metrics?.totalStock)} units on hand`} />
        <StatCard label="Low-stock products" value={formatNumber(metrics?.lowStockCount)} icon="warning" tone="danger" hint="Products at or below their reorder threshold" />
        <StatCard label="Orders" value={formatNumber(metrics?.totalOrders)} icon="receipt_long" hint={`${formatNumber(metrics?.pendingOrders)} pending`} />
        <StatCard label="Customers" value={formatNumber(metrics?.totalCustomers)} icon="groups" hint={`${formatNumber(metrics?.totalSuppliers)} suppliers`} />
      </section>
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        <Card className="lg:col-span-7">
          <CardHeader title="Low-stock products" action={<Button variant="outline" onClick={() => navigate("/admin/inventory")}>View inventory</Button>} />
          <Table
            rows={lowStock}
            caption="Low-stock products, up to eight shown"
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
          <CardHeader title="Recent orders" action={<Button variant="outline" onClick={() => navigate("/admin/orders")}>View orders</Button>} />
          <Table
            rows={orders}
            caption="Recent orders, up to eight shown"
            empty={<EmptyState icon="shopping_cart" title="No orders yet" />}
            onRowClick={(row) => navigate(`/admin/orders?search=${row.id}`)}
            columns={[
              { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
              { key: "visibleAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.visibleAmount) },
              { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            ]}
          />
        </Card>
      </section>
      <Card>
        <CardHeader title="Products" action={<Button variant="outline" onClick={() => navigate("/admin/products")}>View products</Button>} />
        <Table
          rows={products}
          caption="Product overview, up to eight shown"
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
