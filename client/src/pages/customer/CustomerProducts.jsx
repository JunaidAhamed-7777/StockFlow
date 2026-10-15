import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listProducts } from "../../services/product.service";
import { getCategories, getSuppliers } from "../../services/discovery.service";
import { useCart } from "../../context/CartContext";
import { getErrorMessage } from "../../utils/errors";
import { enrichProducts, formatCurrency, stockStatus } from "../../utils/format";
import { PageHeader, ToolbarSearch } from "../../components/ui/PageHeader";
import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageSkeleton } from "../../components/ui/Loading";
import { Icon } from "../../components/ui/Icon";
import { ProductImage } from "../../components/ProductImage";

const PAGE_SIZE = 12;

export function CustomerProducts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { addItem, count } = useCart();
  const [search, setSearch] = useState(new URLSearchParams(location.search).get("search") || "");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const requestId = useRef(0);
  const resultsRef = useRef(null);

  async function load(searchOverride, categoryOverride = category, supplierOverride = supplier) {
    const activeRequest = ++requestId.current;
    const searchValue = (typeof searchOverride === "string" ? searchOverride : search).trim();
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (searchValue) params.search = searchValue;
      if (categoryOverride) params.category = categoryOverride;
      if (supplierOverride) params.supplier = supplierOverride;
      const [rows, cats, sups] = await Promise.all([listProducts(params), getCategories(), getSuppliers()]);
      if (activeRequest !== requestId.current) return;
      setCategories(cats || []);
      setSuppliers(sups || []);
      setProducts(enrichProducts(rows || [], cats || [], sups || []));
      setPage(1);
    } catch (err) {
      if (activeRequest === requestId.current) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    const next = new URLSearchParams(location.search).get("search") || "";
    setSearch(next);
    load(next);
    return () => { requestId.current += 1; };
  }, [location.search]);

  function clearFilters() {
    setSearch("");
    setCategory("");
    setSupplier("");
    load("", "", "");
  }

  function addToCart(product) {
    if (Number(product.quantity) <= 0) return;
    addItem(product, 1);
    setNotice(`${product.name} added to your cart. Quantities are limited to available stock.`);
  }

  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const visibleProducts = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function changePage(nextPage) {
    setPage(nextPage);
    requestAnimationFrame(() => resultsRef.current?.focus());
  }

  return (
    <>
      <PageHeader
        breadcrumb={<><span>Procurement</span><span className="text-outline-variant">/</span><span className="text-secondary font-medium">Catalog</span></>}
        title="Product catalog"
        description="Find the supplies you need, compare availability, and build your next order."
        actions={<Button variant="outline" onClick={() => navigate("/customer/cart")} icon={<Icon name="shopping_cart" size={18} />}>Cart ({count})</Button>}
      />
      <Card className="p-space-base">
        <form noValidate onSubmit={(event) => { event.preventDefault(); load(); }} className="flex flex-col xl:flex-row gap-space-sm xl:items-end" aria-label="Filter product catalog">
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search products or SKU" />
          <Select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select aria-label="Filter by supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}
          </Select>
          <Button type="submit" disabled={loading}>Apply filters</Button>
          <Button variant="ghost" onClick={clearFilters} disabled={loading}>Reset</Button>
        </form>
      </Card>
      <p className={notice ? "font-caption text-secondary" : "sr-only"} role="status" aria-live="polite">{notice}</p>
      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}
      {loading ? <PageSkeleton /> : !error && (products.length === 0 ? (
        <Card><EmptyState icon="storefront" title="No products found" description="Try a different search or clear your filters." actionLabel="Clear filters" onAction={clearFilters} /></Card>
      ) : (
        <>
          <p ref={resultsRef} tabIndex={-1} className="font-body-sm text-on-surface-variant scroll-mt-20" role="status">{products.length} products · Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, products.length)}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-base">
            {visibleProducts.map((product) => {
              const status = stockStatus(product);
              return (
                <Card key={product.id} className="overflow-hidden flex flex-col hover:shadow-sm transition-shadow">
                  <ProductImage product={product} className="h-44 w-full" />
                  <div className="p-space-lg flex flex-col gap-space-sm flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-space-sm">
                      <p className="font-caption text-outline font-mono-data break-all">{product.sku}</p>
                      <StatusBadge status={status} />
                    </div>
                    <h2 className="font-headline-sm text-headline-sm leading-snug break-words">{product.name}</h2>
                    <p className="font-body-sm text-on-surface-variant line-clamp-2 min-h-[42px]">{product.description || "Contact the supplier for product details."}</p>
                    <p className="font-caption text-outline">{product.category?.name || "Uncategorized"} · {product.supplier?.companyName || "Supplier unavailable"}</p>
                    <div className="flex items-center justify-between font-body-sm mt-auto pt-space-sm">
                      <span className="font-headline-md tabular-nums">{formatCurrency(product.price)}</span>
                      <span className="text-on-surface-variant">{product.quantity} available</span>
                    </div>
                    <div className="flex gap-space-sm pt-space-xs">
                      <Button variant="outline" className="flex-1" aria-label={`View ${product.name}`} onClick={() => navigate(`/customer/products/${product.id}`)}>View details</Button>
                      <Button className="flex-1" disabled={status === "OUT"} aria-label={`Add ${product.name} to cart`} onClick={() => addToCart(product)} icon={<Icon name="add_shopping_cart" size={16} />}>
                        {status === "OUT" ? "Unavailable" : "Add to cart"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          {pageCount > 1 ? <nav aria-label="Catalog pagination" className="flex items-center justify-between gap-space-base">
            <Button variant="outline" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</Button>
            <span className="font-body-sm" aria-live="polite">Page {page} of {pageCount}</span>
            <Button variant="outline" disabled={page === pageCount} onClick={() => changePage(page + 1)}>Next</Button>
          </nav> : null}
        </>
      ))}
    </>
  );
}
