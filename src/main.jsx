import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import App from './App.jsx';
import { aplicarTemaGuardado } from './utils/tema.js';

aplicarTemaGuardado();

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
