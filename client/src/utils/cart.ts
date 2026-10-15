export const MAX_QUANTITY = 2_147_483_647;

export interface CartItem {
  productId: number;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  stock: number;
}

export function isPositiveInteger(value: unknown): boolean {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_QUANTITY;
}

/** Browser cart data is a convenience cache; the server sets checkout prices. */
export function sanitizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const items = new Map<number, CartItem>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (![row.productId, row.quantity, row.stock].every(isPositiveInteger)) continue;
    if (typeof row.price !== "number" && (typeof row.price !== "string" || !row.price.trim())) continue;
    const productId = Number(row.productId);
    const price = Number(row.price);
    const quantity = Number(row.quantity);
    const stock = Number(row.stock);
    if (!isPositiveInteger(productId) || !isPositiveInteger(quantity) || !isPositiveInteger(stock)) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    const existing = items.get(productId);
    items.set(productId, {
      productId,
      name: typeof row.name === "string" ? row.name.slice(0, 255) : "Product",
      sku: typeof row.sku === "string" ? row.sku.slice(0, 100) : "",
      price,
      quantity: Math.min(stock, MAX_QUANTITY, (existing?.quantity || 0) + quantity),
      stock,
    });
  }
  return [...items.values()];
}
