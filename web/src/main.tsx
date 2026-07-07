import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { Icon } from './components/Icon'

// Most entry mutations app-wide are onSuccess-only: without a global handler
// a failed save silently re-enables the button and the entry is lost. The
// MutationCache onError below catches every mutation failure; mutations that
// declare their own onError (inline form feedback etc.) are skipped so they
// aren't double-reported.
let reportMutationError: (msg: string) => void = () => {};

// React Query defaults tuned for the hub:
//   - quests/player/lists are read often and invalidated by socket
//     events, so we don't need aggressive refetch-on-focus.
//   - 30s staleTime keeps the HUD snappy without spamming the API.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError) return; // handled locally — don't double-report
      reportMutationError(error instanceof Error ? error.message : 'Request failed');
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Fixed banner for otherwise-silent mutation failures (styled like the
 *  App/MediaView toasts; z-index above the QuickCapture overlay at 2000). */
function MutationErrorToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    reportMutationError = (m) => {
      setMsg(m);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 8000);
    };
    return () => {
      reportMutationError = () => {};
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', bottom: 16, right: 16, maxWidth: 340, padding: 14,
        background: 'var(--panel)', border: '1px solid var(--red)',
        borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 12.5, zIndex: 3000,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <Icon name="bell" size={14} style={{ color: 'var(--red)', flex: 'none' }} />
      <span>
        <span className="mono" style={{ color: 'var(--red)', letterSpacing: '0.1em', fontSize: 10.5 }}>SAVE FAILED · </span>
        {msg}
      </span>
      <button onClick={() => setMsg(null)} className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: 11 }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
      <MutationErrorToast />
    </QueryClientProvider>
  </StrictMode>,
)
