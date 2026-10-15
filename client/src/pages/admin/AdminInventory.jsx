import { useEffect, useRef, useState } from "react";
import { usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
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
  const requestId = useRef(0);
  const stockPage = usePaginatedRows(products, { ready: !loading && !error });
  const lowStockPage = usePaginatedRows(lowStock, { pageKey: "lowPage", ready: !loading && !error });

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [rows, low, cats, sups] = await Promise.all([listProducts(), getLowStock(), getCategories(), getSuppliers()]);
      if (activeRequest !== requestId.current) return;
      setProducts(enrichProducts(rows || [], cats || [], sups || []));
      setLowStock(low || []);
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

  const totalUnits = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Review stock availability and record adjustments with a traceable reason."
      />
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-space-base">
        <StatCard label="Products" value={products.length} icon="inventory_2" />
        <StatCard label="Units on hand" value={totalUnits} icon="warehouse" />
        <StatCard label="Low-stock products" value={lowStock.length} icon="warning" tone="danger" />
      </section>
      <Card>
        <CardHeader title="Low-stock products" />
        <Table
          rows={lowStockPage.rows}
          caption="Low-stock products"
          empty={<EmptyState icon="verified" title="No low-stock items" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
            { key: "quantity", header: "Qty", align: "right" },
            { key: "lowStockThreshold", header: "Threshold", align: "right" },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            { key: "actions", header: "", render: (row) => <Button aria-label={`Adjust stock for ${row.name}`} onClick={() => setAdjusting(row)}>Adjust stock</Button> },
          ]}
        />
        <Pagination {...lowStockPage} onPageChange={lowStockPage.setPage} label="Low-stock products" />
      </Card>
      <Card>
        <CardHeader title="All inventory" />
        <Table
          rows={stockPage.rows}
          caption="All inventory"
          empty={<EmptyState icon="inventory_2" title="No products found" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
            { key: "supplier", header: "Supplier", render: (row) => row.supplier?.companyName || "—" },
            { key: "price", header: "Price", align: "right", render: (row) => formatCurrency(row.price) },
            { key: "quantity", header: "On hand", align: "right" },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={stockStatus(row)} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`Adjust stock for ${row.name}`} onClick={() => setAdjusting(row)}>Adjust stock</Button> },
          ]}
        />
        <Pagination {...stockPage} onPageChange={stockPage.setPage} label="Products" />
      </Card>
      <StockAdjustModal product={adjusting} open={Boolean(adjusting)} onClose={() => setAdjusting(null)} onAdjusted={load} />
    </>
  );
}
