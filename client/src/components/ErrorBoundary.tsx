import { Component, type ReactNode } from "react";

/** Keep a rendering failure recoverable without exposing internal error data. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="max-w-xl mx-auto my-12 p-6 bg-white border border-outline-variant rounded-xl">
          <h1 className="text-headline-lg font-headline-lg mb-2">This view needs a refresh</h1>
          <p className="text-on-surface-variant mb-5">StockFlow could not display this view. Reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="min-h-10 px-4 py-2 rounded-lg bg-secondary text-white font-semibold">Reload page</button>
        </section>
      );
    }
    return this.props.children;
  }
}
