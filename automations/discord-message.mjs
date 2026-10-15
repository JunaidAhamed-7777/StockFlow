/** Pure, self-contained Discord body builder. Webhook URLs and credentials belong only to the transport. */
export function createDiscordPayload(notification) {
  const refuse = () => { throw new Error('Invalid single-channel Discord notification; refusing to create a payload.'); };
  const owner = notification?.intendedRecipient;
  if (notification?.kind !== 'notification' || notification.deliveryMode !== 'discord' || notification.to !== 'discord-channel') refuse();
  if (!owner || !Number.isSafeInteger(owner.supplierId) || owner.supplierId < 0 || notification.supplierId !== owner.supplierId) refuse();
  if (typeof owner.name !== 'string' || !owner.name.trim() || owner.name.length > 180 || typeof owner.email !== 'string' || owner.email.length > 254) refuse();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(owner.email)) refuse();
  if (typeof notification.subject !== 'string' || !notification.subject.startsWith('[TEST ROUTE] ') || typeof notification.message !== 'string' || !notification.message.trim()) refuse();
  const clean = (value, singleLine = false) => {
    const plain = String(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').replaceAll('<', '‹').replaceAll('>', '›');
    const markdown = new Set('\\`*_~|[]()#+.!-');
    // n8n's native Discord node does not expose allowed_mentions. Remove every ASCII @,
    // including owner-email separators, so no mention syntax can reach the transport.
    const escaped = [...plain].map(char => char === '@' ? ' [at] ' : markdown.has(char) ? `\\${char}` : char).join('');
    return singleLine ? escaped.replace(/\n+/g, ' ') : escaped;
  };
  if (!clean(owner.name, true).trim()) refuse();
  const header = [
    '[TEST ROUTE] SINGLE DISCORD TEST CHANNEL',
    `Intended stock owner: ${clean(owner.name, true)}`,
    `Intended owner email: ${clean(owner.email, true)}`,
    `Supplier ID: ${owner.supplierId}`,
    'Actual testing destination: configured Discord channel.',
    'The intended owner was not contacted. This post uses the single Discord test channel only.',
    '',
  ].join('\n');
  // The transport header already contains routing attribution. Keep the useful records
  // rather than repeating the planner's introductory routing block in a short Discord post.
  const divider = notification.message.indexOf('\n\n');
  const body = notification.message.startsWith('SINGLE DISCORD TEST CHANNEL') && divider >= 0 ? notification.message.slice(divider + 2) : notification.message;
  const details = `${clean(notification.subject, true)}\n\n${clean(body)}`;
  const truncation = '\n\n[DETAILS TRUNCATED: additional records or text omitted. Review StockFlow for the full grouped notification.]';
  let content = `${header}${details}`;
  if (content.length > 2000) {
    const budget = 2000 - header.length - truncation.length;
    if (budget < 0) refuse();
    const shortened = details.slice(0, budget).replace(/[\uD800-\uDBFF]$/, '').replace(/\\+$/, '');
    content = `${header}${shortened}${truncation}`;
  }
  if (content.includes('@')) refuse();
  return { content, flags: 4, tts: false };
}
