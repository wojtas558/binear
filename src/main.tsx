import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
// Inter hostowany lokalnie. Wczesniej byl tylko wpisany w font-family i nigdy
// sie nie wczytywal — Windows podstawial Segoe UI, stad zupelnie inny charakter.
import '@fontsource-variable/inter';
// Sora (domyslny) i Fira Code — hostowane lokalnie, ZMIENNE (pelen zakres wag),
// wiec pogrubienie dziala niezaleznie od systemu. Wybor w panelu widoku (Czcionka).
import '@fontsource-variable/sora';
import '@fontsource-variable/fira-code';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
