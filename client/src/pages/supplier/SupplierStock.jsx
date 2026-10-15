import { useEffect, useRef, useState } from "react";
import { useRemotePagination } from "../../hooks/useRemotePagination";
import { Pagination } from "../../components/ui/Pagination";
import { useAuth } from "../../context/AuthContext";
import { listProductPage } from "../../services/product.service";
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
  const [products, setProducts] = useState(null);
  const [lowStock, setLowStock] = useState(null);
  const [loadedStockKey, setLoadedStockKey] = useState("");
  const [loadedLowKey, setLoadedLowKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(null);
  const requestId = useRef(0);
  const stockPage = useRemotePagination(products, { filters: { supplier: supplier?.id }, loadedRequestKey: loadedStockKey, ready: !loading && !error });
  const lowStockPage = useRemotePagination(lowStock, { filters: { supplier: supplier?.id, stock: "low" }, pageKey: "lowPage", loadedRequestKey: loadedLowKey, ready: !loading && !error });

  async function load() {
    const activeRequest = ++requestId.current;
    if (!supplier?.id) {
      setProducts(null);
      setLowStock(null);
      setLoading(false);
      setError("No supplier profile is linked to this account, so stock cannot be scoped to your SKUs.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [rows, low] = await Promise.all([
        listProductPage({ page: stockPage.requestedPage, pageSize: 20, supplier: supplier.id }),
        listProductPage({ page: lowStockPage.requestedPage, pageSize: 20, supplier: supplier.id, stock: "low" }),
      ]);
      if (activeRequest !== requestId.current) return;
      if ([...rows.rows, ...low.rows].some((product) => Number(product.supplierId) !== Number(supplier.id))) {
        throw new Error("Inventory could not be verified for your supplier account. Try again.");
      }
      setProducts(rows);
      setLowStock(low);
      setLoadedStockKey(stockPage.requestKey);
      setLoadedLowKey(lowStockPage.requestKey);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [supplier?.id, stockPage.requestKey, lowStockPage.requestKey]);

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Review availability and record stock received or issued with a reason for each change."
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-space-base">
        <StatCard label="Products" value={products.summary.productCount} icon="inventory_2" />
        <StatCard label="Low-stock products" value={products.summary.lowStockCount} icon="warning" tone="danger" />
      </section>
      <Card>
        <CardHeader title="Low-stock products" />
        <Table
          rows={lowStockPage.rows}
          caption="Your low-stock products"
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
        <CardHeader title="Current stock" />
        <Table
          rows={stockPage.rows}
          caption="Your current inventory"
          empty={<EmptyState icon="inventory_2" title="No products found" />}
          columns={[
            { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.sku}</span> },
            { key: "name", header: "Product" },
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
