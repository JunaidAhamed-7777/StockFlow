/** Pure rules shared by n8n Code nodes and offline tests. No AI or network calls. */
export function resolveDeliverySettings({ deliveryMode = 'preview', redirectTo, mailEnabled = false, notificationsEnabled = false } = {}) {
  if (!['preview', 'redirect', 'owner', 'discord'].includes(deliveryMode)) throw new Error('Unknown delivery mode; refusing to send notifications.');
  const target = typeof redirectTo === 'string' ? redirectTo.trim() : '';
  const validEmail = (email) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) && !/@(?:.*\.)?(?:example\.(?:com|org|net)|localhost|invalid|test|local)$/i.test(email) && !/\.(?:test|local|invalid|example)$/i.test(email);
  if (deliveryMode === 'redirect' && !validEmail(target)) throw new Error('Redirect mode requires one valid, deliverable redirectTo address; refusing to send mail.');
  return { deliveryMode, redirectTo: deliveryMode === 'redirect' ? target : undefined, mailEnabled: mailEnabled === true, notificationsEnabled: notificationsEnabled === true, deliveryEnabled: deliveryMode === 'discord' ? notificationsEnabled === true : deliveryMode !== 'preview' && mailEnabled === true };
}

export function createOwnerNotification({ supplier, mode, subject, lines = [], events = [], deliveryMode, redirectTo, mailEnabled, notificationsEnabled }) {
  const delivery = resolveDeliverySettings({ deliveryMode, redirectTo, mailEnabled, notificationsEnabled });
  const email = typeof supplier.user?.email === 'string' ? supplier.user.email.trim() : '';
  const validSyntax = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email);
  const reservedEmail = /@(?:.*\.)?(?:example\.(?:com|org|net)|localhost|invalid|test|local)$/i.test(email) || /\.(?:test|local|invalid|example)$/i.test(email);
  if (!validSyntax || (reservedEmail && !['redirect', 'discord'].includes(delivery.deliveryMode))) return null;
  const safe = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').slice(0, 180);
  const owner = safe(supplier.user?.name || supplier.companyName || 'Stock owner');
  const intendedRecipient = { supplierId: supplier.id, name: owner, email };
  const redirected = delivery.deliveryMode === 'redirect';
  const discord = delivery.deliveryMode === 'discord';
  const to = discord ? 'discord-channel' : redirected ? delivery.redirectTo : email;
  const routingNotice = discord ? [
    'SINGLE DISCORD TEST CHANNEL — owner delivery is disabled.',
    `Intended stock owner: ${owner}`,
    `Intended owner email: ${email}`,
    `Supplier ID: ${safe(supplier.id)}`,
    'Actual testing destination: configured Discord channel.',
    'The intended owner was not contacted. This notification is routed only to the single Discord test channel.',
    '',
  ] : redirected ? [
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
    subject: `${discord ? '[TEST ROUTE] ' : redirected ? '[REDIRECTED] ' : ''}${safe(subject)}`,
    message: [...routingNotice, `Hello ${owner},`, '', ...lines, '', 'Please review the current records in your StockFlow workspace before taking action.', 'This message uses recorded inventory and order data. It contains no AI predictions.', '', 'StockFlow Operations'].join('\n'),
    events, deliveryMode: delivery.deliveryMode, deliveryEnabled: delivery.deliveryEnabled, notificationsEnabled: delivery.notificationsEnabled,
  };
}

export function planNotifications(input) {
  const { products, suppliers, orders = [], mode = 'low-stock', state = {}, now = Date.now(), criticalRatio = 0.5, reminderHours = 24 } = input;
  const delivery = resolveDeliverySettings(input);
  if (!Array.isArray(products) || !Array.isArray(suppliers) || !Array.isArray(orders)) throw new Error('Invalid inventory response; refusing to generate notifications.');
  if (!['low-stock', 'daily-digest', 'stale-orders'].includes(mode)) throw new Error('Unknown notification mode.');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid notification time.');
  const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
  const ownerIds = new Set();
  for (const supplier of suppliers) {
    if (!supplier || !positiveId(supplier.id) || ownerIds.has(supplier.id)) throw new Error('Invalid or ambiguous owner directory; refusing notifications.');
    ownerIds.add(supplier.id);
  }
  const sent = state.sent || {};
  const ratio = Math.min(1, Math.max(0, Number(criticalRatio) || 0.5));
  const cooldown = Math.max(1, Number(reminderHours) || 24) * 3600000;
  const day = new Date(now).toISOString().slice(0, 10);
  const safe = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
  const productMap = new Map();
  const stock = products.map((product) => {
    if (!product || !positiveId(product.id) || !positiveId(product.supplierId)) throw new Error('Invalid stock values; refusing to send inaccurate alerts.');
    const quantity = product.quantity;
    const threshold = product.lowStockThreshold;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(threshold) || threshold < 0) throw new Error('Invalid stock values; refusing to send inaccurate alerts.');
    if (productMap.has(product.id) || !ownerIds.has(product.supplierId)) throw new Error('Invalid or ambiguous inventory ownership; refusing notifications.');
    productMap.set(product.id, product);
    return { ...product, quantity, lowStockThreshold: threshold };
  });
  if (mode === 'stale-orders') {
    const orderIds = new Set();
    for (const order of orders) {
      if (!order || !positiveId(order.id) || orderIds.has(order.id) || typeof order.status !== 'string' || !order.status.trim() || order.status.length > 80 || /[\r\n\t]/.test(order.status)
        || typeof order.createdAt !== 'string' || !Number.isFinite(Date.parse(order.createdAt)) || !Array.isArray(order.orderItems ?? order.items)) throw new Error('Invalid or ambiguous order response; refusing notifications.');
      orderIds.add(order.id);
      for (const item of order.orderItems ?? order.items) {
        const id = item?.productId ?? item?.product?.id;
        if (!positiveId(id) || !productMap.has(id) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Invalid order line or unknown product; refusing notifications.');
      }
    }
  }
  const notifications = [];
  const skipped = [];
  for (const supplier of suppliers) {
    const own = stock.filter((product) => product.supplierId === supplier.id);
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
        const ownItems = (order.orderItems ?? order.items).filter((item) => productMap.get(item.productId ?? item.product?.id).supplierId === supplier.id);
        if (!ownItems.length) continue;
        const key = `order:${supplier.id}:${order.id}`;
        if (sent[key] && now - sent[key].at < cooldown) continue;
        lines.push(`Order #${safe(order.id)} — ${safe(order.status)}, open since ${new Date(created).toISOString().slice(0, 10)}. Your items: ${ownItems.map((item) => {
          const product = productMap.get(item.productId ?? item.product?.id);
          return `${safe(product.sku || product.id)} × ${item.quantity}`;
        }).join(', ')}.`);
        events.push({ key, at: now });
      }
      subject = `StockFlow: ${lines.length} open ${lines.length === 1 ? 'order needs' : 'orders need'} follow-up`;
    }
    if (!events.length) continue;
    notifications.push(createOwnerNotification({ supplier, mode, subject, lines, events, ...delivery }));
  }
  return { notifications, skipped, checkedProducts: stock.length, mode, deliveryMode: delivery.deliveryMode, deliveryEnabled: delivery.deliveryEnabled, notificationsEnabled: delivery.notificationsEnabled };
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
