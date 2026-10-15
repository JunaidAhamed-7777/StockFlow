/** Pure rules shared by n8n Code nodes and offline tests. No AI or network calls. */
export function resolveDeliverySettings({ deliveryMode = 'preview', redirectTo, mailEnabled = false } = {}) {
  if (!['preview', 'redirect', 'owner'].includes(deliveryMode)) throw new Error('Unknown delivery mode; refusing to send mail.');
  const target = typeof redirectTo === 'string' ? redirectTo.trim() : '';
  const validEmail = (email) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) && !/@(?:.*\.)?(?:example\.(?:com|org|net)|localhost|invalid|test|local)$/i.test(email) && !/\.(?:test|local|invalid|example)$/i.test(email);
  if (deliveryMode === 'redirect' && !validEmail(target)) throw new Error('Redirect mode requires one valid, deliverable redirectTo address; refusing to send mail.');
  return { deliveryMode, redirectTo: deliveryMode === 'redirect' ? target : undefined, mailEnabled: mailEnabled === true, deliveryEnabled: deliveryMode !== 'preview' && mailEnabled === true };
}

export function createOwnerNotification({ supplier, mode, subject, lines = [], events = [], deliveryMode, redirectTo, mailEnabled }) {
  const delivery = resolveDeliverySettings({ deliveryMode, redirectTo, mailEnabled });
  const email = typeof supplier.user?.email === 'string' ? supplier.user.email.trim() : '';
  const validSyntax = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email);
  const reservedEmail = /@(?:.*\.)?(?:example\.(?:com|org|net)|localhost|invalid|test|local)$/i.test(email) || /\.(?:test|local|invalid|example)$/i.test(email);
  if (!validSyntax || (reservedEmail && delivery.deliveryMode !== 'redirect')) return null;
  const safe = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
  const owner = safe(supplier.user?.name || supplier.companyName || 'Stock owner');
  const intendedRecipient = { supplierId: supplier.id, name: owner, email };
  const redirected = delivery.deliveryMode === 'redirect';
  const to = redirected ? delivery.redirectTo : email;
  const routingNotice = redirected ? [
    'REDIRECTED STOCKFLOW EMAIL — owner delivery is disabled.',
    `Intended stock owner: ${owner}`,
    `Intended owner email: ${email}`,
    `Supplier ID: ${safe(supplier.id)}`,
    `Actual testing destination: ${to}`,
    'This email was redirected for testing. The intended owner was not emailed.',
    '',
  ] : [];
  return {
    kind: 'notification', mode, to, supplierId: supplier.id, intendedRecipient,
    subject: `${redirected ? '[REDIRECTED] ' : ''}${safe(subject)}`,
    message: [...routingNotice, `Hello ${owner},`, '', ...lines, '', 'Please review the current records in your StockFlow workspace before taking action.', 'This message uses recorded inventory and order data. It contains no AI predictions.', '', 'StockFlow Operations'].join('\n'),
    events, deliveryMode: delivery.deliveryMode, deliveryEnabled: delivery.deliveryEnabled,
  };
}

