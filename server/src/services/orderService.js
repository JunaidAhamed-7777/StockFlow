const prisma = require('../prismaClient');
const { getOrderPage, getOrderDetail } = require('./pagedReadService').createPagedReads(prisma);

const createOrder = async (userId, items, userRole) => {
  if (userRole && userRole !== 'CUSTOMER') {
    const err = new Error('Only customers can create orders');
    err.status = 403;
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Order must contain at least one item');
    err.status = 400;
    throw err;
  }

  // Resolve product data and validate stock.
  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });

  if (products.length !== items.length) {
    const err = new Error('One or more products not found');
    err.status = 404;
    throw err;
  }

  const orderItemsData = [];
  let total = 0;

  for (const item of items) {
    const prod = products.find((p) => p.id === item.productId);
    if (!prod) continue;
    if (!prod.quantity || prod.quantity < item.quantity) {
      const err = new Error(`Insufficient stock for product ${prod.sku}`);
      err.status = 400;
      throw err;
    }
    const subtotal = prod.price * item.quantity;
    total += subtotal;
    orderItemsData.push({ productId: prod.id, quantity: item.quantity, price: prod.price });
  }

  // Transaction
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: { customerId: userId, status: 'PENDING', totalAmount: total } });
    await tx.orderItem.createMany({ data: orderItemsData.map((oi) => ({ ...oi, orderId: order.id })) });

    // Update product quantity and create stock transactions
    for (const oi of orderItemsData) {
      await tx.product.update({ where: { id: oi.productId }, data: { quantity: { decrement: oi.quantity } } });
      await tx.stockTransaction.create({ data: { productId: oi.productId, type: 'OUT', quantity: oi.quantity, reason: 'Order placement', } });
    }
    return order;
  });

  return result;
};

const getOrdersByUser = async (userId) => {
  return prisma.order.findMany({
    where: { customerId: userId },
    include: { orderItems: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

const getOrdersForSupplier = async (supplierId) => {
  return prisma.order.findMany({
    where: {
      orderItems: {
        some: { product: { supplierId } },
      },
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      orderItems: {
        where: { product: { supplierId } },
        include: { product: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
};

const getAllOrders = async () => {
  return prisma.order.findMany({
    include: {
      customer: { select: { id: true, name: true, email: true } },
      orderItems: { include: { product: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

const getOrderById = async (id, user) => getOrderDetail(id, user);

const updateOrderStatus = async (id, status, user) => {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new Error('Order not found');
  // TODO: enforce status transitions.
  if (user.role === 'CUSTOMER') {
    const err = new Error('Customers cannot update status');
    err.status = 403;
    throw err;
  }
  if (user.role === 'SUPPLIER') {
    // For simplicity, allow change if order contains supplier's product.
    const hasProduct = await prisma.orderItem.findFirst({ where: { orderId: id, product: { supplier: { userId: user.id } } } });
    if (!hasProduct) { const err = new Error('Forbidden'); err.status = 403; throw err; }
  }
  // Admin has full access.
  return prisma.order.update({
    where: { id },
    data: { status },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      orderItems: { include: { product: true } },
    },
  });
};

module.exports = {
  createOrder,
  getOrdersByUser,
  getOrdersForSupplier,
  getAllOrders,
  getOrderById,
  getOrderPage,
  updateOrderStatus,
};
