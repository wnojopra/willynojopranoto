import { useEffect } from 'react';
import './home.css';

interface GameAction {
  id: string;
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
}

interface GameItem {
  id: string;
  emoji: string;
  title: string;
  badge: string;
  description: string;
  themeClass: string;
  btnClass: string;
  actions: GameAction[];
}

const GAMES: GameItem[] = [
  {
    id: 'spiritboard',
    emoji: '👻',
    title: 'Spirit Board',
    badge: '2–16 players',
    description:
      'A Jackbox-style séance party game. The TV shows a Ouija board, everyone secretly bets on the answer, and every phone pulls the planchette together at the same time.',
    themeClass: 'wn-card--spirit',
    btnClass: 'wn-btn--spirit',
    actions: [
      { id: 'home-spiritboard-tv', label: '📺 Host on TV', href: '/spiritboard', primary: true },
      { id: 'home-spiritboard-play', label: '📱 Join on Phone', href: '/spiritboard/play' },
    ],
  },
  {
    id: 'psychological',
    emoji: '🧠',
    title: 'Psychological',
    badge: '2–12 players',
    description:
      'How well do your friends really know you? Each turn pairs two personality traits on a 10×10 grid—one player secretly marks where they see themself while everyone else tries to read their mind.',
    themeClass: 'wn-card--psych',
    btnClass: 'wn-btn--psych',
    actions: [
      { id: 'home-psychological-tv', label: '📺 Host on TV', href: '/psychological', primary: true },
      { id: 'home-psychological-play', label: '📱 Join on Phone', href: '/psychological/play' },
    ],
  },
  {
    id: 'battleweb',
    emoji: '⚔️',
    title: 'BattleWeb',
    badge: 'WIP',
    description: 'Top-down arena brawler in the browser, inspired by Battlerite. Still a work in progress.',
    themeClass: 'wn-card--battle',
    btnClass: 'wn-btn--battle',
    actions: [
      {
        id: 'home-battleweb-play',
        label: '⚔️ Play BattleWeb ↗',
        href: 'https://battleweb-270279587994.us-central1.run.app/',
        primary: true,
        external: true,
      },
    ],
  },
];

interface ProjectItem {
  title: string;
  description: string;
  href: string;
}

const PROJECTS: ProjectItem[] = [
  {
    title: 'Wedding Site (ncwn2027.web.app)',
    description: 'My wedding website.',
    href: 'https://ncwn2027.web.app/',
  },
  {
    title: 'Splitw (splitw.duckdns.org)',
    description: 'Web app for expense sharing with friends and groups.',
    href: 'https://splitw.duckdns.org/',
  },
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
            <a className="wn-nav__link" href="https://www.linkedin.com/in/willy-nojopranoto-bbb07a51/" target="_blank" rel="noreferrer">
              LinkedIn ↗
            </a>
          </nav>
        </header>

        <main className="wn-section">
          <section className="wn-hero" aria-labelledby="about-heading">
            <p className="wn-kicker">Software Engineer</p>
            <h1 id="about-heading" className="wn-title">
              Hi, I’m Willy.
            </h1>
            <p className="wn-bio">Here I list personal projects I’ve worked on.</p>
          </section>
        </main>

        <section id="games" className="wn-section" aria-labelledby="games-heading">
          <div className="wn-section__head">
            <h2 id="games-heading" className="wn-h2">
              Games
            </h2>
          </div>

          <div className="wn-games">
            {GAMES.map((g) => (
              <article key={g.id} className={`wn-card ${g.themeClass}`}>
                <div className="wn-card__top">
                  <h3 className="wn-card__title">
                    <span aria-hidden="true">{g.emoji}</span> {g.title}
                  </h3>
                  <span className="wn-badge">{g.badge}</span>
                </div>
                <p className="wn-card__desc">{g.description}</p>
                <div className="wn-card__actions">
                  {g.actions.map((a) => (
                    <a
                      key={a.id}
                      id={a.id}
                      className={`wn-btn ${a.primary ? g.btnClass : ''}`.trim()}
                      href={a.href}
                      target={a.external ? '_blank' : undefined}
                      rel={a.external ? 'noreferrer' : undefined}
                    >
                      {a.label}
                    </a>
                  ))}
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
