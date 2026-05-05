import React from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotPanel } from './CopilotPanel';

type DocCategory = { id: number; name: string };

declare global {
  interface Window {
    copilotInit: (
      pid: number,
      apiUrl: string,
      csrfToken: string,
      physicianId: number,
      webRoot: string,
      categories: DocCategory[],
    ) => void;
  }
}

window.copilotInit = (pid, apiUrl, csrfToken, physicianId, webRoot, categories) => {
  const widget = document.getElementById('copilot-widget');
  if (!widget) return;

  // Move to top of .main div (full-width, above two-column card layout)
  const mainDiv =
    document.querySelector<HTMLElement>('.main.mb-1') ??
    document.querySelector<HTMLElement>('.main');
  if (mainDiv) mainDiv.insertBefore(widget, mainDiv.firstChild);

  widget.style.display = '';
  createRoot(widget).render(
    <CopilotPanel
      pid={pid}
      apiUrl={apiUrl}
      csrfToken={csrfToken}
      physicianId={physicianId}
      webRoot={webRoot}
      categories={categories}
    />
  );
};
