import { createHash } from 'node:crypto';

const validCredentialId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const validSnowflake = (value) => typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
const validFingerprint = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Parse only a canonical incoming Discord webhook URL. Never include rejected input in errors. */
export function parseDiscordWebhookUrl(value) {
  const fail = () => { throw new Error('A canonical HTTPS Discord incoming webhook URL is required. Its secret value was withheld.'); };
  if (typeof value !== 'string' || value.length > 512) fail();
  const match = /^https:\/\/discord\.com\/api(?:\/v10)?\/webhooks\/([1-9]\d{16,19})\/([a-zA-Z0-9_-]{30,200})$/.exec(value);
  if (!match || !validSnowflake(match[1])) fail();
  return value;
}

/** Validate decrypted n8n data in memory, returning a reference/fingerprint with no webhook secret. */
export function validateDiscordCredential(credential, expectedId) {
  const fail = () => { throw new Error('A valid encrypted n8n Discord Webhook credential is required. Credential secrets were withheld.'); };
  if (!credential || credential.type !== 'discordWebhookApi' || !validCredentialId(credential.id)) fail();
  if (expectedId !== undefined && credential.id !== expectedId) fail();
  if (typeof credential.name !== 'string' || !credential.name.trim() || credential.name.length > 200 || /[\u0000-\u001f\u007f]/.test(credential.name)) fail();
  let webhookUri;
  try { webhookUri = parseDiscordWebhookUrl(credential.data?.webhookUri); } catch { fail(); }
  return { id: credential.id, name: credential.name, webhookFingerprint: createHash('sha256').update(webhookUri).digest('hex') };
}

/** Require a previous real Discord response for this exact webhook before scheduled activation. */
export function assertConfirmedDiscordTest(marker, credential) {
  const fail = () => { throw new Error('A confirmed Discord test for this exact webhook, with message and channel IDs, is required before activation.'); };
  if (!credential || !validCredentialId(credential.id) || !validFingerprint(credential.webhookFingerprint)) fail();
  if (!marker || marker.status !== 'confirmed' || marker.webhookFingerprint !== credential.webhookFingerprint || !validSnowflake(marker.channelId)) fail();
  if (Object.hasOwn(marker, 'credentialId') && marker.credentialId !== credential.id) fail();
  if (!Array.isArray(marker.messageIds) || marker.messageIds.length < 1 || marker.messageIds.length > 100 || !marker.messageIds.every(validSnowflake) || new Set(marker.messageIds).size !== marker.messageIds.length) fail();
  return { channelId: marker.channelId, messageIds: [...marker.messageIds] };
}
