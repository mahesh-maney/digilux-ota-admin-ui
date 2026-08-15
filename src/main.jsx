import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { BRAND_NAME, APP_SUBTITLE } from './config';

document.title = `${BRAND_NAME} ${APP_SUBTITLE}`;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
