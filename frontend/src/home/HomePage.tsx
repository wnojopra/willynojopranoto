import { useEffect } from 'react';
import './home.css';

interface GameAction {
  id: string;
  label: string;
  href: string;
  primary?: boolean;
  external?: boolean;
}

interface GameImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

interface GameItem {
  id: string;
  index: string;
  title: string;
  badge: string;
  description: string;
  image: GameImage;
  actions: GameAction[];
}

const GAMES: GameItem[] = [
  {
    id: 'spiritboard',
    index: '01',
    title: 'Spirit Board',
    badge: '2–16 players',
    description:
      'A Jackbox-style séance party game. The TV shows a Ouija board, everyone secretly bets on the answer, and every phone pulls the planchette together at the same time.',
    image: {
      src: '/images/spiritboard.jpg',
      alt: 'Spirit Board gameplay showing the Ouija board, planchette, question, and countdown timer',
      width: 1024,
      height: 583,
    },
    actions: [
      { id: 'home-spiritboard-tv', label: 'Host on TV', href: '/spiritboard', primary: true },
      { id: 'home-spiritboard-play', label: 'Join on Phone', href: '/spiritboard/play' },
    ],
  },
  {
    id: 'psychological',
    index: '02',
    title: 'Psychological',
    badge: '2–12 players',
    description:
      'How well do your friends really know you? Each turn pairs two personality traits on a 10×10 grid—one player secretly marks where they see themself while everyone else tries to read their mind.',
    image: {
      src: '/images/psychological.jpg',
      alt: 'Psychological gameplay showing the 10x10 personality trait grid, player pawns, and scoreboard',
      width: 1024,
      height: 567,
    },
    actions: [
      { id: 'home-psychological-tv', label: 'Host on TV', href: '/psychological', primary: true },
      { id: 'home-psychological-play', label: 'Join on Phone', href: '/psychological/play' },
    ],
  },
  {
    id: 'avalon',
    index: '03',
    title: 'Avalon',
    badge: '5–10 players',
    description:
      'A digital edition of The Resistance: Avalon. Check your secret loyalty on your phone, listen to the Night Phase narrator with your eyes closed, propose Quest Teams, and deduce who serves Mordred—before the Assassin finds Merlin.',
    image: {
      src: '/images/avalon.svg',
      alt: 'Avalon gameplay showing the Arthurian crest and 5-Quest tableau',
      width: 1024,
      height: 567,
    },
    actions: [
      { id: 'home-avalon-tv', label: 'Host on TV', href: '/avalon', primary: true },
      { id: 'home-avalon-play', label: 'Join on Phone', href: '/avalon/play' },
    ],
  },
  {
    id: 'wavelength',
    index: '04',
    title: 'Wavelength',
    badge: '2–16 players',
    description:
      'Tune into your friends’ brainwaves. The Psychic peeks at a hidden target on their phone and gives one clue between two opposing concepts—then everyone turns the dial to find the bullseye.',
    image: {
      src: '/images/wavelength.svg',
      alt: 'Wavelength gameplay showing the semicircle target dial, needle, and Cold to Hot spectrum card',
      width: 1024,
      height: 567,
    },
    actions: [
      { id: 'home-wavelength-tv', label: 'Host on TV', href: '/wavelength', primary: true },
      { id: 'home-wavelength-play', label: 'Join on Phone', href: '/wavelength/play' },
    ],
  },
  {
    id: 'battleweb',
    index: '05',
    title: 'BattleWeb',
    badge: 'WIP',
    description: 'Top-down arena brawler in the browser, inspired by Battlerite. Still a work in progress.',
    image: {
      src: '/images/battleweb.jpg',
      alt: 'BattleWeb gameplay showing top-down arena combat, health bars, and ability cooldowns',
      width: 1024,
      height: 521,
    },
    actions: [
      {
        id: 'home-battleweb-play',
        label: 'Play BattleWeb ↗',
        href: 'https://battleweb-270279587994.us-central1.run.app/',
        primary: true,
        external: true,
      },
    ],
  },
];

interface ProjectItem {
  title: string;
  domain: string;
  description: string;
  href: string;
  tone: 'mauve' | 'plum';
  image?: GameImage;
}

