const prisma = require('../prismaClient');
const { getProductPage } = require('./pagedReadService').createPagedReads(prisma);

const createProduct = async ({ name, description, sku, price, quantity, lowStockThreshold, categoryId, supplierId }) => {
  // Basic validation
  if (!name || !sku || price < 0 || quantity < 0) {
    const err = new Error('Invalid product data');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing) {
    const err = new Error('SKU already in use');
    err.status = 409;
    throw err;
  }

  const product = await prisma.product.create({
    data: { name, description, sku, price, quantity, lowStockThreshold, categoryId, supplierId },
  });
  return product;
};

const updateProduct = async (id, data, user) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new Error('Product not found');

  // Ownership check for suppliers.
  if (user.role === 'SUPPLIER' && product.supplierId !== user.supplierId) {
    const err = new Error('Forbidden: cannot update another supplier’s product');
    err.status = 403;
    throw err;
  }

  const updated = await prisma.product.update({
    where: { id },
    data,
  });
  return updated;
};

const deleteProduct = async (id, user) => {
  if (user.role !== 'ADMIN') {
    const err = new Error('Forbidden: only admin can delete products');
    err.status = 403;
    throw err;
  }
  try {
    await prisma.product.delete({ where: { id } });
  } catch (error) {
    const message = String(error.message || '');
    if (message.includes('foreign key') || message.includes('referenced')) {
      const err = new Error('Cannot delete product that is referenced by orders or stock history');
      err.status = 409;
      throw err;
    }
    throw error;
  }
};

const getAll = async (filters = {}) => {
  const where = {};
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { sku: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.lowStock) where.quantity = { lte: filters.lowStockThreshold || 10 };
  return prisma.product.findMany({ where });
};

const getById = async (id) => {
  const product = await prisma.product.findUnique({ where: { id }, include: { category: true, supplier: true } });
  if (!product) throw new Error('Product not found');
  return product;
};

module.exports = { createProduct, updateProduct, deleteProduct, getAll, getById, getProductPage };
