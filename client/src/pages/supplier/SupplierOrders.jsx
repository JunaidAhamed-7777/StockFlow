import { OrdersPage } from "../admin/AdminOrders";

export function SupplierOrders() {
  return (
    <OrdersPage
      title="Supplier orders"
      description="Review orders containing your products and manage fulfillment."
      canUpdateStatus
    />
  );
}
