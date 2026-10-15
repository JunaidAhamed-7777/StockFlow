import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { listProducts } from "../../services/product.service";
import { getLowStock } from "../../services/stock.service";
import { getErrorMessage } from "../../utils/errors";
import { stockStatus } from "../../utils/format";
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

export function SupplierStock() {
  const { supplier } = useAuth();
  const [products, setProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(null);

  async function load() {
    if (!supplier?.id) {
      setProducts([]);
      setLowStock([]);
      setLoading(false);
      setError("No supplier profile is linked to this account, so stock cannot be scoped to your SKUs.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [rows, low] = await Promise.all([
        listProducts({ supplier: supplier.id }),
        getLowStock(),
      ]);
      setProducts(rows || []);
      setLowStock(low || []);
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
        breadcrumb={<><span>Inventory</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Allocations</span></>}
        title="Your inventory"
        description="Review availability and record stock received or issued with a reason for each change."
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-space-base">
        <StatCard label="Owned SKUs" value={products.length} icon="inventory_2" />
        <StatCard label="Low-stock SKUs" value={lowStock.length} icon="warning" tone="danger" />
      </section>
      <Card>
        <CardHeader title="Low-stock products" />
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
        <CardHeader title="Current stock" />
        <Table
          rows={products}
          empty={<EmptyState icon="inventory_2" title="No products found" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
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
