import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'db': path.resolve(__dirname, '../db'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://0.0.0.0:3000',
        changeOrigin: true,
        secure: false,
        ws: true
      },
      '/uploads': {
        target: 'http://0.0.0.0:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  define: {
    '__STRIPE_PUBLISHABLE_KEY__': JSON.stringify(process.env.STRIPE_PUBLISHABLE_KEY),
    '__API_URL__': JSON.stringify('http://0.0.0.0:3000')
  }
});
