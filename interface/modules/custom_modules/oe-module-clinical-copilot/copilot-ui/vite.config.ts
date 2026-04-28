import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public/js',
    emptyOutDir: false,
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
