import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['ai.doge00.com', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
