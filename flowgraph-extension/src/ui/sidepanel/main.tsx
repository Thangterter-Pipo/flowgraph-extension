import React from 'react';
import { createRoot } from 'react-dom/client';
import { installDiagnostics } from '../../shared/devDiagnostics';
installDiagnostics('sidepanel');
import { Sidepanel } from './Sidepanel';
import './sidepanel.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Sidepanel /></React.StrictMode>);
