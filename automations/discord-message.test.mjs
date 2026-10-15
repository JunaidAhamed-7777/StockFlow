import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerNotification, planNotifications } from './notification-rules.mjs';
import { createDiscordPayload } from './discord-message.mjs';

const notification = (overrides = {}) => createOwnerNotification({
  supplier: { id: 1, companyName: 'Supplier Test', user: { email: 'supplier.test@stockflow.local' } },
  mode: 'low-stock', subject: 'StockFlow: 2 products need attention', lines: ['ITEM-ONE: 2 remaining.', 'ITEM-TWO: 0 remaining.'],
  events: [{ key: 'stock:1:11', at: 100 }], deliveryMode: 'discord', notificationsEnabled: true, ...overrides,
});

test('one grouped Discord payload has explicit test routing and no other transport capabilities', () => {
  const payload = createDiscordPayload(notification());
  assert.deepEqual(Object.keys(payload), ['content', 'flags', 'tts']);
  assert.equal(payload.flags, 4);
  assert.match(payload.content, /^\[TEST ROUTE\] SINGLE DISCORD TEST CHANNEL\nIntended stock owner: Supplier Test\n/);
  assert.match(payload.content, /Supplier ID: 1\nActual testing destination: configured Discord channel/);
  assert.match(payload.content, /intended owner was not contacted/);
  assert.match(payload.content, /ITEM\\-ONE/);
  assert.match(payload.content, /ITEM\\-TWO/);
  assert.ok(payload.content.length <= 2000);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.files, undefined);
  assert.equal(payload.tts, false);
  assert.equal(payload.url, undefined);
  assert.equal(payload.allowed_mentions, undefined, 'native n8n Discord transport does not support this API field');
  assert.equal(payload.content.includes('@'), false);
});

test('payload generation fails closed for other modes, destinations, or incomplete owner attribution', () => {
  const mutations = [
    value => { value.deliveryMode = 'redirect'; },
    value => { value.deliveryMode = 'owner'; },
    value => { value.deliveryMode = 'preview'; },
    value => { value.to = 'junuhammad2@gmail.com'; },
    value => { value.to = 'https://discord.com/api/webhooks/secret'; },
    value => { value.kind = 'summary'; },
    value => { value.intendedRecipient = null; },
    value => { value.intendedRecipient.email = 'invalid'; },
    value => { value.intendedRecipient.email = 'owner@host\n@everyone'; },
    value => { value.intendedRecipient.name = ''; },
    value => { value.intendedRecipient.name = '\u0000\u202E'; },
    value => { value.intendedRecipient.name = 'x'.repeat(181); },
    value => { value.intendedRecipient.supplierId = -1; },
    value => { value.intendedRecipient.supplierId = '1'; },
    value => { value.supplierId = 2; },
    value => { value.subject = 'Missing test route'; },
    value => { value.message = ''; },
  ];
  for (const mutate of mutations) {
    const value = notification();
    mutate(value);
    assert.throws(() => createDiscordPayload(value), /Invalid single-channel Discord/);
  }
  assert.throws(() => createDiscordPayload(null));
});

test('hostile inventory text cannot create Discord mentions, formatting, links, or control-code effects', () => {
  const value = notification({
    supplier: { id: 1, user: { name: '**Owner** @everyone <@123>\u0000\u202E', email: 'owner+test@stockflow.local' } },
    subject: 'StockFlow: @here `code` ||spoiler||',
    lines: ['<@!123> <@&456> <#789> @everyone @here **bold** _italic_ ~~strike~~ [hidden](https://example.com)\n\u0000\u0008\u001B\u202Econtrol'],
  });
  const payload = createDiscordPayload(value);
  assert.doesNotMatch(payload.content, /@|<|>|[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E]/);
  assert.match(payload.content, /\[at\] everyone/);
  assert.match(payload.content, /\[at\] here/);
  assert.match(payload.content, /‹ \[at\] 123›/);
  assert.match(payload.content, /\\\*\\\*Owner\\\*\\\*/);
  assert.match(payload.content, /\\\[hidden\\\]\\\(https:\/\/example\\.com\\\)/);
  assert.equal(value.intendedRecipient.email, 'owner+test@stockflow.local', 'raw attribution metadata retains the exact recorded email');
});

test('large owner groups remain a single capped post with full attribution and an omission notice', () => {
  const value = notification({ lines: Array.from({ length: 200 }, (_, index) => `PRODUCT-${index}: ${'📦 stock details '.repeat(20)}`) });
  const payload = createDiscordPayload(value);
  assert.ok(payload.content.length <= 2000);
  assert.match(payload.content, /^\[TEST ROUTE\] SINGLE DISCORD TEST CHANNEL/);
  assert.match(payload.content, /Intended stock owner: Supplier Test/);
  assert.match(payload.content, /Intended owner email: supplier\\.test \[at\] stockflow\\.local/);
  assert.match(payload.content, /Supplier ID: 1/);
  assert.match(payload.content, /intended owner was not contacted/);
  assert.match(payload.content, /\[DETAILS TRUNCATED: additional records or text omitted\. Review StockFlow for the full grouped notification\.\]$/);
  assert.doesNotMatch(payload.content, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test('maximum accepted attribution stays visible even when the subject alone is oversized', () => {
  const value = notification();
  value.intendedRecipient.name = '*'.repeat(180);
  value.intendedRecipient.email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
  assert.equal(value.intendedRecipient.email.length, 254);
  value.subject = `[TEST ROUTE] ${'subject '.repeat(2000)}`;
  const payload = createDiscordPayload(value);
  assert.ok(payload.content.length <= 2000);
  assert.ok(payload.content.includes('Intended owner email: '));
  assert.ok(payload.content.includes('Supplier ID: 1'));
  assert.ok(payload.content.includes('Actual testing destination: configured Discord channel.'));
  assert.ok(payload.content.includes('DETAILS TRUNCATED'));
});

test('payloads can be reviewed offline while delivery remains explicitly disabled', () => {
  const report = planNotifications({
    deliveryMode: 'discord', notificationsEnabled: false, mailEnabled: true,
    products: [{ id: 11, supplierId: 1, quantity: 0, lowStockThreshold: 10, sku: 'DEMO', name: 'Demo stock' }],
    suppliers: [{ id: 1, user: { email: 'demo@stockflow.example.test' } }],
  });
  assert.equal(report.deliveryEnabled, false);
  assert.equal(report.notifications[0].deliveryEnabled, false);
  assert.ok(createDiscordPayload(report.notifications[0]).content.length <= 2000);
});

test('the payload builder serializes without module dependencies for an n8n Code node', () => {
  const embedded = new Function(`return (${createDiscordPayload.toString()});`)();
  const value = notification();
  assert.deepEqual(embedded(value), createDiscordPayload(value));
  assert.equal(embedded(value).content.includes('@'), false);
});
