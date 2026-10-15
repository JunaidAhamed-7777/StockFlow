import { api, unwrap } from "./api";
import { asArray, toId } from "../utils/apiData";
import { pagedReadQuery, normalizeReadPage } from "../utils/pagedReads.mjs";

export async function listSupplierPage(options = {}, { signal } = {}) {
  const params = pagedReadQuery("suppliers", options);
  const response = await api.get("/discovery/suppliers", { params, signal });
  return normalizeReadPage("suppliers", response.data, params);
}

export async function getCategories() {
  const response = await api.get("/discovery/categories");
  return asArray(unwrap(response));
}

export async function getSuppliers() {
  const response = await api.get("/discovery/suppliers");
  return asArray(unwrap(response));
}

export async function getSupplier(id) {
  const response = await api.get(`/discovery/suppliers/${toId(id)}`);
  return unwrap(response);
}
