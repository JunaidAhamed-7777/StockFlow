import test from "node:test";
import assert from "node:assert/strict";
import { productListReturnTo } from "../src/utils/productReturnTo.mjs";

test("product form returns preserve the owning list's committed query", () => {
  for (const role of ["admin", "supplier"]) {
    const path = `/${role}/products`;
    const query = `${path}?search=USB+hub&category=1&page=2`;
    assert.equal(productListReturnTo(query, path), query);
    assert.equal(productListReturnTo(undefined, path), path);
  }
});

test("external, cross-role, changed-path and fragment destinations fall back to the role's list", () => {
  const list = "/supplier/products";
  for (const value of ["https://evil.example/supplier/products", "//evil.example/supplier/products", "/admin/products?page=3", "/supplier/products/4", "/supplier/products/../profile", "/supplier/products#anchor", "/supplier/products?search=word#anchor", "/supplier/products?search=\nsecret", "/supplier/products?search=\\evil", {}, null]) assert.equal(productListReturnTo(value, list), list);
});
