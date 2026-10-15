import { api, unwrap } from "./api";
import { asArray, toId } from "../utils/apiData";
import { MAX_QUANTITY } from "../utils/cart";
import { pagedReadQuery, normalizeReadPage } from "../utils/pagedReads.mjs";

export async function listProductPage(options = {}, { signal } = {}) {
  const params = pagedReadQuery("products", options);
  const response = await api.get("/products", { params, signal });
  return normalizeReadPage("products", response.data, params);
}

export async function listProducts(params = {}) {
  const query = {};
  if (params.search) query.search = params.search;
  if (params.category) query.category = toId(params.category);
  if (params.supplier) query.supplier = toId(params.supplier);
  if (params.lowStock) query.lowStock = "true";
  if (params.lowStockThreshold != null && params.lowStockThreshold !== "") {
    query.lowStockThreshold = Number(params.lowStockThreshold);
  }
  const response = await api.get("/products", { params: query });
  return asArray(unwrap(response));
}

export async function getProduct(id, { signal } = {}) {
  const response = await api.get(`/products/${toId(id)}`, { signal });
  return unwrap(response);
}

function toProductBody(payload) {
  const body = {
    name: String(payload.name || "").trim(),
    sku: String(payload.sku || "").trim(),
    price: Number(payload.price),
    lowStockThreshold: Number(payload.lowStockThreshold),
    categoryId: toId(payload.categoryId),
  };
  if (!body.name || !body.sku || !Number.isFinite(body.price) || body.price < 0) {
    throw new Error("Provide a product name, SKU, and a valid non-negative price.");
  }
  if (payload.quantity !== undefined) body.quantity = Number(payload.quantity);
  if ([body.lowStockThreshold, ...(body.quantity === undefined ? [] : [body.quantity])].some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_QUANTITY)) {
    throw new Error("Stock and low-stock threshold must be non-negative whole numbers.");
  }
  if (payload.description != null) {
    body.description = String(payload.description).trim();
  }
  if (payload.supplierId != null && payload.supplierId !== "") {
    body.supplierId = toId(payload.supplierId);
  }
  return body;
}

export async function createProduct(payload) {
  const response = await api.post("/products", toProductBody(payload));
  return unwrap(response);
}

export async function updateProduct(id, payload) {
  const response = await api.put(`/products/${toId(id)}`, toProductBody(payload));
  return unwrap(response);
}

export async function deleteProduct(id) {
  const response = await api.delete(`/products/${toId(id)}`);
  return response.data;
}
