import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { profiles, products } from './data/demo-catalog.mjs';

const root = new URL('../', import.meta.url);
const credentialsPath = new URL('.local/demo-accounts.json', root);
const runtimePath = new URL('.local/runtime.json', root);
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const localSupplierProfiles = args.has('--local-supplier-profiles');
const apiBase = (process.env.DEMO_API_URL || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');
const baseUrl = new URL(apiBase);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('Demo seeding only supports a loopback API URL.');
}
if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') throw new Error('Invalid API protocol.');
if (!apply) {
  console.log(`Dry run: ${profiles.length} demo profiles and ${products.length} products. No writes made.`);
  console.log('Apply locally with: node scripts/seed-demo-catalog.mjs --apply --local-supplier-profiles');
  process.exit(0);
}

let token;
async function api(path, options = {}) {
  const { body, ...rest } = options;
  const response = await fetch(`${apiBase}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${rest.method || 'GET'} ${path}: HTTP ${response.status}${result.message ? ` — ${String(result.message).slice(0, 160)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return result.data ?? result;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

const runtime = await readJson(runtimePath, null);
const requireServer = createRequire(new URL('../server/package.json', import.meta.url));
let prisma;
try {
  await api('/health');
  const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin.test@stockflow.local';
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || 'AdminTest2026!';
  const login = await api('/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  if (login.user?.role !== 'ADMIN') throw new Error('An existing local ADMIN account is required.');
  token = login.token;

  if (localSupplierProfiles) {
    // There is no supplier-profile write API. This narrowly scoped bootstrap
    // is allowed ONLY for the isolated demo container created by local setup.
    const databaseUrl = new URL(runtime?.databaseUrl || 'http://invalid');
    if (runtime?.isolatedDemo !== true || runtime?.containerName !== 'stockflow-db'
      || databaseUrl.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
      || databaseUrl.port !== '55432' || databaseUrl.pathname !== '/stock_management') {
      throw new Error('Supplier bootstrap requires the isolated local stockflow-db runtime on 127.0.0.1:55432.');
    }
    const { PrismaClient } = requireServer('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: runtime.databaseUrl } } });
    // Confirm this is the very database used by the authenticated API.
    const admin = await prisma.user.findUnique({ where: { id: login.user.id }, select: { email: true, role: true } });
    if (admin?.email !== login.user.email || admin?.role !== 'ADMIN') throw new Error('Runtime database does not match API admin identity.');
  }

  await mkdir(new URL('.local/', root), { recursive: true });
  const saved = await readJson(credentialsPath, { version: 1, accounts: {} });
  if (saved.version !== 1 || !saved.accounts || Array.isArray(saved.accounts)) throw new Error('Unsupported demo credentials format.');
  const saveCredentials = () => writeFile(credentialsPath, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  let createdProfiles = 0;
  const supplierIds = new Map();
  for (const profile of profiles) {
    const previous = saved.accounts[profile.email];
    const password = previous?.password || `Sf!${randomBytes(24).toString('base64url')}`;
    // Save before registration so an interrupted run can resume safely.
    saved.accounts[profile.email] = { name: profile.name, role: profile.role, password, ...(previous?.id ? { id: previous.id } : {}) };
    await saveCredentials();
    let user;
    try {
      user = await api('/auth/register', { method: 'POST', body: { name: profile.name, email: profile.email, role: profile.role, password } });
      createdProfiles++;
    } catch (error) {
      if (error.status !== 409) throw error;
      // Never reset another account's password or change its role.
      const accountLogin = await api('/auth/login', { method: 'POST', body: { email: profile.email, password } });
      user = accountLogin.user;
    }
    if (user.email !== profile.email || user.role !== profile.role || user.name !== profile.name) {
      throw new Error(`Existing account does not match intended demo profile: ${profile.key}`);
    }
    saved.accounts[profile.email].id = user.id;
    await saveCredentials();
    if (profile.role === 'SUPPLIER') {
      let supplier;
      if (prisma) {
        const demoUser = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, role: true } });
        if (demoUser?.email !== profile.email || !profile.email.endsWith('@stockflow.example.test') || demoUser.name !== profile.name || demoUser.role !== 'SUPPLIER') {
          throw new Error('Supplier bootstrap only supports matching fictional demo users.');
        }
        supplier = await prisma.supplier.findUnique({ where: { userId: user.id } });
        if (!supplier) supplier = await prisma.supplier.create({ data: { userId: user.id, companyName: profile.companyName, contactNumber: profile.contactNumber, address: profile.address } });
        if (supplier.companyName !== profile.companyName) throw new Error('Existing supplier does not match demo company.');
      } else {
        const suppliers = await api('/discovery/suppliers');
        supplier = suppliers.find((entry) => entry.user?.email === profile.email);
        if (!supplier) throw new Error('Supplier profile creation is not exposed by this API. Use the isolated local supplier bootstrap.');
      }
      supplierIds.set(profile.key, supplier.id);
    }
  }

  const categories = await api('/discovery/categories');
  const categoryIds = new Map(categories.map((category) => [category.name, category.id]));
  for (const categoryName of new Set(products.map((product) => product.category))) {
    if (!categoryIds.has(categoryName)) throw new Error(`Required existing category is missing: ${categoryName}. No category write API exists.`);
  }
  const existing = await api('/products');
  const bySku = new Map(existing.map((product) => [product.sku, product]));
  let createdProducts = 0;
  for (const product of products) {
    if (bySku.has(product.sku)) continue; // Existing rows and stock are never reset.
    const { photoKey, category, supplierKey, ...data } = product;
    await api('/products', { method: 'POST', body: { ...data, categoryId: categoryIds.get(category), supplierId: supplierIds.get(supplierKey) } });
    createdProducts++;
  }
  const result = await api('/products?search=DEMO-');
  const summary = {
    demoProfiles: profiles.length, createdProfiles,
    demoProducts: result.filter((product) => product.sku?.startsWith('DEMO-')).length,
    createdProducts,
    credentialsFile: '.local/demo-accounts.json',
    note: 'No email, AI request, order, password reset, or existing inventory update was performed.',
  };
  await writeFile(new URL('.local/demo-seed-result.json', root), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(`Demo setup stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
