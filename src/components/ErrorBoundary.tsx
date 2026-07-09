/**
 * Global error boundary — the last line of defense. A render-time crash
 * anywhere in the tree lands on a calm, branded recovery screen instead of
 * React's white page of death.
 *
 * Class component by necessity: error boundaries are the one React feature
 * with no hook equivalent (getDerivedStateFromError / componentDidCatch).
 *
 * "Try again" clears the boundary and re-renders in place — state held above
 * the crash point (AppState, localStorage-backed transcripts) survives, so a
 * transient failure costs nothing. "Reload app" is the full reset.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The componentStack pinpoints WHICH component crashed — the error's own
    // stack usually points into React internals and is far less useful.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <div className="glass error-boundary-card">
          <span className="error-boundary-icon" aria-hidden="true">
            🛰️
          </span>
          <h1 className="error-boundary-title">Something broke — not your fault</h1>
          <p className="error-boundary-text">
            An unexpected error interrupted the app. Your progress and transcripts are
            saved on this device, so nothing is lost.
          </p>
          <code className="error-boundary-detail">{error.message}</code>
          <div className="row error-boundary-actions">
            <button type="button" className="btn btn-primary" onClick={this.handleRetry}>
              Try again
            </button>
            <button type="button" className="btn btn-ghost" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
