# Stock Management System using Agentic AI — How to Run

This document explains how to initialize the development environment, start the backend, verify the database and API, test authentication and role-based authorization, and run the frontend.

The active backend is located in:

`server/`

The `archive/` directory contains the previous implementation and is not used for the current application.

---

## 1. Prerequisites

Make sure the following are installed:

* Node.js
* npm
* PostgreSQL
* Git

The backend uses:

* Node.js
* Express.js
* PostgreSQL
* Prisma ORM
* JWT authentication
* bcrypt/bcryptjs

The backend runs on:

`http://localhost:3001`

---

## 2. Start PostgreSQL

Open PowerShell and check whether PostgreSQL is running:

```powershell
Get-Service *postgres*
```

If the PostgreSQL service is stopped, start it:

```powershell
Start-Service postgresql-x64-18
```

> The PostgreSQL service name may differ depending on the installed PostgreSQL version. Use the service name shown by `Get-Service *postgres*` if necessary.

Verify that the service is running before continuing.

---

## 3. Initialize the Backend

From the project root:

```powershell
cd server
```

Install the backend dependencies:

```powershell
npm install
```

### Configure the environment

Create `server/.env` from `server/.env.example` and configure the PostgreSQL connection and required environment variables.

Example development configuration:

```env
DATABASE_URL="postgresql://stockflow:StockFlow_Dev2026@localhost:55432/stock_management?schema=public"
JWT_SECRET="stockflow-local-jwt-secret-change-in-production"
BCRYPT_SALT_ROUNDS="10"
PORT="3001"
CLIENT_URL="http://localhost:5173"
```

Do not commit `.env` or other files containing secrets.

### Database credentials (local development)

| Setting  | Value              |
| -------- | ------------------ |
| Host     | `localhost`        |
| Port     | `55432`            |
| Database | `stock_management` |
| User     | `stockflow`        |
| Password | `StockFlow_Dev2026` |

If the database does not exist yet, initialize a local PostgreSQL instance on port `55432`, create the `stock_management` database, then run Prisma push and seed (sections 4–5). See the setup commands in `server/scripts/setup-database.sql` and the local instance bootstrap in section 3.

---

## 4. Initialize Prisma

Validate the Prisma schema:

```powershell
npx prisma validate
```

Generate the Prisma client:

```powershell
npx prisma generate
```

Push the current Prisma schema to the development database:

```powershell
npx prisma db push
```

If all three commands complete successfully, Prisma is correctly configured and can communicate with the database.

---

## 5. Seed the Database

Run the seed command defined in the backend `package.json`.

For example, if the backend provides a seed script:

```powershell
npm run seed
```

The seed data should provide deterministic development users, products, and related inventory data.

Use the credentials listed in the **Development Login Credentials** section below.

---

## 6. Start the Backend

Start the Express development server:

```powershell
npm run dev
```

The backend should be available at:

`http://localhost:3001`

Keep this terminal running while testing the API or running the frontend.

---

## 7. Verify the Backend

### Health Check

Run:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

Expected response:

```text
success = True
message = Stock Management API is running
```

This confirms that Express is running and responding.

---

### Root Route

You can also test:

```powershell
Invoke-WebRequest http://localhost:3001
```

If the application does not define a root route, a response such as:

```text
404 Route not found
```

is acceptable.

This confirms that the Express server itself is running.

---

# 8. Test Public Product APIs

### List Products

```powershell
Invoke-RestMethod http://localhost:3001/api/products
```

This should return the available products.

---

### Get a Specific Product

First obtain a product ID from the product list.

Then:

```powershell
Invoke-RestMethod http://localhost:3001/api/products/<productId>
```

The current product IDs are integers.

---

### Low-Stock Products

```powershell
Invoke-RestMethod http://localhost:3001/api/stock/low-stock
```

A product is considered low stock when:

```text
quantity <= lowStockThreshold
```

The response should be restricted according to the authenticated user's role where authentication is required.

---

# 9. Authentication Testing

All protected endpoints use:

```text
Authorization: Bearer <JWT>
```

The JWT is returned by the login endpoint.

---

## 9.1 Customer Registration

To create a test customer:

```powershell
$body = @{
    name = "Test Customer"
    email = "testcustomer@example.com"
    password = "TestPassword123"
} | ConvertTo-Json

$register = Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/register" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

$register
```

If the user already exists, use the seeded customer account or another unique email address.

---

## 9.2 Customer Login

```powershell
$body = @{
    email = "testcustomer@example.com"
    password = "TestPassword123"
} | ConvertTo-Json

$login = Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/login" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

$login
```

Store the returned token:

```powershell
$customerToken = $login.data.token
```

---

## 9.3 Test `/api/auth/me`

Use the customer token:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/me" `
    -Headers @{ Authorization = "Bearer $customerToken" }
