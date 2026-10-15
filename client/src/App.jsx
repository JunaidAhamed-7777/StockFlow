import { lazy, Suspense, useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RoleRedirect } from "./components/RoleRedirect";
import { Loading } from "./components/ui/Loading";
import { useAuth } from "./context/AuthContext";

const page = (loader, name) => lazy(async () => ({ default: (await loader())[name] }));
const LoginPage = page(() => import("./pages/auth/LoginPage"), "LoginPage");
const RegisterPage = page(() => import("./pages/auth/RegisterPage"), "RegisterPage");
const AdminDashboard = page(() => import("./pages/admin/AdminDashboard"), "AdminDashboard");
const AdminProducts = page(() => import("./pages/admin/AdminProducts"), "AdminProducts");
const AdminProductFormPage = page(() => import("./pages/admin/AdminProductFormPage"), "AdminProductFormPage");
const AdminInventory = page(() => import("./pages/admin/AdminInventory"), "AdminInventory");
const AdminOrders = page(() => import("./pages/admin/AdminOrders"), "AdminOrders");
const AdminCustomers = page(() => import("./pages/admin/AdminCustomers"), "AdminCustomers");
const AdminSuppliers = page(() => import("./pages/admin/AdminSuppliers"), "AdminSuppliers");
const AdminStockTransactions = page(() => import("./pages/admin/AdminStockTransactions"), "AdminStockTransactions");
const AdminAI = page(() => import("./pages/admin/AdminAI"), "AdminAI");
const AdminProfile = page(() => import("./pages/admin/AdminProfile"), "AdminProfile");
const SupplierDashboard = page(() => import("./pages/supplier/SupplierDashboard"), "SupplierDashboard");
const SupplierProducts = page(() => import("./pages/supplier/SupplierProducts"), "SupplierProducts");
const SupplierProductFormPage = page(() => import("./pages/supplier/SupplierProductFormPage"), "SupplierProductFormPage");
const SupplierStock = page(() => import("./pages/supplier/SupplierStock"), "SupplierStock");
const SupplierOrders = page(() => import("./pages/supplier/SupplierOrders"), "SupplierOrders");
const SupplierProfile = page(() => import("./pages/supplier/SupplierProfile"), "SupplierProfile");
const CustomerDashboard = page(() => import("./pages/customer/CustomerDashboard"), "CustomerDashboard");
const CustomerProducts = page(() => import("./pages/customer/CustomerProducts"), "CustomerProducts");
const CustomerProductDetail = page(() => import("./pages/customer/CustomerProductDetail"), "CustomerProductDetail");
const CustomerCart = page(() => import("./pages/customer/CustomerCart"), "CustomerCart");
const CustomerOrders = page(() => import("./pages/customer/CustomerOrders"), "CustomerOrders");
const CustomerOrderDetail = page(() => import("./pages/customer/CustomerOrderDetail"), "CustomerOrderDetail");
const CustomerProfile = page(() => import("./pages/customer/CustomerProfile"), "CustomerProfile");

function RouteMetadata() {
  const { pathname } = useLocation();
  const { isAuthenticated, role } = useAuth();
  useEffect(() => {
    const parts = pathname.split("/").filter(Boolean);
    const segment = parts[1] || parts[0];
    const labels = { login: "Sign in", register: "Create account", dashboard: "Dashboard", products: "Products", inventory: "Inventory", orders: "Orders", suppliers: "Suppliers", customers: "Customers", "stock-transactions": "Stock transactions", ai: "Automations", profile: "Profile", cart: "Cart", stock: "Stock" };
    let title = labels[segment] || (pathname === "/" ? "Workspace" : "Page unavailable");
    if (segment === "products" && parts[2]) title = parts[2] === "new" ? "Create product" : parts[3] === "edit" ? "Edit product" : "Product details";
    if (segment === "orders" && parts[2]) title = "Order details";
    if (isAuthenticated && ["admin", "supplier", "customer"].includes(parts[0]) && parts[0].toUpperCase() !== role) title = "Access denied";
    document.title = `${title} · StockFlow`;
  }, [pathname, isAuthenticated, role]);
  return null;
}

function NotFound() {
  return <main className="max-w-xl mx-auto px-6 py-20"><h1 className="font-headline-lg text-headline-lg">We couldn’t find this page</h1><p className="mt-3 mb-6 text-on-surface-variant">The link may have changed. Return to your workspace to continue.</p><Link to="/" className="inline-flex min-h-11 items-center px-4 py-2 rounded-lg bg-secondary text-white font-semibold">Return to workspace</Link></main>;
}

export default function App() {
  return (
    <><RouteMetadata /><Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loading label="Loading StockFlow…" /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<RoleRedirect />} />

      <Route element={<ProtectedRoute roles={["ADMIN"]} />}>
        <Route element={<AppShell />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/products/new" element={<AdminProductFormPage />} />
          <Route path="/admin/products/:id/edit" element={<AdminProductFormPage />} />
          <Route path="/admin/inventory" element={<AdminInventory />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/customers" element={<AdminCustomers />} />
          <Route path="/admin/suppliers" element={<AdminSuppliers />} />
          <Route path="/admin/stock-transactions" element={<AdminStockTransactions />} />
          <Route path="/admin/ai" element={<AdminAI />} />
          <Route path="/admin/profile" element={<AdminProfile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["SUPPLIER"]} />}>
        <Route element={<AppShell />}>
          <Route path="/supplier/dashboard" element={<SupplierDashboard />} />
          <Route path="/supplier/products" element={<SupplierProducts />} />
          <Route path="/supplier/products/new" element={<SupplierProductFormPage />} />
          <Route path="/supplier/products/:id/edit" element={<SupplierProductFormPage />} />
          <Route path="/supplier/stock" element={<SupplierStock />} />
          <Route path="/supplier/orders" element={<SupplierOrders />} />
          <Route path="/supplier/profile" element={<SupplierProfile />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute roles={["CUSTOMER"]} />}>
        <Route element={<AppShell />}>
          <Route path="/customer/dashboard" element={<CustomerDashboard />} />
          <Route path="/customer/products" element={<CustomerProducts />} />
          <Route path="/customer/products/:id" element={<CustomerProductDetail />} />
          <Route path="/customer/cart" element={<CustomerCart />} />
          <Route path="/customer/orders" element={<CustomerOrders />} />
          <Route path="/customer/orders/:id" element={<CustomerOrderDetail />} />
          <Route path="/customer/profile" element={<CustomerProfile />} />
        </Route>
      </Route>

      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/supplier" element={<Navigate to="/supplier/dashboard" replace />} />
      <Route path="/customer" element={<Navigate to="/customer/dashboard" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense></>
  );
}
