import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { initials } from "../../utils/format";
import { Icon } from "../ui/Icon";
import { Button } from "../ui/Button";
import { ToolbarSearch } from "../ui/PageHeader";

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

  useEffect(() => {
    setQuery(location.pathname === searchTarget ? new URLSearchParams(location.search).get("search") || "" : "");
  }, [location.pathname, location.search, searchTarget]);

  function onSearch(event) {
    event.preventDefault();
    const params = new URLSearchParams(location.pathname === searchTarget ? location.search : "");
    params.delete("page");
    if (query.trim()) params.set("search", query.trim());
    else params.delete("search");
    navigate(`${searchTarget}${params.size ? `?${params}` : ""}`);
  }

  const headerAction =
    role === "ADMIN"
      ? { label: "Manage stock", to: "/admin/inventory", icon: "warehouse" }
      : role === "SUPPLIER"
        ? { label: "Add product", to: "/supplier/products/new", icon: "add_box" }
        : { label: "View cart", to: "/customer/cart", icon: "shopping_cart" };

  return (
    <header
      className={`fixed top-0 right-0 h-14 bg-surface-container-lowest border-b border-outline-variant z-40 px-3 sm:px-space-lg flex items-center justify-between gap-space-md ${collapsed ? "lg:left-16" : "lg:left-sidebar-width"} left-0`}
    >
      <div className="flex items-center gap-space-base shrink-0">
        <button type="button" className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-lg hover:bg-surface-container-low text-on-surface" onClick={onMenu} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="main-navigation">
          <Icon name="menu" />
        </button>
        <div className="hidden md:flex items-center text-on-surface-variant">
          <span className="font-label-sm text-label-sm">{role === "ADMIN" ? "Operations" : role === "SUPPLIER" ? "Supplier workspace" : "Procurement"}</span>
        </div>
      </div>
      <form noValidate role="search" aria-label="Product catalog" onSubmit={onSearch} className="flex-1 min-w-0 max-w-xl mx-auto hidden sm:block">
        <ToolbarSearch value={query} onChange={setQuery} label="Search products or SKUs" placeholder="Search products or SKUs…" onClear={() => {
          if (location.pathname === searchTarget) {
            const params = new URLSearchParams(location.search);
            params.delete("search");
            params.delete("page");
            navigate(`${searchTarget}${params.size ? `?${params}` : ""}`);
          }
        }} />
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
            className="flex items-center gap-space-sm min-h-10 rounded-lg px-space-xs hover:bg-surface-container-low active:bg-surface-container"
          >
            <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container font-label-sm flex items-center justify-center border border-outline-variant">
              {initials(user?.name)}
            </div>
            <div className="hidden xl:flex flex-col text-left">
              <span className="font-label-md text-label-md text-on-surface max-w-36 truncate leading-tight">{user?.name}</span>
              <span className="font-caption text-caption text-on-surface-variant max-w-36 truncate leading-tight">{user?.email}</span>
            </div>
          </button>
          {menuOpen ? (
            <div id="account-options" className="absolute right-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
              <button type="button" className="w-full text-left px-space-base py-space-sm hover:bg-surface-container-low font-body-sm" onClick={() => { setMenuOpen(false); navigate(homePath); }}>
                Workspace home
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
