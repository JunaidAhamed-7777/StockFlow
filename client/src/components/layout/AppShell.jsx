import { Suspense, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { readStorage, writeStorage } from "../../utils/storage";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Loading } from "../ui/Loading";
import { ErrorBoundary } from "../ErrorBoundary";

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStorage("stockflow.navigation.collapsed", false) === true);
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  const contentRef = useRef(null);
  const mainRef = useRef(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    const navigated = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    setMobileOpen(false);
    window.scrollTo(0, 0);
    if (!navigated) return;
    const frame = requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
    if (contentRef.current) contentRef.current.inert = mobileOpen && !isDesktop;
    return () => { if (contentRef.current) contentRef.current.inert = false; };
  }, [mobileOpen, isDesktop]);

  function toggleCollapse() {
    setCollapsed((value) => {
      writeStorage("stockflow.navigation.collapsed", !value);
      return !value;
    });
  }

  return (
    <div className="min-h-screen bg-surface">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[100] focus:bg-white focus:rounded-lg focus:px-4 focus:py-2 focus:text-secondary">Skip to main content</a>
      <Sidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div ref={contentRef} className={`min-w-0 ${collapsed ? "lg:pl-16" : "lg:pl-sidebar-width"}`}>
        <Header onMenu={() => setMobileOpen(true)} collapsed={collapsed} mobileOpen={mobileOpen} />
        <main ref={mainRef} id="main-content" tabIndex={-1} className="relative min-h-screen w-full min-w-0 px-3 pb-6 pt-[4.75rem] sm:px-space-xl sm:pb-space-xl">
          <div className="flex flex-col w-full min-w-0 max-w-[1600px] mx-auto gap-space-xl">
            <ErrorBoundary key={location.pathname}><Suspense fallback={<Loading label="Loading workspace…" />}><Outlet /></Suspense></ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
