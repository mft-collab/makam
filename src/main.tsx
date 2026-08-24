import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Fontlar (Inter, Outfit, JetBrains Mono) index.html'de TEK bir statik
// <link> ile senkron yükleniyor — burada eskiden ikinci, JS ile geç enjekte
// edilen bir <link> daha vardı (Inter'i tekrar indiriyordu, tarayıcı
// preloader'ının göremediği bir yükleme deseni oluşturuyordu; bkz. kod
// denetimi). JetBrains Mono artık index.html'deki tek link'e dahil.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

