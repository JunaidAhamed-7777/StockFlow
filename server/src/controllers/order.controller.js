const {
  createOrder,
  getOrdersByUser,
  getOrdersForSupplier,
  getAllOrders,
  getOrderById,
  getOrderPage,
  updateOrderStatus,
} = require('../services/orderService');
const { pageRequested, readError } = require('../services/readQuery');

const listOrders = async (req, res, next) => {
  try {
    if (pageRequested(req.query)) return res.json(await getOrderPage(req.query, req.user));
    if (Object.hasOwn(req.query, 'view')) throw readError('Order views require page');
    let orders;
    if (req.user.role === 'SUPPLIER') {
      if (!req.user.supplierId) {
        return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      }
      orders = await getOrdersForSupplier(req.user.supplierId);
    } else {
      orders = await getOrdersByUser(req.user.id);
    }
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

const listAllOrders = async (req, res, next) => {
  try {
    if (pageRequested(req.query)) return res.json(await getOrderPage(req.query, req.user));
    if (Object.hasOwn(req.query, 'view')) throw readError('Order views require page');
    const orders = await getAllOrders();
    res.json({ success: true, data: orders });
  } catch (err) {
    next(err);
  }
};

const orderDetails = async (req, res, next) => {
  try {
    const order = await getOrderById(Number(req.params.id), req.user);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

const createOrderController = async (req, res, next) => {
  try {
    const order = await createOrder(req.user.id, req.body.items || [], req.user.role);
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

const updateStatusController = async (req, res, next) => {
  try {
    const order = await updateOrderStatus(Number(req.params.id), req.body.status, req.user);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listOrders,
  listAllOrders,
  orderDetails,
  createOrderController,
  updateStatusController,
};
