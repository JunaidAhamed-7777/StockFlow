import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import logo from "../../assets/logo.svg";
import { useAuth } from "../../context/AuthContext";
import { useApiHealth } from "../../hooks/useApiHealth";
import { portalLabel } from "../../utils/roles";
import { Icon } from "../ui/Icon";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const NAV = {
  ADMIN: [
    {
      section: "Inventory",
      items: [
        { to: "/admin/dashboard", label: "Overview", icon: "grid_view" },
        { to: "/admin/ai", label: "Automations", icon: "hub" },
        { to: "/admin/products", label: "Products", icon: "inventory_2" },
        { to: "/admin/inventory", label: "Stock", icon: "warehouse" },
      ],
    },
    {
      section: "Suppliers",
      items: [{ to: "/admin/suppliers", label: "Suppliers", icon: "local_shipping" }],
    },
    {
      section: "Sales",
      items: [
        { to: "/admin/orders", label: "Orders", icon: "shopping_cart" },
        { to: "/admin/customers", label: "Customers", icon: "groups" },
      ],
    },
    {
      section: "Account",
      items: [
        { to: "/admin/stock-transactions", label: "Stock transactions", icon: "swap_horiz" },
        { to: "/admin/profile", label: "Profile", icon: "person" },
      ],
    },
  ],
  SUPPLIER: [
    {
      section: "Workspace",
      items: [
        { to: "/supplier/dashboard", label: "Dashboard", icon: "grid_view" },
        { to: "/supplier/products", label: "Products", icon: "inventory_2" },
        { to: "/supplier/products/new", label: "Add product", icon: "add_box" },
        { to: "/supplier/orders", label: "Orders", icon: "local_shipping" },
        { to: "/supplier/stock", label: "Stock", icon: "warehouse" },
      ],
    },
    {
      section: "Account",
      items: [{ to: "/supplier/profile", label: "Profile", icon: "person" }],
    },
  ],
  CUSTOMER: [
    {
      section: "Purchasing",
      items: [
        { to: "/customer/dashboard", label: "Dashboard", icon: "grid_view" },
        { to: "/customer/products", label: "Catalog", icon: "storefront" },
        { to: "/customer/cart", label: "Cart", icon: "shopping_cart" },
        { to: "/customer/orders", label: "Orders", icon: "local_shipping" },
      ],
    },
    {
      section: "Account",
      items: [{ to: "/customer/profile", label: "Profile", icon: "person" }],
    },
  ],
};

export function Sidebar({ open, onClose, collapsed, onToggleCollapse }) {
  const { role, supplier } = useAuth();
  const sidebarRef = useRef(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const compact = collapsed && isDesktop;
  useDialogFocus(sidebarRef, open && !isDesktop, onClose);
  useEffect(() => {
    if (sidebarRef.current) sidebarRef.current.inert = !isDesktop && !open;
  }, [isDesktop, open]);
  const apiHealth = useApiHealth();
  const sections = NAV[role] || [];
  const apiLabel = apiHealth === "live" ? "Service connected" : apiHealth === "down" ? "Service unavailable" : "Checking connection…";

  return (
    <>
      {open ? <div className="fixed inset-0 bg-on-surface/40 z-40 lg:hidden" onClick={onClose} aria-hidden="true" /> : null}
      <aside
        ref={sidebarRef}
        id="main-navigation"
        tabIndex={-1}
        role={open && !isDesktop ? "dialog" : undefined}
        aria-modal={open && !isDesktop ? true : undefined}
        aria-label="Main navigation"
        aria-hidden={!isDesktop && !open ? true : undefined}
        className={`${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed left-0 top-0 h-dvh ${compact ? "w-16" : "w-sidebar-width"} max-w-[calc(100vw-3rem)] lg:max-w-none bg-surface-container-lowest border-r border-outline-variant z-50 flex flex-col justify-between transition-all duration-200`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          <div className="h-14 px-space-base border-b border-outline-variant flex items-center justify-between shrink-0">
            <div className="flex items-center gap-space-sm min-w-0">
              <img alt="StockFlow" src={logo} className="h-7 w-7 object-contain shrink-0" />
              {!compact ? (
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-on-surface tracking-tight truncate">StockFlow</span>
                  </div>
                </div>
              ) : null}
            </div>
            <button type="button" className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg hover:bg-surface-container-low" onClick={onClose} aria-label="Close navigation"><Icon name="close" /></button>
          </div>
          {!compact ? (
            <div className="px-space-base py-space-md border-b border-outline-variant shrink-0">
              <p className="font-label-md text-label-md text-on-surface">{portalLabel(role)}</p>
              {supplier?.companyName ? <p className="mt-space-2xs font-caption text-caption text-on-surface-variant break-words">{supplier.companyName}</p> : null}
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto px-space-xs py-space-sm space-y-space-md">
            {sections.map((section) => (
              <div key={section.section} className="space-y-space-2xs">
                {!compact ? (
                  <div className="px-space-sm py-1 font-caption text-caption text-outline uppercase tracking-wider">{section.section}</div>
                ) : null}
                <nav className="space-y-space-2xs" aria-label={section.section}>
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to.endsWith("/products")}
                      onClick={onClose}
                      title={item.label}
                      aria-label={compact ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-space-sm min-h-10 px-space-sm py-2 rounded-lg transition-colors ${
                          isActive
                            ? "bg-primary-container text-on-primary-container font-medium"
                            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-body-sm text-body-sm"
                        }`
                      }
                    >
                      <Icon name={item.icon} />
                      {!compact ? <span className="truncate">{item.label}</span> : null}
                    </NavLink>
                  ))}
                </nav>
              </div>
            ))}
          </div>
        </div>
        <div className="p-space-sm border-t border-outline-variant bg-surface-container-low shrink-0">
          <div className="flex items-center justify-between gap-space-xs">
            {!compact ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <span aria-hidden="true" className={`inline-flex rounded-full h-2 w-2 shrink-0 ${apiHealth === "live" ? "bg-secondary" : apiHealth === "down" ? "bg-error" : "bg-outline"}`} />
                <span className="font-caption text-caption text-on-surface-variant">{apiLabel}</span>
              </div>
            ) : null}
            <button
              className="h-9 w-9 items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded transition-colors shrink-0 hidden lg:inline-flex"
              title={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              aria-controls="main-navigation"
              type="button"
              onClick={onToggleCollapse}
            >
              <Icon name="side_navigation" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
