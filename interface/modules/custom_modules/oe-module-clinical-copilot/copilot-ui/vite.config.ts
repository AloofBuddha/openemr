import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/js',
    emptyOutDir: false,
    // Source maps + readable bundle so on-prod browser DevTools can stack-
    // trace into the original .tsx files. The bundle is small (~270 KB,
    // 86 KB gzipped) and not worth obfuscating; debuggability wins.
    sourcemap: true,
    minify: false,
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
