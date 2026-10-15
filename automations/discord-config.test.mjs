import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseDiscordWebhookUrl, validateDiscordCredential, assertConfirmedDiscordTest } from './discord-config.mjs';

const WEBHOOK_ID = '123456789012345678';
const TOKEN = 'SyntheticTokenUsedForOfflineTestsOnly_1234567890-abcdefghijklmnopqrstuvwxyz';
const WEBHOOK = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${TOKEN}`;
const V10_WEBHOOK = WEBHOOK.replace('/api/', '/api/v10/');
const credential = (overrides = {}) => ({ id: 'StockFlowDiscord01', name: 'StockFlow private alert channel', type: 'discordWebhookApi', data: { webhookUri: WEBHOOK }, ...overrides });
const reference = () => validateDiscordCredential(credential());
const marker = (overrides = {}) => ({ status: 'confirmed', webhookFingerprint: reference().webhookFingerprint, channelId: '223456789012345678', messageIds: ['323456789012345678'], ...overrides });

test('canonical incoming webhook URLs are accepted without adding wait or changing the channel', () => {
  assert.equal(parseDiscordWebhookUrl(WEBHOOK), WEBHOOK);
  assert.equal(parseDiscordWebhookUrl(V10_WEBHOOK), V10_WEBHOOK);
  assert.equal(parseDiscordWebhookUrl(WEBHOOK.replace(WEBHOOK_ID, '18446744073709551615')), WEBHOOK.replace(WEBHOOK_ID, '18446744073709551615'));
  assert.ok(!parseDiscordWebhookUrl(WEBHOOK).includes('?'));
});

test('other origins, injected URLs, redirect queries, path tricks, and noncanonical endpoints are rejected', () => {
  for (const value of [
    undefined, null, false, {}, [], new URL(WEBHOOK), '',
    WEBHOOK.replace('https:', 'http:'), WEBHOOK.replace('https:', 'HTTPS:'),
    WEBHOOK.replace('discord.com', 'DISCORD.com'), WEBHOOK.replace('discord.com', 'discordapp.com'),
    WEBHOOK.replace('discord.com', 'discord.com.evil.example'), WEBHOOK.replace('discord.com', 'evil.example/discord.com'),
    WEBHOOK.replace('discord.com', 'localhost'), WEBHOOK.replace('discord.com', '127.0.0.1'),
    WEBHOOK.replace('discord.com', '[::1]'), WEBHOOK.replace('discord.com', 'host.docker.internal'),
    WEBHOOK.replace('discord.com', 'discord.com:443'), WEBHOOK.replace('discord.com', 'user:password@discord.com'),
    `${WEBHOOK}?wait=true`, `${WEBHOOK}?thread_id=123456789012345678`, `${WEBHOOK}?redirect=https://evil.example`, `${WEBHOOK}#fragment`,
    ` ${WEBHOOK}`, `${WEBHOOK} `, `${WEBHOOK}\n`, `${WEBHOOK}\r\nAuthorization: secret`, `${WEBHOOK}\0`,
    `${WEBHOOK},${WEBHOOK}`, `${WEBHOOK};${WEBHOOK}`, `${WEBHOOK}/`,
    WEBHOOK.replace('/api/', '/api/v9/'), WEBHOOK.replace('/api/', '/foo/../api/'),
    WEBHOOK.replace('/api/', '//api/'), WEBHOOK.replace('/api/', '/%61pi/'),
    WEBHOOK.replace(TOKEN, 'too-short'), WEBHOOK.replace(TOKEN, `${TOKEN}%2Fmore`),
    WEBHOOK.replace(WEBHOOK_ID, '0'), WEBHOOK.replace(WEBHOOK_ID, '012345678901234567'),
    WEBHOOK.replace(WEBHOOK_ID, '18446744073709551616'), WEBHOOK.replace(WEBHOOK_ID, '123456789012345678901'),
  ]) {
    assert.throws(() => parseDiscordWebhookUrl(value), /canonical HTTPS Discord/);
  }
});

