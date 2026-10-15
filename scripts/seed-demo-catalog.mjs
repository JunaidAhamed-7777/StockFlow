import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profiles, products } from './data/demo-catalog.mjs';
import { validateRuntimeConfig, validateDatabaseContainer } from './runtime-safety.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execFileAsync = promisify(execFile);
class DemoSeedError extends Error {}

async function readJson(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveJson(filename, value) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}

async function acquireSeedLock(localDirectory) {
  await mkdir(localDirectory, { recursive: true });
  const filename = path.join(localDirectory, 'demo-seed.lock');
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  let handle;
  try {
    handle = await open(filename, 'wx', 0o600);
    await handle.writeFile(owner);
    await handle.close();
  } catch (error) {
    if (handle) { await handle.close(); await rm(filename, { force: true }); }
    if (error.code === 'EEXIST') throw new DemoSeedError('Demo seed lock already exists. Verify no seed process is running, then remove demo-seed.lock manually if it is stale.');
    throw error;
  }
  return async () => {
    try { if (await readFile(filename, 'utf8') === owner) await rm(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}

async function inspectOwnedContainer(name) {
  try {
    const result = await execFileAsync('docker', ['container', 'inspect', name], { cwd: root, windowsHide: true, timeout: 20_000, maxBuffer: 2_000_000 });
    return JSON.parse(result.stdout)[0];
  } catch { throw new DemoSeedError('Could not inspect the isolated demo database container. No supplier bootstrap was attempted.'); }
}

function createPrisma(databaseUrl) {
  const requireServer = createRequire(new URL('../server/package.json', import.meta.url));
  const { PrismaClient } = requireServer('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function runDemoSeed({
  localDirectory = path.join(root, '.local'), apiBase = 'http://127.0.0.1:3001/api', apply = false,
  localSupplierProfiles = false, adminEmail = 'admin.test@stockflow.local', adminPassword = 'AdminTest2026!',
  fetchImpl = globalThis.fetch, inspectContainer = inspectOwnedContainer, prismaFactory = createPrisma,
} = {}) {
  apiBase = apiBase.replace(/\/+$/, '');
  const baseUrl = new URL(apiBase);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)) throw new DemoSeedError('Demo seeding only supports a loopback API URL.');
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new DemoSeedError('Invalid API URL.');
  if (!apply) return { dryRun: true, demoProfiles: profiles.length, demoProducts: products.length };

  const releaseLock = await acquireSeedLock(localDirectory);
  let token;
  async function api(endpoint, options = {}) {
    const { body, ...rest } = options;
    let response;
    try {
      response = await fetchImpl(`${apiBase}${endpoint}`, {
        ...rest, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new DemoSeedError(`${rest.method || 'GET'} ${endpoint}: local API request failed or redirected.`); }
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new DemoSeedError('API redirects are not allowed for demo seeding.');
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new DemoSeedError(`${rest.method || 'GET'} ${endpoint}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result.data ?? result;
  }

  let prisma;
  try {
    const credentialsPath = path.join(localDirectory, 'demo-accounts.json');
    let runtime;
    if (localSupplierProfiles) {
      runtime = await readJson(path.join(localDirectory, 'runtime.json'), null);
      validateRuntimeConfig(runtime);
      if (runtime.initialized !== true || typeof runtime.containerId !== 'string' || !runtime.containerId.trim()) {
        throw new DemoSeedError('Supplier bootstrap requires an initialized runtime with a saved database container ID.');
      }
      validateDatabaseContainer(await inspectContainer(runtime.containerName), runtime);
    }
    const saved = await readJson(credentialsPath, { version: 1, accounts: {} });
    if (saved.version !== 1 || !saved.accounts || typeof saved.accounts !== 'object' || Array.isArray(saved.accounts)) throw new DemoSeedError('Unsupported demo credentials format.');
    for (const profile of profiles) {
      if (!Object.hasOwn(saved.accounts, profile.email)) continue;
      const record = saved.accounts[profile.email];
      if (!record || typeof record.password !== 'string' || !record.password || record.name !== profile.name || record.role !== profile.role) throw new DemoSeedError('Saved demo account metadata is incomplete or does not match the intended profile.');
    }
    await api('/health');
    const login = await api('/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
    if (login.user?.role !== 'ADMIN' || login.user.email !== adminEmail || !Number.isSafeInteger(login.user.id) || login.user.id <= 0 || typeof login.token !== 'string' || !login.token) throw new DemoSeedError('An existing matching local ADMIN account is required.');
    token = login.token;
    if (localSupplierProfiles) {
      // The API has no supplier-profile write endpoint. Verify the owned local
      // container and the API's admin identity before using this narrow bootstrap.
      prisma = await prismaFactory(runtime.databaseUrl);
      const admin = await prisma.user.findUnique({ where: { id: login.user.id }, select: { email: true, role: true } });
      if (admin?.email !== login.user.email || admin?.role !== 'ADMIN') throw new DemoSeedError('Runtime database does not match API admin identity.');
    }
    const saveCredentials = () => saveJson(credentialsPath, saved);
    let createdProfiles = 0;
    const supplierIds = new Map();
    for (const profile of profiles) {
      const previous = saved.accounts[profile.email];
      const password = previous?.password || `Sf!${randomBytes(24).toString('base64url')}`;
      // Save before registration so a committed request with a lost response can resume.
      saved.accounts[profile.email] = { name: profile.name, role: profile.role, password, ...(previous?.id ? { id: previous.id } : {}) };
      await saveCredentials();
      let user;
      try {
        user = await api('/auth/register', { method: 'POST', body: { name: profile.name, email: profile.email, role: profile.role, password } });
        createdProfiles++;
      } catch (error) {
        if (error.status !== 409) throw error;
        if (!previous?.password) throw new DemoSeedError('An existing demo account has no saved local credential. Its password and role were not changed.');
        const accountLogin = await api('/auth/login', { method: 'POST', body: { email: profile.email, password } });
        user = accountLogin.user;
      }
      if (user?.email !== profile.email || user.role !== profile.role || user.name !== profile.name || !Number.isSafeInteger(user.id) || user.id <= 0 || (previous?.id && previous.id !== user.id)) {
        throw new DemoSeedError(`Existing account does not match intended demo profile: ${profile.key}`);
      }
      saved.accounts[profile.email].id = user.id;
      await saveCredentials();
      if (profile.role === 'SUPPLIER') {
        let supplier;
        if (prisma) {
          const demoUser = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, role: true } });
          if (demoUser?.email !== profile.email || !profile.email.endsWith('@stockflow.example.test') || demoUser.name !== profile.name || demoUser.role !== 'SUPPLIER') throw new DemoSeedError('Supplier bootstrap only supports matching fictional demo users.');
          supplier = await prisma.supplier.findUnique({ where: { userId: user.id } });
          if (!supplier) supplier = await prisma.supplier.create({ data: { userId: user.id, companyName: profile.companyName, contactNumber: profile.contactNumber, address: profile.address } });
          if (supplier.companyName !== profile.companyName) throw new DemoSeedError('Existing supplier does not match demo company.');
        } else {
          const suppliers = await api('/discovery/suppliers');
          supplier = suppliers.find((entry) => entry.user?.email === profile.email);
          if (!supplier) throw new DemoSeedError('Supplier profile creation is not exposed by this API. Use the isolated local supplier bootstrap.');
        }
        supplierIds.set(profile.key, supplier.id);
      }
    }

    const categories = await api('/discovery/categories');
    const categoryIds = new Map(categories.map((category) => [category.name, category.id]));
    for (const categoryName of new Set(products.map((product) => product.category))) {
      if (!categoryIds.has(categoryName)) throw new DemoSeedError(`Required existing category is missing: ${categoryName}. No category write API exists.`);
    }
    const existing = await api('/products');
    const bySku = new Map(existing.map((product) => [product.sku, product]));
    let createdProducts = 0;
    for (const product of products) {
      if (bySku.has(product.sku)) continue;
      const { photoKey, category, supplierKey, ...data } = product;
      await api('/products', { method: 'POST', body: { ...data, categoryId: categoryIds.get(category), supplierId: supplierIds.get(supplierKey) } });
      createdProducts++;
    }
    const result = await api('/products?search=DEMO-');
    const summary = {
      demoProfiles: profiles.length, createdProfiles,
      demoProducts: result.filter((product) => product.sku?.startsWith('DEMO-')).length, createdProducts,
      credentialsFile: '.local/demo-accounts.json',
      note: 'No email, AI request, order, password reset, or existing inventory update was performed.',
    };
    await saveJson(path.join(localDirectory, 'demo-seed-result.json'), summary);
    return summary;
  } finally {
    try { await prisma?.$disconnect(); }
    finally { await releaseLock(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  try {
    const summary = await runDemoSeed({
      apply: args.has('--apply'), localSupplierProfiles: args.has('--local-supplier-profiles'),
      apiBase: process.env.DEMO_API_URL || 'http://127.0.0.1:3001/api',
      adminEmail: process.env.DEMO_ADMIN_EMAIL || 'admin.test@stockflow.local', adminPassword: process.env.DEMO_ADMIN_PASSWORD || 'AdminTest2026!',
    });
    if (summary.dryRun) {
      console.log(`Dry run: ${summary.demoProfiles} demo profiles and ${summary.demoProducts} products. No writes made.`);
      console.log('Apply locally with: node scripts/seed-demo-catalog.mjs --apply --local-supplier-profiles');
    } else console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    // Untrusted HTTP, filesystem and Prisma error messages can contain credentials.
    console.error(`Demo setup stopped: ${error instanceof DemoSeedError ? error.message : 'Local runtime, database or saved credential metadata could not be verified.'}`);
    process.exitCode = 1;
  }
}
