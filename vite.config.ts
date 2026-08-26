import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // public/ хранит артефакты дистрибутива, а не веб-ассеты: копировать их в assets/ не нужно
  publicDir: false,
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
      name: 'TrickPlusEventPlanning',
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
