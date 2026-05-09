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

  // Guard against duplicate calls (Bootstrap event fires more than once per page).
  if (widget.dataset.copilotInitialized) return;
  widget.dataset.copilotInitialized = '1';

  // Place the widget so the patient identity bar sits at the very top:
  // [#patient-snapshot-root] → [copilot widget (chat)] → [#patient-dashboard-root]
  // If the snapshot mount exists (Week 2 layout), insert AFTER it.
  // Otherwise fall back to top-of-.main (legacy/standalone copilot).
  const mainDiv =
    document.querySelector<HTMLElement>('.main.mb-1') ??
    document.querySelector<HTMLElement>('.main');
  const snapshotRoot = document.getElementById('patient-snapshot-root');
  if (snapshotRoot && snapshotRoot.parentNode) {
    snapshotRoot.parentNode.insertBefore(widget, snapshotRoot.nextSibling);
  } else if (mainDiv) {
    mainDiv.insertBefore(widget, mainDiv.firstChild);
  }

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
