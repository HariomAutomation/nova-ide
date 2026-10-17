import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

window.addEventListener('error', (e) => {
  window.__novaErrors = window.__novaErrors || [];
  window.__novaErrors.push(String(e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  window.__novaErrors = window.__novaErrors || [];
  window.__novaErrors.push(String(e.reason));
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
