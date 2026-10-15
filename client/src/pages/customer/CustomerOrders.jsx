import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listOrders } from "../../services/order.service";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatDate } from "../../utils/format";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { OrderStatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";

export function CustomerOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setOrders(await listOrders());
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

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Fulfillment</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Dispatch portal</span></>}
        title="Your orders"
        description="Review your purchase history and the latest fulfillment status."
      />
      <Card>
        <Table
          rows={orders}
          onRowClick={(row) => navigate(`/customer/orders/${row.id}`)}
          empty={<EmptyState icon="local_shipping" title="No orders yet" actionLabel="Start shopping" onAction={() => navigate("/customer/products")} />}
          columns={[
            { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
            { key: "createdAt", header: "Placed", render: (row) => formatDate(row.createdAt) },
            { key: "items", header: "Lines", align: "right", render: (row) => row.orderItems?.length || 0 },
            { key: "totalAmount", header: "Total", align: "right", render: (row) => formatCurrency(row.totalAmount) },
            { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View order ${row.id}`} onClick={(event) => { event.stopPropagation(); navigate(`/customer/orders/${row.id}`); }}>View order</Button> },
          ]}
        />
      </Card>
    </>
  );
}
