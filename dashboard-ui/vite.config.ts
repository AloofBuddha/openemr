import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Bundle the patient-dashboard React app as an IIFE that drops into the
// existing OpenEMR copilot module's public/js directory, mirroring how
// copilot-bundle.js is shipped. demographics.php loads the bundle and
// calls `window.patientDashboardInit(pid, fhirProxyUrl, csrfToken)`.
// No separate /dashboard/ URL — the dashboard is an extension hooked
// into OpenEMR's existing patient summary page.
const COPILOT_MODULE_PUBLIC =
  '../interface/modules/custom_modules/oe-module-clinical-copilot/public/js';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
  },
  build: {
    outDir: COPILOT_MODULE_PUBLIC,
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        entryFileNames: 'patient-dashboard-bundle.js',
        assetFileNames: (info) =>
          info.name?.endsWith('.css') ? 'patient-dashboard-bundle.css' : '[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
