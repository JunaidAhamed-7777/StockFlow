import { useEffect, useState } from "react";
import { listProducts } from "../../services/product.service";
import { getLowStock } from "../../services/stock.service";
import { getCategories, getSuppliers } from "../../services/discovery.service";
import { getErrorMessage } from "../../utils/errors";
import { enrichProducts, formatCurrency, stockStatus } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardHeader } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { StatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";
import { StockAdjustModal } from "../../components/StockAdjustModal";
import { StatCard } from "../../components/ui/StatCard";

export function AdminInventory() {
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [rows, low, cats, sups] = await Promise.all([listProducts(), getLowStock(), getCategories(), getSuppliers()]);
      setProducts(enrichProducts(rows || [], cats || [], sups || []));
      setLowStock(low || []);
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

  const totalUnits = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Operations</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Multi-node stock</span></>}
        title="Inventory management"
        description="Review stock availability and record adjustments with a traceable reason."
      />
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-space-base">
        <StatCard label="Tracked SKUs" value={products.length} icon="inventory_2" />
        <StatCard label="Units on hand" value={totalUnits} icon="warehouse" />
        <StatCard label="Low-stock SKUs" value={lowStock.length} icon="warning" tone="danger" />
      </section>
      <Card>
        <CardHeader title="Low-stock exceptions" />
        <Table
          rows={lowStock}
          empty={<EmptyState icon="verified" title="No low-stock items" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
            { key: "quantity", header: "Qty", align: "right" },
            { key: "lowStockThreshold", header: "Threshold", align: "right" },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            { key: "actions", header: "", render: (row) => <Button onClick={() => setAdjusting(row)}>Adjust</Button> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Full stock ledger" />
        <Table
          rows={products}
          empty={<EmptyState icon="inventory_2" title="No products found" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
            { key: "supplier", header: "Supplier", render: (row) => row.supplier?.companyName || "—" },
            { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
            { key: "quantity", header: "On hand", align: "right" },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" onClick={() => setAdjusting(row)}>Adjust stock</Button> },
          ]}
        />
      </Card>
      <StockAdjustModal product={adjusting} open={Boolean(adjusting)} onClose={() => setAdjusting(null)} onAdjusted={load} />
    </>
  );
}
