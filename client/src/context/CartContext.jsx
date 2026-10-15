import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CART_KEY, readStorage, writeStorage } from "../utils/storage";
import { useAuth } from "./AuthContext";
import { isPositiveInteger, sanitizeCart } from "../utils/cart";

const CartContext = createContext(null);

function cartStorageKey(userId) {
  return `${CART_KEY}.${userId || "guest"}`;
}

function loadCart(key) {
  return sanitizeCart(readStorage(key, []));
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const storageKey = cartStorageKey(user?.id);
  const [cart, setCart] = useState(() => ({ key: storageKey, items: loadCart(storageKey) }));
  // Never expose the previous account's cart during a session change.
  const items = cart.key === storageKey ? cart.items : loadCart(storageKey);

  useEffect(() => {
    setCart({ key: storageKey, items: loadCart(storageKey) });
  }, [storageKey]);

  const changeItems = useCallback((update) => {
    setCart((current) => {
      const source = current.key === storageKey ? current.items : loadCart(storageKey);
      const next = sanitizeCart(update(source));
      writeStorage(storageKey, next);
      return { key: storageKey, items: next };
    });
  }, [storageKey]);

  const addItem = useCallback(
    (product, quantity = 1) => {
      if (!product || !isPositiveInteger(product.id) || !isPositiveInteger(quantity) || !isPositiveInteger(product.quantity)) return false;
      const qty = Number(quantity);
      const available = Number(product.quantity);
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) return false;
      changeItems((current) => {
        const next = [...current];
        const productId = Number(product.id);
        const index = next.findIndex((item) => Number(item.productId) === productId);
        if (index >= 0) {
          const proposed = next[index].quantity + qty;
          next[index] = {
            ...next[index],
            productId,
            quantity: Math.min(available, proposed),
            name: product.name,
            sku: product.sku,
            price: Number(product.price),
            stock: available,
          };
        } else {
          next.push({
            productId,
            name: product.name,
            sku: product.sku,
            price: Number(product.price),
            quantity: Math.min(qty, available),
            stock: available,
          });
        }
        return next;
      });
      return true;
    },
    [changeItems]
  );

  const updateQuantity = useCallback(
    (productId, quantity) => {
      const qty = Number(quantity);
      const id = Number(productId);
      // Empty or partly edited inputs must not silently delete a line item.
      if (!isPositiveInteger(qty) || !isPositiveInteger(id)) return;
      changeItems((current) => current.map((item) => Number(item.productId) === id
        ? { ...item, quantity: Math.min(qty, item.stock), productId: id }
        : item));
    },
    [changeItems]
  );

  const removeItem = useCallback(
    (productId) => {
      changeItems((current) => {
        const next = current.filter((item) => Number(item.productId) !== Number(productId));
        return next;
      });
    },
    [changeItems]
  );

  const clear = useCallback(() => {
    changeItems(() => []);
  }, [changeItems]);

  const count = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

  const value = useMemo(
    () => ({ items, addItem, updateQuantity, removeItem, clear, count, subtotal }),
    [items, addItem, updateQuantity, removeItem, clear, count, subtotal]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