```

This should return the authenticated customer's information.

---

## 9.4 Test Authentication Protection

Call `/api/auth/me` without a token:

```powershell
Invoke-RestMethod http://localhost:3001/api/auth/me
```

Expected result:

```text
401 Unauthorized
```

This confirms that the endpoint is protected by JWT authentication.

---

# 10. Admin Login

Seeded admin credentials:

```text
Email:    admin.test@stockflow.local
Password: AdminTest2026!
```

Login:

```powershell
$body = @{
    email = "admin.test@stockflow.local"
    password = "AdminTest2026!"
} | ConvertTo-Json

$adminLogin = Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/login" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

$adminToken = $adminLogin.data.token
```

Test the admin token:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/me" `
    -Headers @{ Authorization = "Bearer $adminToken" }
```

The returned user should have:

```text
role = ADMIN
```

---

# 11. Supplier Login

Seeded supplier credentials:

```text
Email:    supplier.test@stockflow.local
Password: SupplierTest2026!
```

Login:

```powershell
$body = @{
    email = "supplier.test@stockflow.local"
    password = "SupplierTest2026!"
} | ConvertTo-Json

$supplierLogin = Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/login" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

$supplierToken = $supplierLogin.data.token
```

Verify the supplier token:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:3001/api/auth/me" `
    -Headers @{ Authorization = "Bearer $supplierToken" }
```

The returned user should have:

```text
role = SUPPLIER
```

---

# 12. Role-Based Authorization Testing

Authentication verifies who the user is.

Authorization verifies what that user is allowed to do.

The backend must enforce these restrictions independently of the frontend.

---

## 12.1 Customer Cannot Create Products

Create a test product payload:

```powershell
$body = @{
    name = "Unauthorized Product"
    description = "RBAC test"
    sku = "RBAC-TEST"
    price = 100
    quantity = 10
    lowStockThreshold = 2
} | ConvertTo-Json
```

Attempt to create the product using the customer token:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:3001/api/products" `
    -Method POST `
    -Headers @{ Authorization = "Bearer $customerToken" } `
    -ContentType "application/json" `
    -Body $body
```

Expected result:

```text
403 Forbidden
```

The customer must not be able to create products.

---

## 12.2 Supplier Product Ownership

A supplier may create and modify products that belong to that supplier.

A supplier must not be able to modify another supplier's products.

Test this using products belonging to different suppliers.

The backend must return an authorization error when a supplier attempts to modify a product they do not own.

---

## 12.3 Customer Order Isolation

A customer may:

* create orders
* view their own orders
* view their own order details

A customer must not be able to access another customer's orders.

Attempting to access another customer's order should result in an appropriate authorization/not-found response according to the backend's security design.

---

## 12.4 Admin Access

Admin users should be able to access administrative resources such as:

* all products
* all orders
* stock transactions
* stock adjustments
* customer directory
* supplier information
* administrative dashboard

Authorization must be enforced by the backend.

---

# 13. Orders

### Get Products

```powershell
$products = Invoke-RestMethod http://localhost:3001/api/products
$products
```

Get a product ID:

```powershell
$products[0].id
```

---

### Create an Order

Orders are created using:

```text
POST /api/orders
```

The request body contains:

```text
{
    items: [
        {
            productId: <productId>,
            quantity: <quantity>
        }
    ]
}
```

The request must be authenticated using a customer JWT.

The backend must calculate prices and totals using the current server-side product data.

The frontend must never be trusted for:

* product prices
* subtotals
* total amount
* stock availability

---

## 13.1 Order Integrity

A successful order should atomically:

1. Validate the customer.
2. Validate the products.
3. Validate quantities.
4. Check available stock.
5. Read current server-side prices.
6. Calculate item subtotals.
7. Calculate the order total.
8. Create the order.
9. Create the order items.
10. Decrease product stock.
11. Create stock transaction records.

If any part fails, the complete operation should be rolled back.

---

# 14. Stock

### Low-Stock Products

```powershell
Invoke-RestMethod http://localhost:3001/api/stock/low-stock
```

Low stock is defined as:

```text
quantity <= lowStockThreshold
```

---

### Stock Transactions

The endpoint is:

```text
GET /api/stock/transactions
```

If the endpoint is still marked as not implemented, it should return:

```text
501 Not Implemented
```

It is intended to expose stock transaction/audit information once implemented.

---

### Stock Adjustment

Stock adjustments use:

```text
PATCH /api/stock/adjust
```

Payload:

```text
{
    productId,
    quantityChange,
    reason?
}
```

Only ADMIN users and suppliers who own the product may perform stock adjustments.

The backend must:

* authenticate the user
* verify authorization
* verify product ownership where applicable
* prevent negative stock
* update stock
* create a stock transaction

