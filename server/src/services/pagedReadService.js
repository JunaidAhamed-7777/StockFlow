const { Prisma } = require('@prisma/client');
const { readError, positiveId, parsePageQuery, pageInfo, literalLike } = require('./readQuery');

const productSorts = { id: Prisma.sql`p.id`, name: Prisma.sql`p.name`, sku: Prisma.sql`p.sku`, price: Prisma.sql`p.price`, quantity: Prisma.sql`p.quantity` };
const direction = (order) => order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
const whereSQL = (parts) => parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
const pageEnvelope = (data, pagination, summary) => ({ success: true, data, pagination, summary });
const snapshot = (prisma, operation) => prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

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

  return { getProductPage };
}

module.exports = { createPagedReads };