const PROJECTS: ProjectItem[] = [
  {
    title: 'Wedding Site',
    domain: 'ncwn2027.web.app',
    description: 'My wedding website.',
    href: 'https://ncwn2027.web.app/',
    tone: 'mauve',
    image: {
      src: '/images/wedding.jpg',
      alt: 'Natalie & Willy wedding website hero banner with floral illustration',
      width: 1024,
      height: 295,
    },
  },
  {
    title: 'Splitw',
    domain: 'splitw.duckdns.org',
    description: 'Web app for expense sharing with friends and groups.',
    href: 'https://splitw.duckdns.org/',
    tone: 'plum',
    image: {
      src: '/images/splitw.png',
      alt: 'Splitw expense-sharing dashboard showing groups and shared expenses',
      width: 1024,
      height: 507,
    },
  },
  {
    title: 'GitHub',
    domain: '@wnojopra',
    description: 'Open-source contributions, cloud tooling, and web game experiments.',
    href: 'https://github.com/wnojopra',
    tone: 'plum',
  },
  {
    title: 'willynojopranoto',
    domain: 'Source repo',
    description: 'Source code for this site and the real-time FastAPI + React multiplayer game engine.',
    href: 'https://github.com/wnojopra/willynojopranoto',
    tone: 'mauve',
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
          <nav className="wn-pillnav" aria-label="Primary navigation">
            <a className="wn-brand" href="/">
              Willy Nojopranoto
            </a>
            <div className="wn-nav__links">
              <a className="wn-nav__link" href="#games">
                Games
              </a>
              <a className="wn-nav__link" href="#projects">
                Projects
              </a>
              <a className="wn-nav__link" href="https://github.com/wnojopra" target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
            </div>
            <a
              className="wn-nav__cta"
              href="https://www.linkedin.com/in/willy-nojopranoto-bbb07a51/"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn ↗
            </a>
          </nav>
        </header>

        <main className="wn-main">
          <section className="wn-hero" aria-labelledby="about-heading">
            <h1 id="about-heading" className="wn-title">
              Hi, I’m Willy
              <br />
              <span className="wn-title__muted">Software Engineer</span>
            </h1>
            <p className="wn-bio">Here I list personal projects I’ve worked on.</p>
          </section>

          <section id="games" className="wn-section" aria-labelledby="games-heading">
            <div className="wn-section__head">
              <p className="wn-eyebrow">Playable in the browser</p>
              <h2 id="games-heading" className="wn-h2">
                GAMES
              </h2>
            </div>

            <div className="wn-games">
              {GAMES.map((g) => (
                <article key={g.id} className="wn-card">
                  <div className="wn-card__banner">
                    <span className="wn-card__index" aria-hidden="true">
                      {g.index}
                    </span>
                    <div className="wn-card__heading">
                      <h3 className="wn-card__title">{g.title}</h3>
                      <span className="wn-badge">{g.badge}</span>
                    </div>
                  </div>

                  <div className="wn-card__media">
                    <img
                      className="wn-card__img"
                      src={g.image.src}
                      alt={g.image.alt}
                      width={g.image.width}
                      height={g.image.height}
                    />
                  </div>

                  <div className="wn-card__info">
                    <p className="wn-card__desc">{g.description}</p>
                    <div className="wn-card__actions">
                      {g.actions.map((a) => (
                        <a
                          key={a.id}
                          id={a.id}
                          className={`wn-btn ${a.primary ? 'wn-btn--primary' : 'wn-btn--secondary'}`}
                          href={a.href}
                          target={a.external ? '_blank' : undefined}
                          rel={a.external ? 'noreferrer' : undefined}
                        >
                          <span>{a.label}</span>
                          {!a.external && <span aria-hidden="true">→</span>}
                        </a>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section id="projects" className="wn-section" aria-labelledby="projects-heading">
            <div className="wn-section__head">
              <p className="wn-eyebrow">More around the web</p>
              <h2 id="projects-heading" className="wn-h2">
                PROJECTS &amp; LINKS
              </h2>
            </div>

            <div className="wn-projects">
              {PROJECTS.map((p) => (
                <a
                  key={p.title}
                  className={`wn-project wn-project--${p.tone}`}
                  href={p.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.image && (
                    <div className="wn-project__media">
                      <img
                        className="wn-project__img"
                        src={p.image.src}
                        alt={p.image.alt}
                        width={p.image.width}
                        height={p.image.height}
                      />
                    </div>
                  )}
                  <div className="wn-project__row">
                    <div className="wn-project__left">
                      <h3 className="wn-project__title">{p.title}</h3>
                      <span className="wn-project__pill">{p.domain} ↗</span>
                    </div>
                    <p className="wn-project__desc">{p.description}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        </main>

        <footer className="wn-footer">
          <span>© {new Date().getFullYear()} Willy Nojopranoto</span>
          <span>willynojopranoto.com</span>
        </footer>
      </div>
    </div>
  );
}
