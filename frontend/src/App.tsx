import { lazy, Suspense } from 'react';
import { HomePage } from './home/HomePage';

// Spirit Board: loaded as its own chunk only on /spiritboard* pages.
const TvApp = lazy(() => import('./spiritboard/tv/TvApp').then((m) => ({ default: m.TvApp })));
const PlayApp = lazy(() => import('./spiritboard/play/PlayApp').then((m) => ({ default: m.PlayApp })));
const RelicsPage = lazy(() => import('./spiritboard/hunt/ClaimPage').then((m) => ({ default: m.RelicsPage })));
const ClaimPage = lazy(() => import('./spiritboard/hunt/ClaimPage').then((m) => ({ default: m.ClaimPage })));
const AdminPage = lazy(() => import('./spiritboard/hunt/AdminPage').then((m) => ({ default: m.AdminPage })));
const PrintSheet = lazy(() => import('./spiritboard/hunt/AdminPage').then((m) => ({ default: m.PrintSheet })));

// Psychological: loaded as its own chunk only on /psychological* pages.
const PsychTv = lazy(() => import('./psych/PsychTv').then((m) => ({ default: m.PsychTv })));
const PsychPlay = lazy(() => import('./psych/PsychPlay').then((m) => ({ default: m.PsychPlay })));

// Avalon: loaded as its own chunk only on /avalon* pages.
const AvalonTv = lazy(() => import('./avalon/AvalonTv').then((m) => ({ default: m.AvalonTv })));
const AvalonPlay = lazy(() => import('./avalon/AvalonPlay').then((m) => ({ default: m.AvalonPlay })));

export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/spiritboard') return <Suspense fallback={null}><TvApp /></Suspense>;
  if (path === '/spiritboard/play') return <Suspense fallback={null}><PlayApp /></Suspense>;
  if (path === '/spiritboard/relics') return <Suspense fallback={null}><RelicsPage /></Suspense>;
  if (path === '/spiritboard/admin') return <Suspense fallback={null}><AdminPage /></Suspense>;
  if (path === '/spiritboard/admin/print') return <Suspense fallback={null}><PrintSheet /></Suspense>;
  const claim = /^\/spiritboard\/claim\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (claim) return <Suspense fallback={null}><ClaimPage token={claim[1]} /></Suspense>;
  if (path === '/psychological') return <Suspense fallback={null}><PsychTv /></Suspense>;
  if (path === '/psychological/play') return <Suspense fallback={null}><PsychPlay /></Suspense>;
  if (path === '/avalon') return <Suspense fallback={null}><AvalonTv /></Suspense>;
  if (path === '/avalon/play') return <Suspense fallback={null}><AvalonPlay /></Suspense>;
  return <HomePage />;
}
