import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCart, isPositiveInteger, MAX_QUANTITY } from "../src/utils/cart.ts";

const line = { productId: 1, name: "Packing tape", sku: "TAPE-01", price: 9.5, quantity: 2, stock: 5 };

test("untrusted persisted carts reject unavailable, fractional, and non-finite quantities", () => {
  const invalid = [0, -1, 1.2, Infinity, NaN, MAX_QUANTITY + 1, true, false, [], [1], {}, null, ""];
  for (const value of invalid) {
    assert.equal(isPositiveInteger(value), false);
    assert.deepEqual(sanitizeCart([{ ...line, quantity: value }]), []);
    assert.deepEqual(sanitizeCart([{ ...line, stock: value }]), []);
    assert.deepEqual(sanitizeCart([{ ...line, productId: value }]), []);
  }
});

test("duplicate product IDs are consolidated and bounded by available stock", () => {
  const original = [{ ...line, quantity: 4 }, { ...line, quantity: 3 }];
  assert.deepEqual(sanitizeCart(original), [{ ...line, quantity: 5 }]);
  assert.equal(original[0].quantity, 4);
});

test("cart caches cannot introduce invalid totals or arbitrary object properties", () => {
  assert.deepEqual(sanitizeCart([{ ...line, price: Infinity }, { ...line, price: -5 }, null]), []);
  assert.deepEqual(sanitizeCart([{ ...line, extra: "discard", quantity: "2", stock: "5" }]), [line]);
  assert.deepEqual(sanitizeCart({ items: [line] }), []);
});
