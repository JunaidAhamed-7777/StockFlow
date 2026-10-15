import { OrdersPage } from "../admin/AdminOrders";

export function SupplierOrders() {
  return (
    <OrdersPage
      title="Orders"
      description="Review your supplied items and update orders fulfilled entirely by your company."
      canUpdateStatus
    />
  );
}
