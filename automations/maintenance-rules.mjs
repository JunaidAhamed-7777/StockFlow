import { createOwnerNotification, resolveDeliverySettings } from './notification-rules.mjs';

/** Deterministic read-only audit and order-change rules, also embedded in n8n Code nodes. */
export function planMaintenanceNotifications(input) {
  const { products, suppliers, categories = [], orders = [], mode, state = {}, now = Date.now(), auditRecipientEmail = 'admin.test@stockflow.local' } = input;
  const delivery = resolveDeliverySettings(input);
  if (!['inventory-audit', 'order-updates'].includes(mode)) throw new Error('Unknown maintenance notification mode.');
  if (![products, suppliers, categories, orders].every(Array.isArray)) throw new Error('Invalid maintenance response; refusing to generate notifications.');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid notification time.');
  const safe = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 180);
  const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
  const present = (value) => typeof value === 'string' && value.trim().length > 0;
  const sent = state.sent || {};
  const report = { notifications: [], skipped: [], mode, checkedProducts: products.length, checkedOrders: orders.length, deliveryMode: delivery.deliveryMode, deliveryEnabled: delivery.deliveryEnabled };

  if (mode === 'inventory-audit') {
    const issues = [];
    const owners = new Map(suppliers.filter((owner) => owner && positiveId(owner.id)).map((owner) => [owner.id, owner]));
    const categoryIds = new Set(categories.filter((category) => category && positiveId(category.id)).map((category) => category.id));
    const ids = new Set();
    const skus = new Map();
    for (const [index, value] of products.entries()) {
      const product = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const owner = owners.get(product.supplierId);
      const label = positiveId(product.id) ? `Product #${product.id} (${safe(product.sku) || 'missing SKU'})` : `Product row ${index + 1}`;
      const ownerDetail = owner ? `Owner: ${safe(owner.companyName || owner.user?.name || 'unnamed supplier')} (supplier #${owner.id}, ${safe(owner.user?.email || 'missing email')})` : `Owner: unresolved supplier ${safe(product.supplierId) || '(missing)'}`;
      const issue = (type, message) => issues.push({ type, productId: positiveId(product.id) ? product.id : null, supplierId: positiveId(product.supplierId) ? product.supplierId : null, message: `${label}: ${message}. ${ownerDetail}.` });
      if (!positiveId(product.id)) issue('invalid-product-id', 'invalid or missing product identifier');
      else if (ids.has(product.id)) issue('duplicate-product-id', 'duplicate product identifier in the API response');
      ids.add(product.id);
      if (!present(product.name)) issue('missing-name', 'product name is missing');
      if (!present(product.sku)) issue('missing-sku', 'SKU is missing');
      else {
        const normalized = product.sku.trim().toLowerCase();
        if (skus.has(normalized)) issue('duplicate-sku', `SKU matches product #${safe(skus.get(normalized))} after trimming and case normalization`);
        else skus.set(normalized, product.id);
      }
      if (typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price < 0) issue('invalid-price', 'price must be a finite non-negative number');
      if (!Number.isSafeInteger(product.quantity) || product.quantity < 0) issue('invalid-quantity', 'stock quantity must be a non-negative integer');
      if (!Number.isSafeInteger(product.lowStockThreshold) || product.lowStockThreshold < 0) issue('invalid-threshold', 'reorder threshold must be a non-negative integer');
      if (!positiveId(product.supplierId) || !owner) issue('unknown-owner', 'supplier is missing or absent from the owner directory');
      else if (!present(owner.user?.email)) issue('missing-owner-email', 'stock owner has no email recorded');
      if (!positiveId(product.categoryId) || !categoryIds.has(product.categoryId)) issue('unknown-category', 'category is missing or absent from the category directory');
    }
    report.issues = issues;
    // Monday-based week in Asia/Kolkata; manual retries within the same week do not duplicate a delivered audit.
    const localDate = new Date(now + 330 * 60 * 1000);
    localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() + 6) % 7));
    const week = localDate.toISOString().slice(0, 10);
    const key = 'inventory-audit:admin';
    if (!issues.length || sent[key]?.week === week) return report;
    const supplier = { id: 0, companyName: 'StockFlow administrator', user: { name: 'StockFlow administrator', email: auditRecipientEmail } };
    const lines = [
      'Inventory data-quality audit for the StockFlow administrator (not an individual supplier).',
      `${issues.length} recorded data ${issues.length === 1 ? 'issue' : 'issues'} across ${products.length} products. No records were modified.`,
      ...issues.slice(0, 100).map((issue) => issue.message),
      ...(issues.length > 100 ? [`${issues.length - 100} additional issues omitted from this email. Review all records in StockFlow.`] : []),
      'These are rule-based data checks. A normalized SKU match is a review flag, not proof that two products are the same.',
    ];
    const notification = createOwnerNotification({ supplier, mode, subject: `StockFlow: ${issues.length} inventory data issues for review`, lines, events: [{ key, week, at: now }], ...delivery });
    if (notification) report.notifications.push(notification);
    else report.skipped.push({ supplierId: 0, reason: 'Missing or non-deliverable administrator email' });
    return report;
  }

  const productMap = new Map();
  for (const product of products) {
    if (!product || !positiveId(product.id) || !positiveId(product.supplierId) || productMap.has(product.id)) throw new Error('Invalid or ambiguous inventory ownership; refusing order notifications.');
    productMap.set(product.id, product);
  }
  const ownerIds = new Set();
  for (const supplier of suppliers) {
    if (!supplier || !positiveId(supplier.id) || ownerIds.has(supplier.id)) throw new Error('Invalid or ambiguous owner directory; refusing order notifications.');
    ownerIds.add(supplier.id);
  }
  for (const product of productMap.values()) {
    if (!ownerIds.has(product.supplierId)) throw new Error('Invalid inventory ownership; refusing order notifications.');
  }
  const orderIds = new Set();
  for (const order of orders) {
    if (!order || !positiveId(order.id) || orderIds.has(order.id) || !present(order.status) || order.status.length > 80 || /[\r\n\t]/.test(order.status) || !Array.isArray(order.orderItems ?? order.items)) throw new Error('Invalid order response; refusing order notifications.');
    orderIds.add(order.id);
    for (const item of order.orderItems ?? order.items) {
      const id = item?.productId ?? item?.product?.id;
      if (!positiveId(id) || !productMap.has(id) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('Invalid order line or unknown product; refusing order notifications.');
    }
  }
  const baseline = state.orderBaseline;
  if (baseline === undefined) {
    // The first valid observation establishes history without emailing historical orders.
    report.orderBaseline = { initializedAt: now, statuses: Object.fromEntries(orders.map((order) => [order.id, order.status])) };
    report.note = 'Initial order baseline only. Historical orders will not generate emails.';
    return report;
  }
  if (!baseline || !baseline.statuses || typeof baseline.statuses !== 'object' || Array.isArray(baseline.statuses)) throw new Error('Invalid remembered order baseline; refusing order notifications.');

  for (const supplier of suppliers) {
    const lines = [];
    const events = [];
    let deferredOrders = 0;
    for (const order of orders) {
      const ownItems = (order.orderItems ?? order.items).filter((item) => productMap.get(item.productId ?? item.product?.id).supplierId === supplier.id);
      if (!ownItems.length) continue;
      const key = `order-update:${supplier.id}:${order.id}`;
      const previous = sent[key]?.status ?? baseline.statuses[order.id];
      if (previous === order.status) continue;
      if (events.length >= 50) { deferredOrders += 1; continue; }
      const statusChange = previous === undefined ? `New order recorded as ${safe(order.status)}` : `${safe(previous)} → ${safe(order.status)}`;
      // Use catalog data for labels and ownership, rather than accepting nested line-item owner fields.
      const items = ownItems.slice(0, 50).map((item) => {
        const product = productMap.get(item.productId ?? item.product?.id);
        return `${safe(product.sku || product.id)} × ${item.quantity}`;
      }).join(', ');
      lines.push(`Order #${order.id}: ${statusChange}. Your items: ${items}${ownItems.length > 50 ? `; ${ownItems.length - 50} more of your lines omitted` : ''}.`);
      events.push({ key, orderId: order.id, status: order.status, at: now });
    }
    if (!events.length) continue;
    if (deferredOrders) lines.push(`${deferredOrders} further order updates will be considered on the next scheduled check to keep this email manageable.`);
    lines.push('This is the latest status observed during polling. Intermediate changes between checks may not be captured.');
    const notification = createOwnerNotification({ supplier, mode, subject: `StockFlow: ${events.length} new or changed ${events.length === 1 ? 'order' : 'orders'}`, lines, events, ...delivery });
    if (notification) report.notifications.push(notification);
    else report.skipped.push({ supplierId: supplier.id, reason: 'Missing or non-deliverable owner email' });
  }
  return report;
}

/** Persist only first-run observation; later status markers use recordSuccessfulDelivery after Gmail confirms success. */
export function rememberInitialOrderBaseline(state, report) {
  if (report.mode === 'order-updates' && report.orderBaseline && state.orderBaseline === undefined) {
    state.orderBaseline = { initializedAt: report.orderBaseline.initializedAt, statuses: { ...report.orderBaseline.statuses } };
  }
  return state;
}
