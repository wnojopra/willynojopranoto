import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// No StrictMode: its double-mounted effects would make the TV create two
// rooms in dev.
createRoot(document.getElementById('root')!).render(<App />);