test('credential validation returns only the safe ID, display name, and canonical URL fingerprint', () => {
  const original = credential();
  const before = JSON.stringify(original);
  const result = validateDiscordCredential(original, original.id);
  assert.deepEqual(result, { id: original.id, name: original.name, webhookFingerprint: createHash('sha256').update(WEBHOOK).digest('hex') });
  assert.doesNotMatch(JSON.stringify(result), /https:|SyntheticToken|webhookUri/);
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(validateDiscordCredential(credential({ data: { webhookUri: V10_WEBHOOK } })).webhookFingerprint, result.webhookFingerprint);
});

test('wrong, incomplete, injected, or invalid credential data fails without exposing secrets', () => {
  for (const value of [
    undefined, null, {}, credential({ type: 'discordBotApi' }), credential({ type: 'gmailOAuth2' }),
    credential({ id: '' }), credential({ id: '../other' }), credential({ id: 'a'.repeat(65) }),
    credential({ name: '' }), credential({ name: '  ' }), credential({ name: 'alert\r\nBcc: someone' }),
    credential({ data: undefined }), credential({ data: {} }), credential({ data: { webhookUri: `${WEBHOOK}?wait=true` } }),
    credential({ data: { webhookUri: 'http://localhost/private' } }),
  ]) {
    assert.throws(() => validateDiscordCredential(value), (error) => {
      assert.match(error.message, /Discord Webhook credential/);
      assert.doesNotMatch(error.message, /https?:|SyntheticToken|Bcc:|localhost|private-alert/);
      return true;
    });
  }
  assert.throws(() => validateDiscordCredential(credential(), 'AnotherCredential'), /Discord Webhook credential/);
  assert.throws(() => parseDiscordWebhookUrl(`${WEBHOOK}?secret=${TOKEN}`), (error) => !error.message.includes(TOKEN) && !error.message.includes(WEBHOOK));
});

test('activation requires a confirmed response bound to this exact webhook and real-shaped Discord IDs', () => {
  assert.deepEqual(assertConfirmedDiscordTest(marker(), reference()), { channelId: '223456789012345678', messageIds: ['323456789012345678'] });
  assert.doesNotThrow(() => assertConfirmedDiscordTest(marker({ credentialId: reference().id }), reference()));
  for (const value of [
    undefined, null, {}, marker({ status: 'preview' }), marker({ status: true }),
    marker({ webhookFingerprint: 'a'.repeat(64) }), marker({ credentialId: 'DifferentCredential' }),
    marker({ channelId: undefined }), marker({ channelId: 223456789012345678 }), marker({ channelId: 'mock-channel' }),
    marker({ channelId: '18446744073709551616' }), marker({ messageIds: [] }), marker({ messageIds: undefined }),
    marker({ messageIds: ['mock-id'] }), marker({ messageIds: [323456789012345678] }),
    marker({ messageIds: ['323456789012345678', '323456789012345678'] }),
    marker({ messageIds: Array.from({ length: 101 }, (_, i) => String(323456789012345678n + BigInt(i))) }),
  ]) assert.throws(() => assertConfirmedDiscordTest(value, reference()), /confirmed Discord test/);
  for (const value of [undefined, {}, { ...reference(), id: '' }, { ...reference(), webhookFingerprint: 'not-a-hash' }]) {
    assert.throws(() => assertConfirmedDiscordTest(marker(), value), /confirmed Discord test/);
  }
});

test('confirmed IDs are copied and errors never echo marker values or webhook secrets', () => {
  const original = marker();
  const result = assertConfirmedDiscordTest(original, reference());
  result.messageIds.push('423456789012345678');
  assert.equal(original.messageIds.length, 1);
  assert.throws(() => assertConfirmedDiscordTest(marker({ channelId: WEBHOOK, messageIds: [TOKEN] }), reference()), (error) => !error.message.includes(TOKEN) && !error.message.includes(WEBHOOK));
});
