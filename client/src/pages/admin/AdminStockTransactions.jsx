import { useEffect, useState } from "react";
import { getStockTransactions } from "../../services/stock.service";
import { getErrorMessage, isNotImplemented } from "../../utils/errors";
import { PageHeader } from "../../components/ui/PageHeader";
import { UnavailableState } from "../../components/ui/PageHeader";
import { ErrorState } from "../../components/ui/ErrorState";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { EmptyState } from "../../components/ui/EmptyState";
import { formatDate } from "../../utils/format";
import { PageSkeleton } from "../../components/ui/Loading";
import { Badge } from "../../components/ui/Badge";

export function AdminStockTransactions() {
  const [rows, setRows] = useState([]);
  const [unavailable, setUnavailable] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    setUnavailable("");
    try {
      const data = await getStockTransactions();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      if (isNotImplemented(err)) {
        setUnavailable(getErrorMessage(err));
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Governance</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Audit ledger</span></>}
        title="Stock transactions"
        description="Review the history of inventory receipts, issues, and manual adjustments when transaction history is available."
      />
      {loading ? <PageSkeleton /> : null}
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {unavailable ? (
        <UnavailableState
          title="Transaction listing unavailable"
          message="Transaction history is not available yet. Orders and stock adjustments continue to update inventory and record movements, but this workspace cannot display their history until the service supports it."
        />
      ) : !loading && !error ? (
        <Card>
          <Table
            rows={rows}
            empty={<EmptyState icon="swap_horiz" title="No transactions recorded" />}
            columns={[
              { key: "id", header: "ID", render: (row) => <span className="font-mono-data">{row.id}</span> },
              { key: "type", header: "Type", render: (row) => <Badge tone={row.type === "IN" ? "success" : "warning"}>{row.type}</Badge> },
              { key: "quantity", header: "Qty", align: "right" },
              { key: "reason", header: "Reason", render: (row) => row.reason || "—" },
              { key: "createdAt", header: "When", render: (row) => formatDate(row.createdAt) },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
