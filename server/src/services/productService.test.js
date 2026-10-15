const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

test('product detail preserves full existing values and reports deleted records as 404', async () => {
  const full = { id: 123, name: 'Full name', description: 'Full description', category: { id: 1 }, supplier: { id: 2 } };
  const queries = [];
  const prisma = { product: { findUnique: async (args) => { queries.push(args); return args.where.id === 123 ? full : null; } } };
  const module = { exports: {} };
  const injectedRequire = (id) => {
    if (id === '../prismaClient') return prisma;
    if (id === './pagedReadService') return require('./pagedReadService');
    if (id === './readQuery') return require('./readQuery');
    throw new Error(`Unexpected dependency ${id}`);
  };
  new Function('require', 'module', 'exports', readFileSync(path.join(__dirname, 'productService.js'), 'utf8'))(injectedRequire, module, module.exports);
  assert.equal(await module.exports.getById(123), full);
  await assert.rejects(module.exports.getById(999), { message: 'Product not found', status: 404 });
  assert.deepEqual(queries, [123, 999].map((id) => ({ where: { id }, include: { category: true, supplier: true } })));
});
