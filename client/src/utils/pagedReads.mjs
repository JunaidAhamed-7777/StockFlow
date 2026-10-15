import { normalizePageEnvelope } from "./remotePage.mjs";

const fields = {
  products: ["search", "category", "supplier", "stock", "sortBy", "sortOrder"],
  orders: ["search", "status", "view", "sortBy", "sortOrder"],
  suppliers: ["search", "includeProductCounts", "sortBy", "sortOrder"],
};
const positive = (value, maximum) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const invalid = () => { throw new Error("The server returned incomplete list totals. Try loading the list again."); };

/** Page adapters explicitly opt in; legacy complete-array adapters remain separate. */
export function pagedReadQuery(kind, options = {}) {
  if (!fields[kind] || !options || typeof options !== "object" || Array.isArray(options)) throw new Error("Invalid paged read.");
  const { page = 1, pageSize = 20 } = options;
  if (!positive(page, Number.MAX_SAFE_INTEGER) || !positive(pageSize, 100)) throw new Error("Choose a valid page and a page size from 1 to 100.");
  const query = { page, pageSize };
  for (const [key, source] of Object.entries(options)) {
    if (key === "page" || key === "pageSize") continue;
    if (!fields[kind].includes(key)) throw new Error("Unsupported list filter.");
    if (source === undefined || source === null || source === "") continue;
    if (key === "includeProductCounts") {
      if (source !== true && source !== "true") throw new Error("Invalid supplier count option.");
      query[key] = "true";
    } else if (["category", "supplier"].includes(key)) {
      const id = typeof source === "string" && /^[1-9]\d*$/.test(source) ? Number(source) : source;
      if (!positive(id, 2_147_483_647)) throw new Error("Choose a valid record filter.");
      query[key] = id;
    } else {
      if (typeof source !== "string") throw new Error("Invalid list filter.");
      const value = source.trim();
      if (key === "search" && (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error("Search must contain at most 200 characters.");
      if (value) query[key] = value;
    }
  }
  return query;
}

/** Complete metrics are required, so a malformed response cannot masquerade as zero. */
export function normalizeReadPage(kind, body, query) {
  const result = normalizePageEnvelope(body, { requestedPage: query.page, pageSize: query.pageSize });
  const counts = kind === "products" ? ["productCount", "totalQuantity", "lowStockCount", "criticalStockCount", "outOfStockCount"]
    : kind === "suppliers" ? ["supplierCount"]
    : query.view === "customers" ? ["customerCount"] : ["orderCount", "visibleLineCount", "visibleUnits"];
  const amounts = kind === "products" ? ["inventoryValue"] : kind === "suppliers" ? [] : query.view === "customers" ? ["totalSpending"] : ["visibleAmount"];
  if (!result.summary || counts.some((key) => !Number.isSafeInteger(result.summary[key]) || result.summary[key] < 0)
    || amounts.some((key) => !Number.isFinite(result.summary[key]) || result.summary[key] < 0)
    || result.summary[counts[0]] !== result.total) invalid();
  if (kind === "orders" && query.view !== "customers") {
    const statuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    if (!result.summary.statusCounts || statuses.some((status) => !Number.isSafeInteger(result.summary.statusCounts[status]) || result.summary.statusCounts[status] < 0)
      || statuses.reduce((sum, status) => sum + result.summary.statusCounts[status], 0) !== result.total) invalid();
  }
  return result;
}
