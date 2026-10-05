import { PlayApp } from './play/PlayApp';
import { TvApp } from './tv/TvApp';

export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/tv') return <TvApp />;
  if (path === '/play') return <PlayApp />;
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