export function planNotifications(input) {
  const { products, suppliers, orders = [], mode = 'low-stock', state = {}, now = Date.now(), criticalRatio = 0.5, reminderHours = 24 } = input;
  const delivery = resolveDeliverySettings(input);
  if (!Array.isArray(products) || !Array.isArray(suppliers) || !Array.isArray(orders)) throw new Error('Invalid inventory response; refusing to generate notifications.');
  if (!['low-stock', 'daily-digest', 'stale-orders'].includes(mode)) throw new Error('Unknown notification mode.');
  const sent = state.sent || {};
  const ratio = Math.min(1, Math.max(0, Number(criticalRatio) || 0.5));
  const cooldown = Math.max(1, Number(reminderHours) || 24) * 3600000;
  const day = new Date(now).toISOString().slice(0, 10);
  const safe = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
  const stock = products.map((product) => {
    const quantity = product.quantity;
    const threshold = product.lowStockThreshold;
    if (!Number.isSafeInteger(product.id) || product.id <= 0 || !Number.isSafeInteger(product.supplierId) || product.supplierId <= 0 || !Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(threshold) || threshold < 0) throw new Error('Invalid stock values; refusing to send inaccurate alerts.');
    return { ...product, quantity, lowStockThreshold: threshold };
  });
  const notifications = [];
  const skipped = [];
  for (const supplier of suppliers) {
    const own = stock.filter((product) => Number(product.supplierId) === Number(supplier.id));
    if (!own.length) continue;
    if (!createOwnerNotification({ supplier, mode, subject: '', ...delivery })) { skipped.push({ supplierId: supplier.id, reason: 'Missing or non-deliverable owner email' }); continue; }
    let lines = [];
    let events = [];
    let subject = '';
    if (mode === 'low-stock') {
      for (const product of own) {
        const isCritical = product.quantity === 0 || product.quantity <= Math.floor(product.lowStockThreshold * ratio);
        if (!isCritical) continue;
        const level = product.quantity === 0 ? 'out' : 'critical';
        const key = `stock:${supplier.id}:${product.id}`;
        const previous = sent[key];
        const escalated = level === 'out' && previous?.level !== 'out';
        if (previous && !escalated && now - previous.at < cooldown) continue;
        lines.push(`${safe(product.sku)} — ${safe(product.name)}: ${product.quantity} remaining (reorder threshold ${product.lowStockThreshold}).`);
        events.push({ key, level, at: now });
      }
      subject = `StockFlow: ${lines.length} critical stock ${lines.length === 1 ? 'item' : 'items'} needs attention`;
    } else if (mode === 'daily-digest') {
      const key = `digest:${supplier.id}`;
      if (sent[key]?.day === day) continue;
      const low = own.filter((product) => product.quantity <= product.lowStockThreshold);
      lines = [`${own.length} products; ${own.reduce((total, product) => total + product.quantity, 0)} units in stock.`, `${low.length} products at or below their reorder threshold.`];
      lines.push(...low.slice(0, 100).map((product) => `${safe(product.sku)} — ${safe(product.name)}: ${product.quantity} remaining; threshold ${product.lowStockThreshold}.`));
      subject = `StockFlow: inventory digest for ${day}`;
      events = [{ key, day, at: now }];
    } else {
      for (const order of orders) {
        if (!['PENDING', 'PROCESSING'].includes(order.status)) continue;
        const created = Date.parse(order.createdAt);
        if (!Number.isFinite(created) || now - created < 48 * 3600000) continue;
        const ownItems = (order.orderItems || order.items || []).filter((item) => own.some((product) => Number(product.id) === Number(item.productId ?? item.product?.id)));
        if (!ownItems.length) continue;
        const key = `order:${supplier.id}:${order.id}`;
        if (sent[key] && now - sent[key].at < cooldown) continue;
        lines.push(`Order #${safe(order.id)} — ${safe(order.status)}, open since ${new Date(created).toISOString().slice(0, 10)}. Your items: ${ownItems.map((item) => `${safe(item.product?.sku || item.productId)} × ${safe(item.quantity)}`).join(', ')}.`);
        events.push({ key, at: now });
      }
      subject = `StockFlow: ${lines.length} open ${lines.length === 1 ? 'order needs' : 'orders need'} follow-up`;
    }
    if (!events.length) continue;
    notifications.push(createOwnerNotification({ supplier, mode, subject, lines, events, ...delivery }));
  }
  return { notifications, skipped, checkedProducts: stock.length, mode, deliveryMode: delivery.deliveryMode, deliveryEnabled: delivery.deliveryEnabled };
}

export function recordSuccessfulDelivery(state, notification) {
  if (!notification?.events?.length) throw new Error('Cannot record an empty notification.');
  state.sent ||= {};
  for (const event of notification.events) state.sent[event.key] = { ...event };
  return state;
}

export function clearRecoveredStock(state, products, criticalRatio = 0.5) {
  const ratio = Math.min(1, Math.max(0, Number(criticalRatio) || 0.5));
  for (const product of products) {
    if (Number.isSafeInteger(product.quantity) && Number.isSafeInteger(product.lowStockThreshold) && product.quantity > Math.floor(product.lowStockThreshold * ratio)) {
      delete state.sent?.[`stock:${product.supplierId}:${product.id}`];
    }
  }
  return state;
}
