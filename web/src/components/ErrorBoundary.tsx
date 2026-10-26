import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches errors thrown while rendering, so one broken page shows a message instead of a blank screen.
 * Give it a `key` that changes with the route and it recovers as soon as you navigate elsewhere.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ArtShelf page error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <section className="panel" role="alert">
        <h1>Something went wrong on this page</h1>
        <p>{error.message}</p>
        <details>
          <summary>Technical details (send this when reporting the problem)</summary>
          <pre className="error-details">{error.stack ?? error.message}</pre>
        </details>
        <p className="actions">
          <a className="button" href="#/">
            Back to the home page
          </a>
          <button type="button" className="secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </section>
    );
  }
}
