import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message?: string;
}

// Global error boundary: prevents a single render crash (e.g. a backend 5xx
// returning undefined that hits a .toFixed) from white-screening the whole app.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("App error boundary caught:", error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center">
            <h1 className="text-lg font-bold text-foreground mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-1">
              A temporary data error occurred. This usually resolves on refresh.
            </p>
            {this.state.message && (
              <p className="text-xs text-muted-foreground/70 mb-4 font-mono break-words">
                {this.state.message}
              </p>
            )}
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm rounded-lg bg-[#0D7490] text-white hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
