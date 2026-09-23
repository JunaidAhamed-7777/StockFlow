"use strict";

/**
 * Development seed script.
 *
 * Populates deterministic development data: the documented test accounts
 * (see How-To-Run.md section 22), a supplier profile, categories, products,
 * stock transactions and a sample order. Safe to run repeatedly (idempotent
 * via upserts on unique fields).
 */

const bcrypt = require('bcryptjs');
const prisma = require('../src/prismaClient');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

const hash = (plain) => bcrypt.hashSync(plain, SALT_ROUNDS);

async function upsertUser({ name, email, password, role }) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role, password: hash(password) },
    create: { name, email, role, password: hash(password) },
  });
}

async function upsertCategory({ name, description }) {
  return prisma.category.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
}

async function upsertProduct(data) {
  return prisma.product.upsert({
    where: { sku: data.sku },
    update: data,
    create: data,
  });
}

async function main() {
  console.log('Seeding database...');

  const admin = await upsertUser({
    name: 'Admin Test',
    email: 'admin.test@stockflow.local',
    password: 'AdminTest2026!',
    role: 'ADMIN',
  });

  const supplierUser = await upsertUser({
    name: 'Supplier Test',
    email: 'supplier.test@stockflow.local',
    password: 'SupplierTest2026!',
    role: 'SUPPLIER',
  });

  const customer = await upsertUser({
    name: 'Customer Test',
    email: 'customer.test@stockflow.local',
    password: 'CustomerTest2026!',
    role: 'CUSTOMER',
  });

  console.log(`Users ready: ${admin.email}, ${supplierUser.email}, ${customer.email}`);

  const supplier = await prisma.supplier.upsert({
    where: { userId: supplierUser.id },
    update: {
      companyName: 'StockFlow Test Supply Co.',
      contactNumber: '+1-555-0100',
      address: '100 Market Street, Springfield',
    },
    create: {
      userId: supplierUser.id,
      companyName: 'StockFlow Test Supply Co.',
      contactNumber: '+1-555-0100',
      address: '100 Market Street, Springfield',
    },
  });

  const electronics = await upsertCategory({
    name: 'Electronics',
    description: 'Electronic devices and accessories',
  });
  const office = await upsertCategory({
    name: 'Office Supplies',
    description: 'Stationery and workspace essentials',
  });

  const products = await Promise.all([
    upsertProduct({
      name: 'Wireless Mouse',
      description: 'Ergonomic 2.4GHz wireless mouse',
      sku: 'ELEC-MOUSE-001',
      price: 24.99,
      quantity: 120,
      lowStockThreshold: 20,
      categoryId: electronics.id,
      supplierId: supplier.id,
    }),
    upsertProduct({
      name: 'Mechanical Keyboard',
      description: 'RGB backlit mechanical keyboard',
      sku: 'ELEC-KEYB-002',
      price: 79.99,
      quantity: 45,
      lowStockThreshold: 15,
      categoryId: electronics.id,
      supplierId: supplier.id,
    }),
    upsertProduct({
      name: 'USB-C Hub',
      description: '7-in-1 USB-C multiport adapter',
      sku: 'ELEC-HUB-003',
      price: 39.5,
      quantity: 8,
      lowStockThreshold: 10,
      categoryId: electronics.id,
      supplierId: supplier.id,
    }),
    upsertProduct({
      name: 'Notebook A5',
      description: 'Hardcover dotted notebook, 200 pages',
      sku: 'OFF-NOTE-004',
      price: 12.0,
      quantity: 200,
      lowStockThreshold: 40,
      categoryId: office.id,
      supplierId: supplier.id,
    }),
  ]);

  console.log(`Categories ready: ${electronics.name}, ${office.name}`);
  console.log(`Products ready: ${products.length}`);

  // Record an initial stock transaction per product only if none exist yet.
  const existingTx = await prisma.stockTransaction.count();
  if (existingTx === 0) {
    await prisma.stockTransaction.createMany({
      data: products.map((p) => ({
        productId: p.id,
        type: 'IN',
        quantity: p.quantity,
        reason: 'Initial stock',
      })),
    });
    console.log('Created initial stock transactions.');
  }

  // Create a sample delivered order for the customer only if they have none.
  const existingOrders = await prisma.order.count({ where: { customerId: customer.id } });
  if (existingOrders === 0) {
    const mouse = products.find((p) => p.sku === 'ELEC-MOUSE-001');
    await prisma.order.create({
      data: {
        customerId: customer.id,
        status: 'DELIVERED',
        totalAmount: mouse.price * 2,
        orderItems: {
          create: [{ productId: mouse.id, quantity: 2, price: mouse.price }],
        },
      },
    });
    console.log('Created sample order for customer.');
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
