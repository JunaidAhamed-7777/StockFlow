import { api, unwrap } from "./api";
import { asArray, toId } from "../utils/apiData";
import { MAX_QUANTITY } from "../utils/cart";

export async function getLowStock() {
  const response = await api.get("/stock/low-stock");
  return asArray(unwrap(response));
}

export async function adjustStock(payload) {
  const change = Number(payload.quantityChange);
  if (!Number.isSafeInteger(change) || change === 0 || Math.abs(change) > MAX_QUANTITY) {
    throw new Error("Enter a non-zero whole-number stock adjustment.");
  }
  const response = await api.patch("/stock/adjust", {
    productId: toId(payload.productId),
    quantityChange: change,
    reason: typeof payload.reason === "string" ? payload.reason.trim() || undefined : undefined,
  });
  return unwrap(response);
}

export async function getStockTransactions() {
  const response = await api.get("/stock/transactions");
  return asArray(unwrap(response));
}
