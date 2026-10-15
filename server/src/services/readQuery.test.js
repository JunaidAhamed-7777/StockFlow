const test = require('node:test');
const assert = require('node:assert/strict');
const { pageRequested, parsePageQuery, positiveId, pageInfo, literalLike } = require('./readQuery');
const options = { allowed: ['page', 'pageSize', 'search', 'sortBy', 'sortOrder'], sorts: ['id', 'name'] };

test('page opt-in retains absence and rejects structured, repeated and malformed values', () => {
  assert.equal(pageRequested({ search: 'legacy' }), false);
  assert.equal(pageRequested({ page: '1' }), true);
  for (const key of ['page[]', 'page[x]', 'page.value', 'pageSize[]']) assert.throws(() => pageRequested({ [key]: '1' }), { status: 400 });
  for (const query of [{}, { pageSize: '20' }, { page: ['1', '2'] }, { page: { x: '1' } }, { page: '0' }, { page: '01' }, { page: '1.2' }, { page: 'Infinity' }, { page: '9007199254740992' }, { page: '1', pageSize: '101' }, { page: '1', sortBy: '' }, { page: '1', sortOrder: '' }, { page: '1', sortBy: 'constructor' }, { page: '1', unknown: 'x' }, { page: '1', search: 'x'.repeat(201) }, { page: '1', search: '\0' }]) {
    assert.throws(() => parsePageQuery(query, options), { status: 400 });
  }
  assert.throws(() => positiveId('2147483648'), { status: 400 });
  assert.equal(positiveId('2147483647'), 2147483647);
});

test('trimmed literal search, omitted defaults and empty/clamped pages are deterministic', () => {
  assert.deepEqual(parsePageQuery({ page: '3', search: '  a%_\\b  ' }, options), { page: 3, pageSize: 20, search: 'a%_\\b', sortBy: 'id', sortOrder: 'asc' });
  assert.equal(literalLike('a%_\\b'), '%a\\%\\_\\\\b%');
  assert.deepEqual(pageInfo({ page: 99, pageSize: 20 }, 0), { page: 1, pageSize: 20, total: 0, pageCount: 1, hasNext: false, hasPrevious: false });
  assert.deepEqual(pageInfo({ page: 99, pageSize: 20 }, 44), { page: 3, pageSize: 20, total: 44, pageCount: 3, hasNext: false, hasPrevious: true });
});
