import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./extension-src/event-planning', import.meta.url))
    }
  },
  build: {
    outDir: 'assets',
    emptyOutDir: false,
    cssCodeSplit: true,
    lib: {
      entry: fileURLToPath(new URL('./extension-src/event-planning/main.ts', import.meta.url)),
      name: 'PulsePlusEventPlanning',
      formats: ['iife'],
      fileName: () => 'event-planning.js',
      cssFileName: 'event-planning'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: '[name][extname]'
      }
    }
  }
});
