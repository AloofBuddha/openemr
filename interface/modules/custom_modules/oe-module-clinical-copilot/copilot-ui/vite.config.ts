import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/js',
    emptyOutDir: false,
    // Source maps so on-prod browser DevTools stack-traces into the
    // original .tsx files. Keep minification on — DevTools maps the
    // minified bundle back to readable source via the .map file, so
    // we get debuggability without paying for unminified runtime
    // bytes (500 KB vs 270 KB).
    sourcemap: true,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        format: 'iife',
        entryFileNames: 'copilot-bundle.js',
        assetFileNames: (info) =>
          info.name?.endsWith('.css') ? 'copilot-bundle.css' : '[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
