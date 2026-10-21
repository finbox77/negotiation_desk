// main.tsx — точка входа Vite-приложения.
//
// Service worker регистрируется только в production-сборке: в dev он бы
// кешировал модули и мешал горячей перезагрузке.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Не найден #root');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).toString();
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Установка PWA не должна ломать само приложение.
    });
  });
}
