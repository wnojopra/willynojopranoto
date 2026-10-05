import { AdminPage, PrintSheet } from './hunt/AdminPage';
import { ClaimPage, RelicsPage } from './hunt/ClaimPage';
import { PlayApp } from './play/PlayApp';
import { TvApp } from './tv/TvApp';

export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/tv') return <TvApp />;
  if (path === '/play') return <PlayApp />;
  if (path === '/relics') return <RelicsPage />;
  if (path === '/admin') return <AdminPage />;
  if (path === '/admin/print') return <PrintSheet />;
  const claim = /^\/claim\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (claim) return <ClaimPage token={claim[1]} />;
  return <Home />;
}

function Home() {
  return (
    <main className="home">
      <h1 className="home__title">Spirit Board</h1>
      <p className="home__tagline">Ten hands. One planchette. No take-backs.</p>
      <nav className="home__choices" aria-label="Choose a screen">
        <a id="home-host" className="btn btn--primary" href="/tv">
          Host on this screen
        </a>
        <a id="home-join" className="btn" href="/play">
          Join from my phone
        </a>
      </nav>
    </main>
  );
}
