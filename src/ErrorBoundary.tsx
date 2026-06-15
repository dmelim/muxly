import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * App-wide safety net. Without a boundary, any error thrown during render or
 * from an effect unmounts the entire React tree in React 19 — the window goes
 * blank (just the page background), which is exactly the failure the in-pane
 * search was producing. This catches that, logs it, and shows a recoverable
 * fallback instead of a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the full error + component stack so a thrown search/render bug is
    // diagnosable from the devtools console instead of vanishing with the UI.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught a render/effect error:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#101215] p-8 text-center">
        <div className="max-w-lg">
          <p className="text-sm font-medium text-rose-300">Something broke in the UI.</p>
          <p className="mt-1 text-xs text-zinc-500">
            The error was caught so the window didn’t go blank. Details are in the devtools
            console.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded border border-white/10 bg-black/40 p-3 text-left font-mono text-[11px] text-zinc-400">
            {error.message}
          </pre>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
