const { Prisma } = require('@prisma/client');
const { readError, positiveId, parsePageQuery, pageInfo, literalLike } = require('./readQuery');

const productSorts = { id: Prisma.sql`p.id`, name: Prisma.sql`p.name`, sku: Prisma.sql`p.sku`, price: Prisma.sql`p.price`, quantity: Prisma.sql`p.quantity` };
const orderSorts = { id: Prisma.sql`o.id`, createdAt: Prisma.sql`o."createdAt"`, status: Prisma.sql`o.status` };
const customerSorts = { id: Prisma.sql`g.id`, name: Prisma.sql`g.name`, orderCount: Prisma.sql`g."orderCount"`, totalSpending: Prisma.sql`g."totalSpending"`, lastOrderAt: Prisma.sql`g."lastOrderAt"` };
const supplierSorts = { id: Prisma.sql`s.id`, companyName: Prisma.sql`s."companyName"` };
const statuses = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const direction = (order) => order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
const whereSQL = (parts) => parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
const pageEnvelope = (data, pagination, summary) => ({ success: true, data, pagination, summary });
const snapshot = (prisma, operation) => prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
const customerSQL = Prisma.sql`jsonb_build_object('id', c.id, 'name', LEFT(c.name, 256), 'email', LEFT(c.email, 254),
  'truncatedFields', ARRAY_REMOVE(ARRAY[CASE WHEN CHAR_LENGTH(c.name) > 256 THEN 'name' END, CASE WHEN CHAR_LENGTH(c.email) > 254 THEN 'email' END], NULL))`;

function orderScope(user) {
  if (!user || !['ADMIN', 'CUSTOMER', 'SUPPLIER'].includes(user.role)) throw readError('Authenticated role required', 401);
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.id > 2_147_483_647) throw readError('Verified account identity required', 401);
  if (user.role === 'SUPPLIER' && (!Number.isSafeInteger(user.supplierId) || user.supplierId <= 0 || user.supplierId > 2_147_483_647)) throw readError('Supplier profile not found', 404);
  return user;
}

async function verifySupplier(tx, user) {
  if (user.role !== 'SUPPLIER') return;
  const supplier = await tx.supplier.findUnique({ where: { id: user.supplierId }, select: { userId: true } });
  if (!supplier || supplier.userId !== user.id) throw readError('Supplier profile not found', 404);
}

