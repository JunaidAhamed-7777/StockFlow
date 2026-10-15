// Synthetic in-memory contract fixtures only. Production aggregates belong in PostgreSQL.
const statuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) fail("Invalid positive integer query value.");
  return Number(value);
};
const text = (value, limit, field, truncatedFields) => {
  const source = String(value ?? "");
  if (source.length > limit) truncatedFields.push(field);
  return source.slice(0, limit);
};
const compare = (one, two) => typeof one === "number" && typeof two === "number" ? one - two : String(one ?? "").localeCompare(String(two ?? ""), "en");

function query(params, allowed, sorts, defaultSort, defaultOrder) {
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail("Unknown or repeated page query parameter.");
  if (!params.has("page")) fail("page is required for paged reads.");
  const page = integer(params.get("page"));
  const pageSize = params.has("pageSize") ? integer(params.get("pageSize"), 100) : 20;
  const search = (params.get("search") || "").trim();
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) fail("Invalid search query.");
  const sortBy = params.get("sortBy") ?? defaultSort;
  const sortOrder = params.get("sortOrder") ?? defaultOrder;
  if (!sorts.includes(sortBy) || !["asc", "desc"].includes(sortOrder)) fail("Invalid page sort.");
  return { page, pageSize, search, sortBy, sortOrder };
}

function envelope(rows, options, summary, project) {
  const sorted = [...rows].sort((one, two) => (compare(one[options.sortBy], two[options.sortBy]) || one.id - two.id) * (options.sortOrder === "asc" ? 1 : -1));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(options.page, pageCount);
  return {
    success: true, data: sorted.slice((page - 1) * options.pageSize, page * options.pageSize).map(project),
    pagination: { page, pageSize: options.pageSize, total, pageCount, hasNext: page < pageCount, hasPrevious: page > 1 }, summary,
  };
}

export function productPage(fixtures, params) {
  const options = query(params, ["page", "pageSize", "search", "category", "supplier", "stock", "sortBy", "sortOrder"], ["id", "name", "sku", "price", "quantity"], "id", "asc");
  const category = params.has("category") ? integer(params.get("category"), 2_147_483_647) : null;
  const supplier = params.has("supplier") ? integer(params.get("supplier"), 2_147_483_647) : null;
  const stock = params.get("stock");
  if (stock !== null && !["low", "critical", "out", "in"].includes(stock)) fail("Invalid stock filter.");
  const search = options.search.toLowerCase();
  const low = (row) => row.quantity <= row.lowStockThreshold;
  const critical = (row) => row.quantity === 0 || row.quantity <= Math.floor(row.lowStockThreshold * 0.5);
  const rows = fixtures.products.filter((row) => (!category || row.categoryId === category) && (!supplier || row.supplierId === supplier)
    && (!search || `${row.name} ${row.sku} ${row.description || ""}`.toLowerCase().includes(search))
    && (!stock || (stock === "low" ? low(row) : stock === "critical" ? critical(row) : stock === "out" ? row.quantity === 0 : !low(row))));
  const summary = rows.reduce((value, row) => ({
    productCount: value.productCount + 1, totalQuantity: value.totalQuantity + row.quantity,
    lowStockCount: value.lowStockCount + Number(low(row)), criticalStockCount: value.criticalStockCount + Number(critical(row)),
    outOfStockCount: value.outOfStockCount + Number(row.quantity === 0), inventoryValue: value.inventoryValue + row.quantity * row.price,
  }), { productCount: 0, totalQuantity: 0, lowStockCount: 0, criticalStockCount: 0, outOfStockCount: 0, inventoryValue: 0 });
  return envelope(rows, options, summary, (row) => {
    const truncatedFields = [];
    return { id: row.id, name: text(row.name, 256, "name", truncatedFields), sku: text(row.sku, 128, "sku", truncatedFields),
      price: row.price, quantity: row.quantity, lowStockThreshold: row.lowStockThreshold, categoryId: row.categoryId, supplierId: row.supplierId, truncatedFields };
  });
}

function publicCustomer(customer) {
  if (!customer) return null;
  const truncatedFields = [];
  return { id: customer.id, name: text(customer.name, 256, "name", truncatedFields), email: text(customer.email, 254, "email", truncatedFields), truncatedFields };
}

export function scopedOrders(fixtures, { role, userId, supplierId }) {
  if (!["ADMIN", "CUSTOMER", "SUPPLIER"].includes(role)) fail("Synthetic authentication required.", 401);
  if (role === "CUSTOMER" && (!Number.isSafeInteger(userId) || userId <= 0)) fail("Verified customer identity required.", 401);
  if (role === "SUPPLIER" && (!Number.isSafeInteger(supplierId) || supplierId <= 0)) fail("Supplier profile not found.", 404);
  return fixtures.orders.filter((row) => role === "ADMIN" || (role === "CUSTOMER" ? row.customerId === userId : row.orderItems.some((line) => line.product.supplierId === supplierId)));
}

