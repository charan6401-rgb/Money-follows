import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/noto-sans-telugu';
import '@/styles/index.css';
import { readEnv } from '@/lib/env';
import { ErrorBoundary } from '@/app/error-boundary';
import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/router';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

const result = readEnv();

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      {result.ok ? (
        <AppProviders apiBaseUrl={result.env.apiBaseUrl}>
          <AppRouter />
        </AppProviders>
      ) : (
        <main className="grid min-h-dvh place-items-center bg-cement-50 px-4 text-center">
          <div className="max-w-sm">
            <h1 className="font-serif text-2xl text-ink-900">Setup is incomplete</h1>
            <p className="mt-2 text-ink-700">
              This copy of the app is missing required settings. Tell whoever deployed it.
            </p>
            <ul className="mt-4 text-sm text-ink-600">
              {result.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        </main>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
