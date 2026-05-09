import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register service worker for offline support
const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Nova versão disponível! Deseja atualizar agora?')) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log('Aplicativo pronto para uso offline.');
  },
  immediate: true
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
