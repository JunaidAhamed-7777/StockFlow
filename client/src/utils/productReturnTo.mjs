/** Product forms may return only to their owning role's list, preserving its query. */
export function productListReturnTo(value, listPath) {
  if (!["/admin/products", "/supplier/products"].includes(listPath)) throw new Error("Unknown product-list destination.");
  if (typeof value !== "string" || (value !== listPath && !value.startsWith(`${listPath}?`)) || /[\\#\u0000-\u0020\u007f]/.test(value)) return listPath;
  try {
    const parsed = new URL(value, "http://stockflow.local");
    return parsed.origin === "http://stockflow.local" && parsed.pathname === listPath && !parsed.hash ? parsed.pathname + parsed.search : listPath;
  } catch { return listPath; }
}
