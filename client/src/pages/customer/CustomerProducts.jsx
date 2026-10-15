import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useListFilters } from "../../hooks/useListState";
import { useRemotePagination } from "../../hooks/useRemotePagination";
import { Pagination } from "../../components/ui/Pagination";
import { listProductPage } from "../../services/product.service";
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
  const returnTo = location.pathname + location.search;
  const { addItem, count } = useCart();
  const { filters, setFilters } = useListFilters({ search: "", category: "", supplier: "" });
  const [search, setSearch] = useState(filters.search);
  const [category, setCategory] = useState(filters.category);
  const [supplier, setSupplier] = useState(filters.supplier);
  const [productPage, setProductPage] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedRequestKey, setLoadedRequestKey] = useState("");
  const requestId = useRef(0);
  const requestController = useRef(null);
  const resultsRef = useRef(null);
  const focusResults = useRef(false);
  const pagination = useRemotePagination(productPage, { filters, pageSize: PAGE_SIZE, loadedRequestKey, ready: !loading && !error });
  const { page, rows: visibleProducts, total, requestedPage, requestKey } = pagination;
  const busy = loading || (!error && !pagination.ready);

  async function load() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const params = { page: requestedPage, pageSize: PAGE_SIZE };
      if (filters.search) params.search = filters.search;
      if (filters.category) params.category = filters.category;
      if (filters.supplier) params.supplier = filters.supplier;
      const [result, cats, sups] = await Promise.all([listProductPage(params, { signal: controller.signal }), getCategories(), getSuppliers()]);
      if (activeRequest !== requestId.current || controller.signal.aborted) return;
      setCategories(cats || []);
      setSuppliers(sups || []);
      setProductPage({ ...result, rows: enrichProducts(result.rows, cats || [], sups || []) });
      setLoadedRequestKey(requestKey);
    } catch (err) {
      if (activeRequest === requestId.current && !controller.signal.aborted) setError(getErrorMessage(err));
    } finally {
      if (activeRequest === requestId.current && !controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    setSearch(filters.search);
    setCategory(filters.category);
    setSupplier(filters.supplier);
  }, [filters.search, filters.category, filters.supplier]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; requestController.current?.abort(); };
  }, [requestKey]);

  useEffect(() => {
    if (!pagination.ready || !focusResults.current) return;
    focusResults.current = false;
    requestAnimationFrame(() => resultsRef.current?.focus());
  }, [pagination.ready]);

  function clearFilters() {
    setSearch("");
    setCategory("");
    setSupplier("");
    setFilters({ search: "", category: "", supplier: "" });
  }

  function addToCart(product) {
    if (Number(product.quantity) <= 0) return;
    addItem(product, 1);
    setNotice(`${product.name} added to your cart. Quantities are limited to available stock.`);
  }

  function changePage(nextPage) {
    focusResults.current = true;
    pagination.setPage(nextPage);
  }

  return (
    <>
      <PageHeader
        title="Product catalog"
        description="Find the supplies you need, compare availability, and build your next order."
        actions={<Button variant="outline" onClick={() => navigate("/customer/cart")} icon={<Icon name="shopping_cart" size={18} />}>Cart ({count})</Button>}
      />
      <Card className="p-space-base">
        <form noValidate onSubmit={(event) => { event.preventDefault(); setFilters({ search, category, supplier }); }} className="flex flex-col xl:flex-row gap-space-sm xl:items-end" aria-label="Filter product catalog">
          <ToolbarSearch value={search} onChange={setSearch} onClear={() => setFilters({ search: "", category, supplier })} placeholder="Search products or SKU" label="Search products" />
          <Select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select aria-label="Filter by supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((item) => <option key={item.id} value={item.id}>{item.companyName}</option>)}
          </Select>
          <Button type="submit" disabled={busy}>Apply filters</Button>
          <Button variant="ghost" onClick={clearFilters} disabled={busy}>Reset</Button>
        </form>
      </Card>
      <p className={notice ? "font-caption text-secondary" : "sr-only"} role="status" aria-live="polite">{notice}</p>
      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}
      {busy ? <PageSkeleton /> : !error && (total === 0 ? (
        <Card><EmptyState icon="storefront" title="No products found" description="Try a different search or clear your filters." actionLabel="Clear filters" onAction={clearFilters} /></Card>
      ) : (
        <>
          <p ref={resultsRef} tabIndex={-1} className="font-body-sm text-on-surface-variant scroll-mt-20" role="status">{total} products · Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}</p>
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
                    <p className="font-caption text-outline">{product.category?.name || "Uncategorized"} · {product.supplier?.companyName || "Supplier unavailable"}</p>
                    <div className="flex items-center justify-between font-body-sm mt-auto pt-space-sm">
                      <span className="font-headline-md tabular-nums">{formatCurrency(product.price)}</span>
                      <span className="text-on-surface-variant">{product.quantity} available</span>
                    </div>
                    <div className="flex gap-space-sm pt-space-xs">
                      <Button variant="outline" className="flex-1" aria-label={`View ${product.name}`} onClick={() => navigate(`/customer/products/${product.id}`, { state: { returnTo } })}>View details</Button>
                      <Button className="flex-1" disabled={status === "OUT"} aria-label={`Add ${product.name} to cart`} onClick={() => addToCart(product)} icon={<Icon name="add_shopping_cart" size={16} />}>
                        {status === "OUT" ? "Unavailable" : "Add to cart"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination {...pagination} onPageChange={changePage} label="Products" />
        </>
      ))}
    </>
  );
}