---

# 15. Discovery APIs

### Categories

```powershell
Invoke-RestMethod http://localhost:3001/api/discovery/categories
```

### Suppliers

```powershell
Invoke-RestMethod http://localhost:3001/api/discovery/suppliers
```

### Supplier Details

```powershell
Invoke-RestMethod http://localhost:3001/api/discovery/suppliers/<supplierId>
```

These endpoints provide information required for product discovery and creation.

Sensitive user information must not be exposed.

---

# 16. Dashboard

The dashboard endpoint is:

```text
GET /api/dashboard
```

The returned metrics depend on the authenticated user's role.

### ADMIN

Should receive overall metrics such as:

* total products
* total stock
* total orders
* pending orders
* low-stock products
* customer count
* supplier count
* inventory value where supported

### SUPPLIER

Should receive supplier-specific metrics such as:

* own product count
* own stock
* own low-stock products
* relevant orders

### CUSTOMER

Should receive customer-specific metrics such as:

* order count
* spending
* pending orders
* delivered orders

The role must come from the authenticated user/JWT.

---

# 17. User Profile

### Get Own Profile

```text
GET /api/users/me
```

Requires authentication.

### Update Own Profile

```text
PATCH /api/users/me
```

Users may update their own supported profile fields, such as:

* name
* email

Users must not be able to modify:

* ID
* role
* password hash
* authorization-related fields

---

# 18. Admin Customer Directory

The endpoint:

```text
GET /api/users/customers
```

is restricted to ADMIN users.

A supplier or customer attempting to access this resource should not receive the customer directory.

---

# 19. AI / Agentic AI Endpoints

The MVP does not use fake AI data.

The following endpoints define the future AI integration boundary:

```text
GET /api/ai/forecast
GET /api/ai/stockout
GET /api/ai/recommendations
```

Until the n8n/agentic AI layer is implemented, these endpoints should return:

```text
501 Not Implemented
```

The intended future architecture is:

```text
React Frontend
      ↓
Express REST API
      ↓
AI Integration Layer
      ↓
n8n Webhook / Agentic Workflow
      ↓
AI Processing
      ↓
Result
```

The frontend should display an appropriate unavailable/not-implemented state rather than inventing predictions.

---

# 20. Common API Errors to Check

During backend verification, pay particular attention to:

### Incorrect API prefix

Correct:

```text
http://localhost:3001/api/products
```

Incorrect:

```text
http://localhost:3001/api/api/products
```

There must be exactly one `/api` prefix.

### Authentication errors

Verify:

* missing JWT → `401`
* invalid JWT → `401`
* expired/invalid authentication → `401`

### Authorization errors

Verify:

* authenticated but insufficient permissions → `403`

### Validation errors

Invalid request data should produce an appropriate `400`/`422` response according to the backend implementation.

Important validation cases include:

* duplicate email
* duplicate SKU
* negative price
* negative quantity
* invalid quantity changes
* invalid product IDs
* invalid order quantities
* insufficient stock
* invalid order status
* malformed request data

---

# 21. Frontend

The frontend will be rebuilt after the backend has been initialized and verified.

The previous frontend implementation is archived under:

```text
archive/client/
```

Do not use it as the active frontend.

The new frontend will be built around the verified backend API and the Stitch reference designs located under:

```text
stitch_stockflow_enterprise_inventory_saas/
```

Once frontend development begins, start from the actual backend API contracts rather than recreating the previous implementation.

To run the future frontend, navigate to the active client directory and use the scripts defined by its `package.json`.

---

# 22. Development Login Credentials

Fresh test accounts created by `npm run seed`:

| Role     | Email                           | Password            |
| -------- | ------------------------------- | ------------------- |
| Admin    | `admin.test@stockflow.local`    | `AdminTest2026!`    |
| Supplier | `supplier.test@stockflow.local` | `SupplierTest2026!` |
| Customer | `customer.test@stockflow.local` | `CustomerTest2026!` |

Database connection password (PostgreSQL user `stockflow`):

```text
StockFlow_Dev2026
```

These credentials are for local development/testing only.

Do not use them in production.

---

# 22.1 Automated Endpoint Verification

From `server/`, with the API running on port `3001`:

```powershell
node scripts/test-endpoints.js
```

This script exercises all routes documented in `server/endpoints.md` and reports pass/fail for each endpoint.

---

# 23. Recommended Backend Verification Order

When setting up the project on a new development environment, verify the backend in this order:

```text
1. PostgreSQL
      ↓
2. Environment configuration
      ↓
3. npm dependencies
      ↓
4. Prisma validation
      ↓
5. Prisma client generation
      ↓
6. Database schema
      ↓
7. Seed data
      ↓
8. Express server
      ↓
9. Health endpoint
      ↓
10. Public product APIs
      ↓
11. Registration/login
      ↓
12. JWT authentication
      ↓
13. Role-based authorization
      ↓
14. Products
      ↓
15. Stock
      ↓
16. Orders
      ↓
17. Discovery
      ↓
18. Dashboards
      ↓
19. Profile APIs
      ↓
20. Error/edge-case testing
```

