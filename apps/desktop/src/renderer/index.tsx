import { isMac } from './platform';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AgenticUXPrototype } from './AgenticUXPrototype';
import { DesktopChrome } from './DesktopChrome';
import { Phase04Layer } from './Phase04Layer';
import { QuickCapture } from './QuickCapture';
import { prototypeViewFromHash } from './agentic-ux-prototype-data';
import { applyAppPreferences, readAppPreferences } from './app-preferences';
import { UiLocaleProvider } from './ui-locale';
import './styles/index.css';
import '../types';

document.documentElement.dataset.platform = isMac ? 'macos' : 'other';
const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
const initialDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const initialReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
applyAppPreferences(document.documentElement, readAppPreferences(window.localStorage), {
  prefersDark: initialDark,
  prefersReducedMotion: initialReducedMotion,
  supportsBackdrop: CSS.supports('backdrop-filter', 'blur(1px)'),
});
const prototypeView = prototypeViewFromHash(window.location.hash);
createRoot(root).render(prototypeView
  ? <StrictMode><AgenticUXPrototype initialView={prototypeView} /></StrictMode>
  : <StrictMode><UiLocaleProvider><DesktopChrome><App /></DesktopChrome><QuickCapture /><Phase04Layer /></UiLocaleProvider></StrictMode>);
