import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { initials } from "../../utils/format";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";

export function Header({ onMenu, collapsed, mobileOpen }) {
  const { user, role, logout, homePath } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef(null);
  const accountButtonRef = useRef(null);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event) => {
      if (!accountRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const searchTarget =
    role === "CUSTOMER" ? "/customer/products" : role === "SUPPLIER" ? "/supplier/products" : "/admin/products";

  function onSearch(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    navigate(`${searchTarget}?${params.toString()}`);
  }

  const headerAction =
    role === "ADMIN"
      ? { label: "Stock Adjustment", to: "/admin/inventory", icon: "add" }
      : role === "SUPPLIER"
        ? { label: "Add Product", to: "/supplier/products/new", icon: "add_box" }
        : { label: "View Cart", to: "/customer/cart", icon: "shopping_cart" };

  return (
    <header
      className={`fixed top-0 right-0 h-14 bg-surface-container-lowest border-b border-outline-variant z-40 px-3 sm:px-space-lg flex items-center justify-between gap-space-md ${collapsed ? "lg:left-16" : "lg:left-sidebar-width"} left-0`}
    >
      <div className="flex items-center gap-space-base shrink-0">
        <button type="button" className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-lg hover:bg-surface-container-low text-on-surface" onClick={onMenu} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="main-navigation">
          <Icon name="menu" />
        </button>
        <div className="hidden md:flex items-center gap-space-xs px-2.5 py-1 bg-surface-container-low rounded border border-outline-variant text-on-surface">
          <Icon name="domain" className="text-secondary" size={18} />
          <span className="font-label-sm text-label-sm">{role === "ADMIN" ? "Operations" : role === "SUPPLIER" ? "Supplier workspace" : "Procurement"}</span>
        </div>
      </div>
      <form role="search" aria-label="Product catalog" onSubmit={onSearch} className="flex-1 min-w-0 max-w-xl mx-auto hidden sm:block">
        <div className="relative flex items-center w-full">
          <Icon name="search" className="absolute left-2.5 text-outline pointer-events-none" size={18} />
          <input
            value={query}
            type="search"
            aria-label="Search products or SKUs"
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full h-9 pl-8 pr-12 bg-surface-container-low rounded-lg border border-outline-variant font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:bg-surface-container-lowest focus:border-secondary"
            placeholder="Search products or SKUs…"
          />
          <kbd className="absolute right-2 px-1.5 py-0.5 font-caption text-caption text-on-surface-variant bg-surface-container-highest rounded border border-outline-variant pointer-events-none">
            ↵
          </kbd>
        </div>
      </form>
      <div className="flex items-center gap-space-md shrink-0">
        <Button className="hidden xl:inline-flex" onClick={() => navigate(headerAction.to)} icon={<Icon name={headerAction.icon} size={16} />}>
          {headerAction.label}
        </Button>
        {role === "CUSTOMER" ? (
          <button
            type="button"
            onClick={() => navigate("/customer/cart")}
            aria-label={`View cart, ${count} ${count === 1 ? "item" : "items"}`}
            className="relative w-10 h-10 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-outline-variant"
          >
            <Icon name="shopping_cart" />
            {count > 0 ? (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-error text-on-error font-caption text-[10px] rounded-full flex items-center justify-center font-bold">
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </button>
        ) : null}
        <div className="relative" ref={accountRef} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
        }}>
          <button
            ref={accountButtonRef}
            type="button"
            aria-label={`Account options for ${user?.name || "current user"}`}
            aria-expanded={menuOpen}
            aria-controls="account-options"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center gap-space-sm min-h-10 rounded-lg pl-space-xs"
          >
            <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container font-label-sm flex items-center justify-center border border-outline-variant">
              {initials(user?.name)}
            </div>
            <div className="hidden xl:flex flex-col text-left">
              <span className="font-label-md text-label-md text-on-surface truncate leading-tight">{user?.name}</span>
              <span className="font-caption text-caption text-on-surface-variant truncate leading-tight">{user?.email}</span>
            </div>
          </button>
          {menuOpen ? (
            <div id="account-options" className="absolute right-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
              <button type="button" className="w-full text-left px-space-base py-space-sm hover:bg-surface-container-low font-body-sm" onClick={() => { setMenuOpen(false); navigate(homePath); }}>
                Portal home
              </button>
              <button type="button" className="w-full text-left px-space-base py-space-sm hover:bg-surface-container-low font-body-sm" onClick={() => { setMenuOpen(false); navigate(`/${role.toLowerCase()}/profile`); }}>
                Profile
              </button>
              <button type="button" className="w-full text-left px-space-base py-space-sm hover:bg-surface-container-low font-body-sm text-error" onClick={() => { setMenuOpen(false); logout(); navigate("/login"); }}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