The frontend should only be developed after the backend passes the required verification tests.

---

# 24. API Reference

The complete endpoint specification is maintained in:

```text
server/endpoints.md
```

All API routes use:

```text
http://localhost:3001/api
```

The backend is the source of truth for authentication, authorization, data validation, inventory, orders, stock, and user data.

---

# 25. Verified local run (Windows)

This section is the working procedure used to start the full stack on this machine. Use it instead of the older `55432` example in section 3.

The app does **not** use the Windows PostgreSQL services on ports `5432` / `5433` / `5434`. Those are separate installs. StockFlow uses a dedicated PostgreSQL 18 data directory at:

```text
server/.pgdata
```

That directory is gitignored. The cluster listens on **port `5435`**, which matches `server/.env.example`.

Verified URLs:

| Service | URL |
| ------- | --- |
| Frontend (Vite) | `http://localhost:5173` |
| Backend API | `http://localhost:3001` |
| Health check | `http://localhost:3001/api/health` |

Logins are in section 22.

---

## 25.1 One-time setup

From the repository root, install workspace dependencies if `node_modules` is missing:

```powershell
npm install
```

Create environment files if they do not exist:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

`server/.env` must contain:

```env
DATABASE_URL="postgresql://stockflow:StockFlow_Dev2026@localhost:5435/stock_management?schema=public"
JWT_SECRET="stockflow-local-jwt-secret-change-in-production"
BCRYPT_SALT_ROUNDS="10"
PORT="3001"
CLIENT_URL="http://localhost:5173"
```

`client/.env` must contain:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

### Create the dedicated PostgreSQL cluster (first time only)

Requires PostgreSQL 18 binaries at `C:\Program Files\PostgreSQL\18\bin` (the `postgresql-x64-18` Windows service can stay running; this cluster is separate).

Run the following from the **repository root**.

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$dataDir = Join-Path (Get-Location) "server\.pgdata"
$pwFile = Join-Path (Get-Location) "server\.pgpw.txt"

if (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) {
    Set-Content -Path $pwFile -Value "StockFlow_Dev2026" -NoNewline -Encoding ascii
    & "$pgBin\initdb.exe" `
        --pgdata $dataDir `
        --username stockflow `
        --pwfile $pwFile `
        --auth scram-sha-256 `
        --encoding UTF8 `
        --locale "English_United States.1252"
}
```

Start the cluster on port `5435`:

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$dataDir = Join-Path (Get-Location) "server\.pgdata"
& "$pgBin\pg_ctl.exe" -D $dataDir -l "$dataDir\server.log" -o "-p 5435" start
```

The first start after a crash can take 30–60 seconds. Wait until `pg_ctl` prints `server started`.

Create the application database if needed (skip if `psql` reports that `stock_management` already exists):

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$env:PGPASSWORD = "StockFlow_Dev2026"
& "$pgBin\psql.exe" -w -U stockflow -h 127.0.0.1 -p 5435 -d postgres -c "CREATE DATABASE stock_management;"
```

Push the schema and seed test users:

```powershell
cd server
npx prisma generate
npx prisma db push
npm run seed
cd ..
```

---

## 25.2 Everyday start

Run the PostgreSQL commands from the **repository root**. Use two additional terminals for the API and Vite servers.

**1. PostgreSQL cluster** (skip if `pg_ctl status` already shows it running):

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$dataDir = Join-Path (Get-Location) "server\.pgdata"
& "$pgBin\pg_ctl.exe" -D $dataDir status
# If "no server running":
& "$pgBin\pg_ctl.exe" -D $dataDir -l "$dataDir\server.log" -o "-p 5435" start
```

**2. Backend** (leave this terminal open):

```powershell
cd server
npm run dev
```

Expected: `Server listening on port 3001`

**3. Frontend** (leave this terminal open):

```powershell
cd client
npm run dev
```

Expected: `Local: http://localhost:5173/`

Open `http://localhost:5173/login` and sign in with a section 22 account.

Quick API check:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

---

## 25.3 Stop

Stop the Node processes with `Ctrl+C` in the server and client terminals.

Stop the dedicated cluster (does not stop the Windows PostgreSQL 13/16/18 services):

```powershell
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$dataDir = Join-Path (Get-Location) "server\.pgdata"
& "$pgBin\pg_ctl.exe" -D $dataDir stop
```

Do not commit `server/.env`, `client/.env`, `server/.pgdata/`, or `server/.pgpw.txt`.