function orderOptions(query, user) {
  const options = parsePageQuery(query, { allowed: ['page', 'pageSize', 'search', 'status', 'sortBy', 'sortOrder'], sorts: Object.keys(orderSorts), defaultSort: 'createdAt', defaultOrder: 'desc' });
  const predicates = [];
  if (user.role === 'CUSTOMER') predicates.push(Prisma.sql`o."customerId" = ${user.id}`);
  if (user.role === 'SUPPLIER') predicates.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" owned JOIN "Product" owner ON owner.id = owned."productId" WHERE owned."orderId" = o.id AND owner."supplierId" = ${user.supplierId})`);
  if (query.status !== undefined) {
    if (!statuses.includes(query.status)) throw readError('Invalid order status');
    predicates.push(Prisma.sql`o.status = ${query.status}`);
  }
  const search = options.search.replace(/^#/, '');
  if (search) {
    const pattern = literalLike(search);
    predicates.push(user.role === 'CUSTOMER' ? Prisma.sql`CAST(o.id AS text) ILIKE ${pattern}`
      : Prisma.sql`(CAST(o.id AS text) ILIKE ${pattern} OR c.name ILIKE ${pattern} OR c.email ILIKE ${pattern})`);
  }
  return { ...options, where: whereSQL(predicates) };
}

function publicCustomer(customer) {
  const truncatedFields = [];
  const bounded = (value, size, key) => { if (value.length > size) truncatedFields.push(key); return value.slice(0, size); };
  return { id: customer.id, name: bounded(customer.name, 256, 'name'), email: bounded(customer.email, 254, 'email'), truncatedFields };
}

function productOptions(query) {
  const options = parsePageQuery(query, { allowed: ['page', 'pageSize', 'search', 'category', 'supplier', 'stock', 'sortBy', 'sortOrder'], sorts: Object.keys(productSorts) });
  const predicates = [];
  if (query.category !== undefined) predicates.push(Prisma.sql`p."categoryId" = ${positiveId(query.category)}`);
  if (query.supplier !== undefined) predicates.push(Prisma.sql`p."supplierId" = ${positiveId(query.supplier)}`);
  if (options.search) {
    const search = literalLike(options.search);
    predicates.push(Prisma.sql`(p.name ILIKE ${search} OR p.sku ILIKE ${search} OR p.description ILIKE ${search})`);
  }
  if (query.stock !== undefined) {
    const stocks = {
      low: Prisma.sql`p.quantity <= p."lowStockThreshold"`, critical: Prisma.sql`(p.quantity = 0 OR p.quantity <= FLOOR(p."lowStockThreshold" * 0.5))`,
      out: Prisma.sql`p.quantity = 0`, in: Prisma.sql`p.quantity > p."lowStockThreshold"`,
    };
    if (!Object.hasOwn(stocks, query.stock)) throw readError('Invalid stock filter');
    predicates.push(stocks[query.stock]);
  }
  return { ...options, where: whereSQL(predicates) };
}

function createPagedReads(prisma) {
  async function getProductPage(query) {
    const options = productOptions(query);
    return snapshot(prisma, async (tx) => {
      const [summary] = await tx.$queryRaw(Prisma.sql`
        SELECT COUNT(*)::int AS "productCount", COALESCE(SUM(p.quantity), 0)::double precision AS "totalQuantity",
          COUNT(*) FILTER (WHERE p.quantity <= p."lowStockThreshold")::int AS "lowStockCount",
          COUNT(*) FILTER (WHERE p.quantity = 0 OR p.quantity <= FLOOR(p."lowStockThreshold" * 0.5))::int AS "criticalStockCount",
          COUNT(*) FILTER (WHERE p.quantity = 0)::int AS "outOfStockCount",
          COALESCE(SUM(p.quantity * p.price), 0)::double precision AS "inventoryValue"
        FROM "Product" p WHERE ${options.where}`);
      const pagination = pageInfo(options, summary.productCount);
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT p.id, LEFT(p.name, 256) AS name, LEFT(p.sku, 128) AS sku, p.price, p.quantity,
          p."lowStockThreshold", p."categoryId", p."supplierId",
          ARRAY_REMOVE(ARRAY[CASE WHEN CHAR_LENGTH(p.name) > 256 THEN 'name' END, CASE WHEN CHAR_LENGTH(p.sku) > 128 THEN 'sku' END], NULL) AS "truncatedFields"
        FROM "Product" p WHERE ${options.where}
        ORDER BY ${productSorts[options.sortBy]} ${direction(options.sortOrder)}, p.id ${direction(options.sortOrder)}
        LIMIT ${options.pageSize} OFFSET ${(pagination.page - 1) * options.pageSize}`);
      return pageEnvelope(rows, pagination, summary);
    });
  }

  async function getCustomerPage(query, user) {
    if (user.role !== 'ADMIN') throw readError('Admin customer summary required', 403);
    const options = parsePageQuery(query, { allowed: ['page', 'pageSize', 'view', 'search', 'sortBy', 'sortOrder'], sorts: Object.keys(customerSorts), defaultSort: 'name' });
    const pattern = literalLike(options.search);
    const where = options.search ? Prisma.sql`(g.name ILIKE ${pattern} OR g.email ILIKE ${pattern})` : Prisma.sql`TRUE`;
    const grouped = Prisma.sql`WITH grouped AS (
      SELECT c.id, c.name, c.email, COUNT(o.id)::int AS "orderCount", COALESCE(SUM(o."totalAmount"), 0)::double precision AS "totalSpending", MAX(o."createdAt") AS "lastOrderAt"
      FROM "User" c JOIN "Order" o ON o."customerId" = c.id GROUP BY c.id
    )`;
    return snapshot(prisma, async (tx) => {
      const [summary] = await tx.$queryRaw(Prisma.sql`${grouped}
        SELECT COUNT(*)::int AS "customerCount", COALESCE(SUM(g."totalSpending"), 0)::double precision AS "totalSpending" FROM grouped g WHERE ${where}`);
      const pagination = pageInfo(options, summary.customerCount);
      const rows = await tx.$queryRaw(Prisma.sql`${grouped}
        SELECT g.id, LEFT(g.name, 256) AS name, LEFT(g.email, 254) AS email, g."orderCount", g."totalSpending", g."lastOrderAt",
          ARRAY_REMOVE(ARRAY[CASE WHEN CHAR_LENGTH(g.name) > 256 THEN 'name' END, CASE WHEN CHAR_LENGTH(g.email) > 254 THEN 'email' END], NULL) AS "truncatedFields"
        FROM grouped g WHERE ${where} ORDER BY ${customerSorts[options.sortBy]} ${direction(options.sortOrder)}, g.id ${direction(options.sortOrder)}
        LIMIT ${options.pageSize} OFFSET ${(pagination.page - 1) * options.pageSize}`);
      return pageEnvelope(rows, pagination, summary);
    });
  }

  async function getOrderPage(query, account) {
    const user = orderScope(account);
    if (query.view !== undefined) {
      if (query.view !== 'customers') throw readError('Invalid order view');
      return getCustomerPage(query, user);
    }
    const options = orderOptions(query, user);
    const supplier = user.role === 'SUPPLIER';
    const lineScope = supplier ? Prisma.sql`p."supplierId" = ${user.supplierId}` : Prisma.sql`TRUE`;
    return snapshot(prisma, async (tx) => {
      await verifySupplier(tx, user);
      const [summary] = await tx.$queryRaw(Prisma.sql`
        WITH matching AS (SELECT o.id, o.status, o."totalAmount" FROM "Order" o JOIN "User" c ON c.id = o."customerId" WHERE ${options.where}),
        lines AS (SELECT i."orderId", COUNT(*)::int AS "lineCount", SUM(i.quantity)::double precision AS units, SUM(i.quantity * i.price)::double precision AS amount
          FROM "OrderItem" i JOIN "Product" p ON p.id = i."productId" JOIN matching m ON m.id = i."orderId" WHERE ${lineScope} GROUP BY i."orderId")
        SELECT COUNT(*)::int AS "orderCount",
          jsonb_build_object('PENDING', COUNT(*) FILTER (WHERE m.status = 'PENDING'), 'PROCESSING', COUNT(*) FILTER (WHERE m.status = 'PROCESSING'),
            'SHIPPED', COUNT(*) FILTER (WHERE m.status = 'SHIPPED'), 'DELIVERED', COUNT(*) FILTER (WHERE m.status = 'DELIVERED'), 'CANCELLED', COUNT(*) FILTER (WHERE m.status = 'CANCELLED')) AS "statusCounts",
          COALESCE(SUM(lines."lineCount"), 0)::double precision AS "visibleLineCount", COALESCE(SUM(lines.units), 0)::double precision AS "visibleUnits",
          COALESCE(SUM(${supplier ? Prisma.sql`lines.amount` : Prisma.sql`m."totalAmount"`}), 0)::double precision AS "visibleAmount"
        FROM matching m LEFT JOIN lines ON lines."orderId" = m.id`);
      const pagination = pageInfo(options, summary.orderCount);
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT o.id, o."customerId", o.status, o."createdAt", o."updatedAt", ${customerSQL} AS customer,
          ${supplier ? Prisma.sql`NULL::double precision` : Prisma.sql`o."totalAmount"`} AS "_totalAmount"
          ${supplier ? Prisma.sql`, EXISTS (SELECT 1 FROM "OrderItem" other JOIN "Product" foreign_product ON foreign_product.id = other."productId" WHERE other."orderId" = o.id AND foreign_product."supplierId" <> ${user.supplierId}) AS "hasOtherSuppliers"` : Prisma.empty}
        FROM "Order" o JOIN "User" c ON c.id = o."customerId" WHERE ${options.where}
        ORDER BY ${orderSorts[options.sortBy]} ${direction(options.sortOrder)}, o.id ${direction(options.sortOrder)}
        LIMIT ${options.pageSize} OFFSET ${(pagination.page - 1) * options.pageSize}`);
      const aggregates = rows.length ? await tx.$queryRaw(Prisma.sql`
        SELECT i."orderId", COUNT(*)::int AS "visibleLineCount", SUM(i.quantity)::double precision AS "visibleUnits", SUM(i.quantity * i.price)::double precision AS amount
        FROM "OrderItem" i JOIN "Product" p ON p.id = i."productId" WHERE i."orderId" IN (${Prisma.join(rows.map((row) => row.id))}) AND ${lineScope} GROUP BY i."orderId"`) : [];
      const byOrder = new Map(aggregates.map((row) => [row.orderId, row]));
      const data = rows.map(({ _totalAmount, ...row }) => {
        const lines = byOrder.get(row.id);
        return { ...row, visibleLineCount: lines?.visibleLineCount || 0, visibleUnits: lines?.visibleUnits || 0,
          visibleAmount: supplier ? lines?.amount || 0 : _totalAmount, amountScope: supplier ? 'SUPPLIER_ITEMS' : 'ORDER' };
      });
      return pageEnvelope(data, pagination, summary);
    });
  }

  async function getOrderDetail(id, account) {
    const user = orderScope(account);
    positiveId(String(id));
    return snapshot(prisma, async (tx) => {
      await verifySupplier(tx, user);
      const identity = await tx.order.findUnique({ where: { id }, select: { customerId: true } });
      if (!identity) throw readError('Order not found', 404);
      if (user.role === 'CUSTOMER' && identity.customerId !== user.id) throw readError('Forbidden', 403);
      const supplier = user.role === 'SUPPLIER';
      if (supplier && !await tx.orderItem.findFirst({ where: { orderId: id, product: { supplierId: user.supplierId } }, select: { id: true } })) throw readError('Forbidden', 403);
      const order = await tx.order.findUnique({ where: { id }, select: {
        id: true, customerId: true, status: true, createdAt: true, updatedAt: true, totalAmount: !supplier,
        customer: { select: { id: true, name: true, email: true } },
        orderItems: { ...(supplier ? { where: { product: { supplierId: user.supplierId } } } : {}), select: {
          id: true, orderId: true, productId: true, quantity: true, price: true,
          product: { select: { id: true, name: true, sku: true, supplierId: true } },
        } },
      } });
      const result = { ...order, customer: publicCustomer(order.customer) };
      if (supplier) {
        result.totalAmount = order.orderItems.reduce((sum, line) => sum + line.quantity * line.price, 0);
        result.hasOtherSuppliers = await tx.orderItem.count({ where: { orderId: id, product: { supplierId: { not: user.supplierId } } } }) > 0;
      }
      return result;
    });
  }

  async function getSupplierPage(query) {
    const options = parsePageQuery(query, { allowed: ['page', 'pageSize', 'search', 'sortBy', 'sortOrder', 'includeProductCounts'], sorts: Object.keys(supplierSorts) });
    if (query.includeProductCounts !== undefined && query.includeProductCounts !== 'true') throw readError('Invalid supplier aggregate option');
    const pattern = literalLike(options.search);
    const where = options.search ? Prisma.sql`(s."companyName" ILIKE ${pattern} OR c.name ILIKE ${pattern} OR c.email ILIKE ${pattern})` : Prisma.sql`TRUE`;
    return snapshot(prisma, async (tx) => {
      const [summary] = await tx.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS "supplierCount" FROM "Supplier" s JOIN "User" c ON c.id = s."userId" WHERE ${where}`);
      const pagination = pageInfo(options, summary.supplierCount);
      const rows = await tx.$queryRaw(Prisma.sql`
        SELECT s.id, s."userId", LEFT(s."companyName", 256) AS "companyName", LEFT(s."contactNumber", 64) AS "contactNumber", COALESCE(LEFT(s.address, 512), '') AS address,
          ${customerSQL} AS "user", ARRAY_REMOVE(ARRAY[CASE WHEN CHAR_LENGTH(s."companyName") > 256 THEN 'companyName' END,
            CASE WHEN CHAR_LENGTH(s."contactNumber") > 64 THEN 'contactNumber' END, CASE WHEN CHAR_LENGTH(s.address) > 512 THEN 'address' END], NULL) AS "truncatedFields"
        FROM "Supplier" s JOIN "User" c ON c.id = s."userId" WHERE ${where}
        ORDER BY ${supplierSorts[options.sortBy]} ${direction(options.sortOrder)}, s.id ${direction(options.sortOrder)}
        LIMIT ${options.pageSize} OFFSET ${(pagination.page - 1) * options.pageSize}`);
      if (query.includeProductCounts === 'true') {
        const counts = rows.length ? await tx.$queryRaw(Prisma.sql`SELECT p."supplierId", COUNT(*)::int AS "productCount" FROM "Product" p WHERE p."supplierId" IN (${Prisma.join(rows.map((row) => row.id))}) GROUP BY p."supplierId"`) : [];
        const bySupplier = new Map(counts.map((row) => [row.supplierId, row.productCount]));
        for (const row of rows) row.productCount = bySupplier.get(row.id) || 0;
      }
      return pageEnvelope(rows, pagination, summary);
    });
  }

  return { getProductPage, getOrderPage, getOrderDetail, getSupplierPage };
}

module.exports = { createPagedReads };
