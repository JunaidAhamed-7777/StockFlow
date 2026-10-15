const prisma = require('../prismaClient');
const { getSupplierPage } = require('./pagedReadService').createPagedReads(prisma);

const getCategories = async () => prisma.category.findMany();

const userPublicSelect = { id: true, name: true, email: true, role: true };

const getSuppliers = async () => {
  return prisma.supplier.findMany({ include: { user: { select: userPublicSelect } } });
};

const getSupplierById = async (id) => {
  const sup = await prisma.supplier.findUnique({
    where: { id },
    include: { user: { select: userPublicSelect } },
  });
  if (!sup) throw new Error('Supplier not found');
  return sup;
};

module.exports = { getCategories, getSuppliers, getSupplierById, getSupplierPage };
