import { useEffect, useRef, useState } from "react";
import { useListFilters, usePaginatedRows } from "../../hooks/useListState";
import { Pagination } from "../../components/ui/Pagination";
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
  const { filters, setFilters } = useListFilters({ search: "" });
  const [search, setSearch] = useState(filters.search);
  const requestId = useRef(0);
  const filtered = suppliers.filter((item) => `${item.companyName} ${item.user?.name || ""} ${item.user?.email || ""}`.toLowerCase().includes(filters.search.toLowerCase()));
  const pagination = usePaginatedRows(filtered, { ready: !loading && !error });
  useEffect(() => { setSearch(filters.search); }, [filters.search]);

  async function load() {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [rows, catalog] = await Promise.all([getSuppliers(), listProducts()]);
      if (activeRequest !== requestId.current) return;
      setSuppliers(rows || []);
      setProducts(catalog || []);
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
        title="Suppliers"
        description="Find your suppliers, review their contact details, and see catalog coverage."
      />
      <Card className="p-space-base">
        <form className="flex flex-col sm:flex-row gap-space-sm" aria-label="Search suppliers" onSubmit={(event) => { event.preventDefault(); setFilters({ search }); }}>
          <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "" })} placeholder="Search company, contact, or email" label="Search suppliers" />
          <Button type="submit">Search</Button>
        </form>
      </Card>
      <Card>
        <Table
          rows={pagination.rows}
          caption="Suppliers"
          empty={<EmptyState icon="local_shipping" title="No suppliers found" description={filters.search ? "Try a different company name or email." : "Suppliers appear here after registration."} />}
          columns={[
            { key: "companyName", header: "Company" },
            { key: "contactNumber", header: "Contact", render: (row) => row.contactNumber || "—" },
            { key: "address", header: "Address", render: (row) => row.address || "—" },
            { key: "user", header: "Account", render: (row) => row.user?.email || "—" },
            { key: "skus", header: "SKUs", align: "right", render: (row) => products.filter((item) => item.supplierId === row.id).length },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View ${row.companyName}`} onClick={() => setSelected(row)}>View</Button> },
          ]}
        />
        <Pagination {...pagination} onPageChange={pagination.setPage} label="Suppliers" />
      </Card>
      <Modal open={Boolean(selected)} title={selected?.companyName || "Supplier"} onClose={() => setSelected(null)} footer={<Button variant="outline" onClick={() => setSelected(null)}>Close</Button>}>
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
