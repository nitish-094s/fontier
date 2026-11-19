import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/outfit';
import '@fontsource-variable/roboto-flex/full.css';
import '@fontsource-variable/doto';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './styles.css';
import App from './App';

// Desktop app: no browser context menu except in text fields.
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