export function orderDetail(fixtures, id, scope) {
  const order = scopedOrders(fixtures, scope).find((row) => row.id === id);
  if (!order) fail("Order not found.", 404);
  const lines = scope.role === "SUPPLIER" ? order.orderItems.filter((line) => line.product.supplierId === scope.supplierId) : order.orderItems;
  return { id: order.id, customerId: order.customerId, customer: publicCustomer(order.customer), status: order.status,
    createdAt: order.createdAt, updatedAt: order.updatedAt || order.createdAt, totalAmount: orderValues(order, scope).visibleAmount,
    orderItems: lines.map((line) => ({ id: line.id, orderId: order.id, productId: line.productId, quantity: line.quantity, price: line.price,
      product: { id: line.product.id, name: line.product.name, sku: line.product.sku, supplierId: line.product.supplierId } })),
    ...(scope.role === "SUPPLIER" ? { hasOtherSuppliers: order.orderItems.some((line) => line.product.supplierId !== scope.supplierId) } : {}),
  };
}

function orderValues(order, scope) {
  const lines = scope.role === "SUPPLIER" ? order.orderItems.filter((line) => line.product.supplierId === scope.supplierId) : order.orderItems;
  return { visibleLineCount: lines.length, visibleUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    visibleAmount: scope.role === "SUPPLIER" ? lines.reduce((sum, line) => sum + line.quantity * line.price, 0) : order.totalAmount };
}

export function orderPage(fixtures, params, scope) {
  const view = params.get("view");
  if (view !== null && view !== "customers") fail("Invalid order view.");
  if (view === "customers") return customerPage(fixtures, params, scope);
  const options = query(params, ["page", "pageSize", "search", "status", "sortBy", "sortOrder"], ["createdAt", "id", "status"], "createdAt", "desc");
  const status = params.get("status");
  if (status !== null && !statuses.includes(status)) fail("Invalid order status.");
  const search = options.search.replace(/^#/, "").toLowerCase();
  const rows = scopedOrders(fixtures, scope).filter((row) => (!status || row.status === status) && (!search || String(row.id).includes(search)
    || (scope.role !== "CUSTOMER" && `${row.customer?.name || ""} ${row.customer?.email || ""}`.toLowerCase().includes(search))));
  const summary = { orderCount: rows.length, statusCounts: Object.fromEntries(statuses.map((value) => [value, 0])), visibleLineCount: 0, visibleUnits: 0, visibleAmount: 0 };
  for (const row of rows) {
    summary.statusCounts[row.status]++;
    const values = orderValues(row, scope);
    for (const key of ["visibleLineCount", "visibleUnits", "visibleAmount"]) summary[key] += values[key];
  }
  return envelope(rows, options, summary, (row) => ({
    id: row.id, customerId: row.customerId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt || row.createdAt,
    customer: publicCustomer(row.customer), ...orderValues(row, scope), amountScope: scope.role === "SUPPLIER" ? "SUPPLIER_ITEMS" : "ORDER",
    ...(scope.role === "SUPPLIER" ? { hasOtherSuppliers: row.orderItems.some((line) => line.product.supplierId !== scope.supplierId) } : {}),
  }));
}

export function supplierPage(fixtures, params) {
  const options = query(params, ["page", "pageSize", "search", "sortBy", "sortOrder", "includeProductCounts"], ["id", "companyName"], "id", "asc");
  if (params.has("includeProductCounts") && params.get("includeProductCounts") !== "true") fail("Invalid supplier aggregate option.");
  const search = options.search.toLowerCase();
  const rows = fixtures.suppliers.filter((row) => `${row.companyName} ${row.user?.name || ""} ${row.user?.email || ""}`.toLowerCase().includes(search));
  const counts = new Map();
  for (const row of fixtures.products) counts.set(row.supplierId, (counts.get(row.supplierId) || 0) + 1);
  return envelope(rows, options, { supplierCount: rows.length }, (row) => {
    const truncatedFields = [];
    return { id: row.id, userId: row.userId, companyName: text(row.companyName, 256, "companyName", truncatedFields),
      contactNumber: text(row.contactNumber, 64, "contactNumber", truncatedFields), address: text(row.address, 512, "address", truncatedFields),
      user: publicCustomer(row.user), ...(params.get("includeProductCounts") === "true" ? { productCount: counts.get(row.id) || 0 } : {}), truncatedFields };
  });
}

function customerPage(fixtures, params, scope) {
  if (scope.role !== "ADMIN") fail("Admin customer summary required.", 403);
  const options = query(params, ["page", "pageSize", "view", "search", "sortBy", "sortOrder"], ["id", "name", "orderCount", "totalSpending", "lastOrderAt"], "name", "asc");
  const customers = new Map();
  for (const order of fixtures.orders) {
    const value = customers.get(order.customerId) || { id: order.customerId, name: order.customer?.name || "", email: order.customer?.email || "", orderCount: 0, totalSpending: 0, lastOrderAt: null };
    value.orderCount++; value.totalSpending += order.totalAmount;
    if (!value.lastOrderAt || order.createdAt > value.lastOrderAt) value.lastOrderAt = order.createdAt;
    customers.set(order.customerId, value);
  }
  const search = options.search.toLowerCase();
  const rows = [...customers.values()].filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(search));
  const summary = { customerCount: rows.length, totalSpending: rows.reduce((sum, row) => sum + row.totalSpending, 0) };
  return envelope(rows, options, summary, (row) => ({ ...publicCustomer(row), orderCount: row.orderCount, totalSpending: row.totalSpending, lastOrderAt: row.lastOrderAt }));
}
