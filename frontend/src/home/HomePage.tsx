import { useEffect } from 'react';
import './home.css';

interface GameItem {
  id: string;
  emoji: string;
  title: string;
  players: string;
  description: string;
  tvPath: string;
  playPath: string;
  themeClass: string;
  btnClass: string;
}

const GAMES: GameItem[] = [
  {
    id: 'spiritboard',
    emoji: '👻',
    title: 'Spirit Board',
    players: '2–16 players',
    description:
      'A Jackbox-style séance party game. The TV shows a Ouija board, everyone secretly bets on the answer, and every phone pulls the planchette together at the same time.',
    tvPath: '/spiritboard',
    playPath: '/spiritboard/play',
    themeClass: 'wn-card--spirit',
    btnClass: 'wn-btn--spirit',
  },
  {
    id: 'psychological',
    emoji: '🧠',
    title: 'Psychological',
    players: '2–12 players',
    description:
      'How well do your friends really know you? Each turn pairs two personality traits on a 10×10 grid—one player secretly marks where they see themself while everyone else tries to read their mind.',
    tvPath: '/psychological',
    playPath: '/psychological/play',
    themeClass: 'wn-card--psych',
    btnClass: 'wn-btn--psych',
  },
];

interface ProjectItem {
  title: string;
  description: string;
  href: string;
}

const PROJECTS: ProjectItem[] = [
  {
    title: 'GitHub (@wnojopra)',
    description: 'Open-source contributions, cloud tooling, and web game experiments.',
    href: 'https://github.com/wnojopra',
  },
  {
    title: 'willynojopranoto',
    description: 'Source code for this site and the real-time FastAPI + React multiplayer game engine.',
    href: 'https://github.com/wnojopra/willynojopranoto',
  },
];

export function HomePage() {
  useEffect(() => {
    document.title = 'Willy Nojopranoto';
  }, []);

  return (
    <div className="wn-root">
      <div className="wn-shell">
        <header className="wn-header">
          <a className="wn-brand" href="/">
            Willy Nojopranoto
          </a>
          <nav className="wn-nav" aria-label="Primary navigation">
            <a className="wn-nav__link" href="#games">
              🎮 Games
            </a>
            <a className="wn-nav__link" href="#projects">
              🛠️ Projects
            </a>
            <a className="wn-nav__link" href="https://github.com/wnojopra" target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
            <a className="wn-nav__link" href="https://www.linkedin.com/in/willy-nojopranoto/" target="_blank" rel="noreferrer">
              LinkedIn ↗
            </a>
          </nav>
        </header>

        <main className="wn-section">
          <section className="wn-hero" aria-labelledby="about-heading">
            <p className="wn-kicker">Software Engineer &amp; Builder</p>
            <h1 id="about-heading" className="wn-title">
              Hi, I’m Willy Nojopranoto.
            </h1>
            <p className="wn-bio">
              I build distributed systems, developer tools, and multiplayer living-room party games where the TV is the
              board and everyone’s phone is the controller. Pull up a game on the big screen below or join a room from
              your phone.
            </p>
          </section>
        </main>

        <section id="games" className="wn-section" aria-labelledby="games-heading">
          <div className="wn-section__head">
            <h2 id="games-heading" className="wn-h2">
              Party Games
            </h2>
            <p className="wn-section__sub">Open the TV view on a laptop or TV, then scan the QR code on your phone.</p>
          </div>

          <div className="wn-games">
            {GAMES.map((g) => (
              <article key={g.id} className={`wn-card ${g.themeClass}`}>
                <div className="wn-card__top">
                  <h3 className="wn-card__title">
                    <span aria-hidden="true">{g.emoji}</span> {g.title}
                  </h3>
                  <span className="wn-badge">{g.players}</span>
                </div>
                <p className="wn-card__desc">{g.description}</p>
                <div className="wn-card__actions">
                  <a id={`home-${g.id}-tv`} className={`wn-btn ${g.btnClass}`} href={g.tvPath}>
                    📺 Host on TV
                  </a>
                  <a id={`home-${g.id}-play`} className="wn-btn" href={g.playPath}>
                    📱 Join on Phone
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="projects" className="wn-section" aria-labelledby="projects-heading">
          <div className="wn-section__head">
            <h2 id="projects-heading" className="wn-h2">
              Projects &amp; Links
            </h2>
          </div>

          <div className="wn-projects">
            {PROJECTS.map((p) => (
              <a key={p.title} className="wn-project" href={p.href} target="_blank" rel="noreferrer">
                <h3 className="wn-project__title">
                  <span>{p.title}</span>
                  <span aria-hidden="true">↗</span>
                </h3>
                <p className="wn-project__desc">{p.description}</p>
              </a>
            ))}
          </div>
        </section>

        <footer className="wn-footer">
          <span>© {new Date().getFullYear()} Willy Nojopranoto</span>
          <span>willynojopranoto.com</span>
        </footer>
      </div>
    </div>
  );
}
