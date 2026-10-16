import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Last-resort screen for an unexpected rendering error. It sits above the providers, so it
 * cannot use translations: the text is short and shown in English and Telugu together.
 * Nothing about the error is logged or shown, because it could contain customer data.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Deliberately empty. No reporting service is approved yet (SECURITY.md).
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-dvh place-items-center bg-cement-50 px-4 text-center">
        <div className="max-w-sm">
          <h1 className="font-serif text-2xl text-ink-900">Something went wrong</h1>
          <p className="mt-1 text-ink-700" lang="te">
            ఏదో తప్పు జరిగింది
          </p>
          <p className="mt-3 text-ink-700">Reload the page. Your saved records are not affected.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 min-h-touch rounded-control bg-ink-900 px-6 font-medium text-white"
          >
            Reload
          </button>
        </div>
      </main>
    );
  }
}
