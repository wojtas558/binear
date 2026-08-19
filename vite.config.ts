import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { bxProxy } from './server/bxProxy';

export default defineConfig(({ mode }) => ({
  plugins: [react(), bxProxy(mode)],
  server: { port: 5180, open: true },
}));
