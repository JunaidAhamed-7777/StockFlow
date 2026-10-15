import test from "node:test";
import assert from "node:assert/strict";
import { publicUser } from "../src/utils/apiData.js";

test("public labels retain explicit truncation without retaining private fields or arbitrary metadata", () => {
  assert.deepEqual(publicUser({ id: 2, name: "Short label", email: "short@example.test", role: "CUSTOMER",
    password: "private", address: "private", truncatedFields: ["name", "name", "email", "password", { private: true }] }),
  { id: 2, name: "Short label", email: "short@example.test", role: "CUSTOMER", truncatedFields: ["name", "email"] });
  assert.equal(publicUser(null), null);
});
