import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { bxProxy } from './server/bxProxy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Wspolna instancja za reverse proxy: Vite odrzuca nieznany Host, a na serwerze nie ma czego otwierac.
  const publicHost = env.BX_PUBLIC_HOST?.trim();
  return {
    plugins: [react(), bxProxy(mode)],
    server: { port: 5180, open: !env.BX_PORTAL, allowedHosts: publicHost ? [publicHost] : undefined },
  };
});
