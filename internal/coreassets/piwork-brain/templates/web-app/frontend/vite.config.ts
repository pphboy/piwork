import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.PIWORK_WEB_BACKEND || 'http://127.0.0.1:8000';
export default defineConfig({
  plugins: [react()],
  define: { __PIWORK_FRONTEND_VERSION__: JSON.stringify(process.env.PIWORK_WEB_FRONTEND_VERSION || 'development') },
  server: {
    allowedHosts: ['.localhost', '.work', ...(process.env.PIWORK_WEB_ALLOWED_HOSTS || '').split(',').filter(Boolean)],
    proxy: Object.fromEntries(['/api', '/ui', '/pi', '/health'].map(path => [path, { target }])),
  },
  test: { environment: 'jsdom' },
});
