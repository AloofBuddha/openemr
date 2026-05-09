import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientDashboard } from './PatientDashboard';
import { setProxyConfig } from './fhir/client';
import './index.css';

declare global {
  interface Window {
    patientDashboardInit: (
      pid: number,
      proxyUrl: string,
      csrfToken: string,
    ) => void;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

window.patientDashboardInit = (pid, proxyUrl, csrfToken) => {
  const root = document.getElementById('patient-dashboard-root');
  if (!root) return;
  if (root.dataset.initialized) return;
  root.dataset.initialized = '1';

  setProxyConfig({ proxyUrl, csrfToken });

  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <PatientDashboard patientId={String(pid)} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
};
