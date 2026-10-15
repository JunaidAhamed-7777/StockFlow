import { useEffect, useState } from "react";
import { getSuppliers } from "../../services/discovery.service";
import { listProducts } from "../../services/product.service";
import { getErrorMessage } from "../../utils/errors";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";

export function AdminSuppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [rows, catalog] = await Promise.all([getSuppliers(), listProducts()]);
      setSuppliers(rows || []);
      setProducts(catalog || []);
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

  const filtered = suppliers.filter((item) => `${item.companyName} ${item.user?.name || ""} ${item.user?.email || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Procurement</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Suppliers</span></>}
        title="Supplier network"
        description="Find your suppliers, review their contact details, and see catalog coverage."
      />
      <Card className="p-space-base"><ToolbarSearch value={search} onChange={setSearch} placeholder="Search company, contact, or email" /></Card>
      <Card>
        <Table
          rows={filtered}
          empty={<EmptyState icon="local_shipping" title="No suppliers found" description={search ? "Try a different company name or email." : "Suppliers appear here after registration."} />}
          columns={[
            { key: "companyName", header: "Company" },
            { key: "contactNumber", header: "Contact", render: (row) => row.contactNumber || "—" },
            { key: "address", header: "Address", render: (row) => row.address || "—" },
            { key: "user", header: "Account", render: (row) => row.user?.email || "—" },
            { key: "skus", header: "SKUs", align: "right", render: (row) => products.filter((item) => item.supplierId === row.id).length },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View ${row.companyName}`} onClick={() => setSelected(row)}>View</Button> },
          ]}
        />
      </Card>
      <Modal open={Boolean(selected)} title={selected?.companyName || "Supplier"} onClose={() => setSelected(null)}>
        {selected ? (
          <dl className="space-y-space-sm font-body-sm">
            <div className="flex justify-between"><dt className="text-on-surface-variant">Supplier ID</dt><dd className="font-mono-data">{selected.id}</dd></div>
            <div className="flex justify-between"><dt className="text-on-surface-variant">Contact</dt><dd>{selected.contactNumber}</dd></div>
            <div className="flex flex-col sm:flex-row sm:justify-between gap-space-sm"><dt className="text-on-surface-variant">Address</dt><dd className="break-words sm:text-right">{selected.address || "—"}</dd></div>
            <div className="flex flex-col sm:flex-row sm:justify-between gap-space-sm"><dt className="text-on-surface-variant">Linked user</dt><dd className="break-words sm:text-right">{selected.user?.name} · {selected.user?.email}</dd></div>
          </dl>
        ) : null}
      </Modal>
    </>
  );
}
