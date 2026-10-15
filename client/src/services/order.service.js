import { api, unwrap } from "./api";
import { asArray, publicUser, toId } from "../utils/apiData";
import { isPositiveInteger } from "../utils/cart";

function sanitizeOrder(order) {
  if (!order) return order;
  return {
    ...order,
    customer: publicUser(order.customer),
    orderItems: asArray(order.orderItems),
  };
}

export async function listOrders() {
  const response = await api.get("/orders");
  return asArray(unwrap(response)).map(sanitizeOrder);
}

export async function getOrder(id) {
  const response = await api.get(`/orders/${toId(id)}`);
  return sanitizeOrder(unwrap(response));
}

export async function createOrder(items) {
  const rows = asArray(items);
  if (!rows.length || rows.some((item) => !item || !isPositiveInteger(item.quantity))) {
    throw new Error("Add products with valid whole-number quantities before placing your order.");
  }
  const payload = {
    items: rows
      .map((item) => ({
        productId: toId(item.productId),
        quantity: Number(item.quantity),
      })),
  };
  const response = await api.post("/orders", payload);
  return sanitizeOrder(unwrap(response));
}

export async function updateOrderStatus(id, status) {
  const response = await api.patch(`/orders/${toId(id)}/status`, { status });
  return sanitizeOrder(unwrap(response));
}
