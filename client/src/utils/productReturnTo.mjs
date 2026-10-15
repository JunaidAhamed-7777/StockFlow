import { listReturnTo } from "./listState.mjs";

/** Product forms may return only to their owning role's list, preserving its query. */
export function productListReturnTo(value, listPath) {
  if (!["/admin/products", "/supplier/products"].includes(listPath)) throw new Error("Unknown product-list destination.");
  return listReturnTo(value, listPath);
}
