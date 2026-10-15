import { useEffect, useRef, useState } from "react";
import { getOrder, listOrders, updateOrderStatus } from "../../services/order.service";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/errors";
import { formatCurrency, formatDate } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Table } from "../../components/ui/Table";
import { OrderStatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";

const STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const NEXT_STATUSES = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function OrdersPage({ title, description, canUpdateStatus }) {
  const { role, supplier } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const requestId = useRef(0);
  const isSupplier = role === "SUPPLIER";

  function visibleItems(order) {
    const items = order.orderItems || [];
    return isSupplier ? items.filter((item) => Number(item.product?.supplierId) === Number(supplier?.id)) : items;
  }

  function orderAmount(order) {
    return isSupplier ? visibleItems(order).reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) : order.totalAmount;
  }

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
    return () => { requestId.current += 1; };
  }, []);

  async function openOrder(row) {
    const activeRequest = ++requestId.current;
    setSelected(row);
    setDetail(null);
    setDetailError("");
    setMessage("");
    setStatus("");
    try {
      const full = await getOrder(row.id);
      if (activeRequest !== requestId.current) return;
      setDetail(full);
      setStatus(full.status);
    } catch (err) {
      if (activeRequest === requestId.current) setDetailError(getErrorMessage(err));
    }
  }

  function closeOrder() {
    if (saving) return;
    requestId.current += 1;
    setSelected(null);
    setDetail(null);
    setDetailError("");
  }

  async function saveStatus() {
    if (saving || !detail || !(NEXT_STATUSES[detail.status] || []).includes(status)) return;
    setSaving(true);
    setDetailError("");
    setMessage("");
    try {
      const updated = await updateOrderStatus(detail.id, status);
      setDetail(updated);
      setStatus(updated.status);
      setOrders((current) => current.map((order) => order.id === updated.id ? updated : order));
      setMessage("Order status updated.");
    } catch (err) {
      setDetailError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const filteredOrders = orders.filter((order) => (!statusFilter || order.status === statusFilter) && (!search.trim() || `${order.id} ${order.customer?.name || ""} ${order.customer?.email || ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const nextStatuses = NEXT_STATUSES[detail?.status] || [];

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Fulfillment</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Orders</span></>}
        title={title}
        description={description}
      />
      <Card className="p-space-base flex flex-col sm:flex-row gap-space-sm">
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Find an order or customer" />
        <Select value={statusFilter} aria-label="Filter orders by status" onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((item) => <option key={item} value={item}>{item.charAt(0) + item.slice(1).toLowerCase()}</option>)}
        </Select>
      </Card>
      <Card>
        <Table
          rows={filteredOrders}
          onRowClick={openOrder}
          empty={<EmptyState icon="receipt_long" title={orders.length ? "No matching orders" : "No orders yet"} description={orders.length ? "Try another search or status." : "Orders will appear here once a customer completes checkout."} />}
          columns={[
            { key: "id", header: "Order", render: (row) => <span className="font-mono-data">#{row.id}</span> },
            { key: "customer", header: "Customer", render: (row) => row.customer?.name || row.customer?.email || "—" },
            { key: "createdAt", header: "Created", render: (row) => formatDate(row.createdAt) },
            { key: "totalAmount", header: isSupplier ? "Your items" : "Total", align: "right", render: (row) => formatCurrency(orderAmount(row)) },
            { key: "status", header: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
            { key: "actions", header: "", render: (row) => <Button variant="outline" aria-label={`View order ${row.id}`} onClick={(event) => { event.stopPropagation(); openOrder(row); }}>View</Button> },
          ]}
        />
      </Card>
      <Modal
        open={Boolean(selected)}
        title={`Order #${selected?.id || ""}`}
        onClose={closeOrder}
        wide
        footer={canUpdateStatus && detail && nextStatuses.length ? <>
          <Select id="order-status" label="Update status" value={status} disabled={saving} onChange={(event) => setStatus(event.target.value)}>
            <option value={detail.status}>{detail.status}</option>
            {nextStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
          <Button loading={saving} disabled={status === detail.status} onClick={saveStatus}>Save status</Button>
        </> : <Button variant="outline" onClick={closeOrder}>Close</Button>}
      >
        {detailError ? <ErrorState message={detailError} onRetry={!detail ? () => openOrder(selected) : undefined} /> : null}
        <p role="status" aria-live="polite" className="font-body-sm text-secondary">{message}</p>
        {!detail && !detailError ? <p className="font-body-sm" role="status">Loading order…</p> : detail ? (
          <div className="space-y-space-md">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-md font-body-sm">
              <div><dt className="text-outline">Status</dt><dd><OrderStatusBadge status={detail.status} /></dd></div>
              <div><dt className="text-outline">{isSupplier ? "Your line total" : "Order total"}</dt><dd>{formatCurrency(orderAmount(detail))}</dd></div>
              <div><dt className="text-outline">Customer</dt><dd className="break-words">{detail.customer?.name || "—"}<br />{detail.customer?.email}</dd></div>
              <div><dt className="text-outline">Created</dt><dd>{formatDate(detail.createdAt)}</dd></div>
            </dl>
            {isSupplier ? <p className="font-caption text-on-surface-variant">Only your supplied items are shown. The fulfillment status applies to the whole order.</p> : null}
            {status === "CANCELLED" && detail.status !== "CANCELLED" ? <p className="font-body-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-space-sm">Cancelling an order does not restore inventory automatically. Record a stock adjustment if units are returned to stock.</p> : null}
            <Table
              rows={visibleItems(detail)}
              rowKey="id"
              empty={<EmptyState title="No line items" />}
              columns={[
                { key: "sku", header: "SKU", render: (row) => <span className="font-mono-data">{row.product?.sku}</span> },
                { key: "name", header: "Product", render: (row) => row.product?.name },
                { key: "quantity", header: "Qty", align: "right" },
                { key: "price", header: "Unit", align: "right", render: (row) => formatCurrency(row.price) },
                { key: "line", header: "Line", align: "right", render: (row) => formatCurrency(row.price * row.quantity) },
              ]}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}

export function AdminOrders() {
  return <OrdersPage title="Sales orders" description="Review customer orders and manage their fulfillment status." canUpdateStatus />;
}
