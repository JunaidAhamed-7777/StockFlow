import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGmailCredential } from './gmail-config.mjs';

const SEND = 'https://www.googleapis.com/auth/gmail.send';
const credential = () => ({
  id: 'stockflow-gmail-01', name: 'StockFlow send-only Gmail', type: 'gmailOAuth2',
  data: {
    customScopes: true, enabledScopes: SEND,
    clientId: 'private-client-id', clientSecret: 'private-client-secret',
    oauthTokenData: { access_token: 'private-access-token', refresh_token: 'private-refresh-token', scope: SEND },
  },
});
const rejected = (value, expectedId) => assert.throws(() => validateGmailCredential(value, expectedId), /only gmail.send and offline refresh/);

test('valid send-only credentials return a fresh reference with no decrypted secrets', () => {
  const source = credential();
  const before = structuredClone(source);
  const result = validateGmailCredential(source, source.id);
  assert.deepEqual(result, { id: source.id, name: source.name });
  assert.notEqual(result, source);
  assert.deepEqual(source, before);
  assert.doesNotMatch(JSON.stringify(result), /private-|oauthTokenData|clientSecret|access_token|refresh_token/);
});

test('only the expected Gmail OAuth credential type and safe identity are accepted', () => {
  for (const value of [undefined, null, {}, false, { ...credential(), type: 'googleOAuth2Api' }, { ...credential(), type: 'gmail' }]) rejected(value);
  for (const id of [undefined, null, '', [], {}, 'has a space', 'header\ninjection', 'x'.repeat(65)]) rejected({ ...credential(), id });
  for (const name of [undefined, null, '', '  ', [], {}, 'label\r\ninjection', 'label\0injection']) rejected({ ...credential(), name });
  rejected(credential(), 'different-credential');
});

test('configured scopes require strict customScopes true and exactly gmail.send', () => {
  for (const customScopes of [undefined, null, false, 'true', 1, {}, []]) {
    const value = credential();
    value.data.customScopes = customScopes;
    rejected(value);
  }
  for (const enabledScopes of [
    undefined, null, '', [], {}, 'gmail.send', SEND.toUpperCase(),
    `${SEND} openid`, `${SEND} ${SEND}`, `${SEND} https://www.googleapis.com/auth/gmail.readonly`,
    'https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.modify',
  ]) {
    const value = credential();
    value.data.enabledScopes = enabledScopes;
    rejected(value);
  }
  const value = credential();
  value.data.enabledScopes = ` \n${SEND}\t `;
  assert.equal(validateGmailCredential(value).id, value.id);
});

test('both access and refresh tokens must be nonempty strings', () => {
  for (const oauthTokenData of [undefined, null, '', [], false]) {
    const value = credential();
    value.data.oauthTokenData = oauthTokenData;
    rejected(value);
  }
  for (const field of ['access_token', 'refresh_token']) {
    for (const token of [undefined, null, '', ' \r\n\t ', false, 1, {}, ['token']]) {
      const value = credential();
      value.data.oauthTokenData[field] = token;
      rejected(value);
    }
  }
});

test('returned Google scopes may add only identity permissions to gmail.send', () => {
  for (const scope of [
    SEND, `${SEND} openid email profile`,
    `profile\n${SEND}\temail openid`,
    `${SEND} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
  ]) {
    const value = credential();
    value.data.oauthTokenData.scope = scope;
    assert.equal(validateGmailCredential(value).id, value.id);
  }
});

test('a previously broad authorization is rejected despite send-only configured scopes', () => {
  for (const extraScope of [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/gmail.send.evil',
  ]) {
    const value = credential();
    value.data.oauthTokenData.scope = `${SEND} ${extraScope}`;
    rejected(value);
  }
});

test('ambiguous returned scope metadata fails closed while absent metadata is supported', () => {
  for (const scope of [undefined, null, '', '  ', [], {}, true, 1, 'openid email profile']) {
    const value = credential();
    value.data.oauthTokenData.scope = scope;
    rejected(value);
  }
  const value = credential();
  delete value.data.oauthTokenData.scope;
  assert.equal(validateGmailCredential(value).id, value.id);
});

test('validation errors never expose credential values', () => {
  const value = credential();
  value.data.oauthTokenData.scope = `${SEND} https://mail.google.com/`;
  try {
    validateGmailCredential(value);
    assert.fail('Expected rejection of a broad token');
  } catch (error) {
    assert.doesNotMatch(error.message, /private-|stockflow-gmail-01|oauthTokenData|clientSecret|access_token|refresh_token/);
  }
});
