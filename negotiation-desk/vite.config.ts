// vite.config.ts — отдельное приложение «Стол переговоров».
//
// Две среды:
//   npm run dev      — http://localhost:5174, /api проксируется на основной сайт
//                      (по умолчанию http://localhost:3000, меняется DESK_API_PROXY);
//   npm run preview  — собранное PWA, прокси тот же.
//
// Прокси убирает CORS и сохраняет cookie-сессию: браузер считает localhost:5174
// и localhost:3000 одним сайтом (порт в cookie не входит) и сам отдаёт
// simonix_session при запросе к /api.

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.DESK_API_PROXY || 'http://localhost:3000';
  const proxy = {
    '/api': { target: apiTarget, changeOrigin: false },
  };

  return {
    // Относительные пути: приложение можно положить и в корень, и в /desk/.
    base: './',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      // Превью-домен Arena и тестовый стенд в локальной сети.
      allowedHosts: true,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      allowedHosts: true,
      proxy,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
