import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
mkdirSync(local, { recursive: true });
const output = path.join(local, 'LOGIN-ACCOUNTS.md');
const previous = existsSync(output) ? readFileSync(output, 'utf8') : '';
const sections = ['# Local login reference', '', 'Private local documentation. This file is excluded from Git and contains working development credentials.', '', '## StockFlow', '', 'Sign in: http://localhost:5173/login', ''];
const entry = (account) => sections.push(`### ${account.name} (${account.role})`, '', `- Email: \`${account.email}\``, `- Password: \`${account.password}\``, '');
entry({ name: 'Admin Test', role: 'ADMIN', email: 'admin.test@stockflow.local', password: 'AdminTest2026!' });
entry({ name: 'Supplier Test', role: 'SUPPLIER', email: 'supplier.test@stockflow.local', password: 'SupplierTest2026!' });
entry({ name: 'Customer Test', role: 'CUSTOMER', email: 'customer.test@stockflow.local', password: 'CustomerTest2026!' });
if (existsSync(path.join(local, 'demo-accounts.json'))) {
  const { accounts } = JSON.parse(readFileSync(path.join(local, 'demo-accounts.json'), 'utf8'));
  for (const [email, account] of Object.entries(accounts)) entry({ ...account, email });
}
if (existsSync(path.join(local, 'automation-account.json'))) entry(JSON.parse(readFileSync(path.join(local, 'automation-account.json'), 'utf8')));
if (process.env.N8N_OWNER_EMAIL && process.env.N8N_OWNER_PASSWORD) sections.push('## n8n owner', '', 'Sign in: http://localhost:5678', '', `- Email: \`${process.env.N8N_OWNER_EMAIL}\``, `- Password: \`${process.env.N8N_OWNER_PASSWORD}\``, '');
else sections.push(previous.slice(previous.indexOf('## n8n owner')).startsWith('## n8n owner') ? previous.slice(previous.indexOf('## n8n owner')) : '## n8n owner\n\nCredentials are managed in your existing n8n account.');
writeFileSync(output, sections.join('\n'), { mode: 0o600 });
console.log('Updated private login documentation: .local/LOGIN-ACCOUNTS.md');
