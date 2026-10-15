/** Validate decrypted n8n Gmail data in memory and return only safe credential references. */
export function validateGmailCredential(credential, expectedId) {
  const fail = () => { throw new Error('Gmail must be connected with only gmail.send and offline refresh access before delivery can be enabled.'); };
  if (!credential || credential.type !== 'gmailOAuth2') fail();
  if (typeof credential.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(credential.id)) fail();
  if (expectedId !== undefined && credential.id !== expectedId) fail();
  if (typeof credential.name !== 'string' || !credential.name.trim() || /[\r\n\0]/.test(credential.name)) fail();
  const data = credential.data;
  const sendScope = 'https://www.googleapis.com/auth/gmail.send';
  if (data?.customScopes !== true || typeof data.enabledScopes !== 'string') fail();
  const configuredScopes = data.enabledScopes.trim().split(/\s+/);
  if (configuredScopes.length !== 1 || configuredScopes[0] !== sendScope) fail();
  const token = data.oauthTokenData;
  if (!token || typeof token !== 'object' || Array.isArray(token)) fail();
  if (![token.access_token, token.refresh_token].every(value => typeof value === 'string' && value.trim().length > 0)) fail();
  if (Object.hasOwn(token, 'scope')) {
    if (typeof token.scope !== 'string' || !token.scope.trim()) fail();
    const returnedScopes = token.scope.trim().split(/\s+/);
    const allowedScopes = new Set([sendScope, 'openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']);
    if (!returnedScopes.includes(sendScope) || returnedScopes.some(scope => !allowedScopes.has(scope))) fail();
  }
  return { id: credential.id, name: credential.name };
}
