import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, getJson, postJson } from '../spiritboard/hunt/api';
import './admin.css';

type GameId = 'spiritboard' | 'psych' | 'avalon' | 'wavelength';

interface GameMeta {
  id: GameId;
  label: string;
  color: string;
}

const GAMES: GameMeta[] = [
  { id: 'spiritboard', label: 'Spirit Board', color: '#e8a33d' },
  { id: 'psych', label: 'Psychological', color: '#e85d75' },
  { id: 'avalon', label: 'Avalon', color: '#66a5ad' },
  { id: 'wavelength', label: 'Wavelength', color: '#c47ac0' },
];

const GAME_LOOKUP: Record<string, GameMeta> = Object.fromEntries(GAMES.map((g) => [g.id, g]));

interface LiveGameSnap {
  activeRooms: number;
  lobbyRooms: number;
  playingRooms: number;
  maxRooms: number;
  connectedPlayers: number;
  humanSeats: number;
  botSeats: number;
}

interface LiveSnapshot {
  activeRooms: number;
  maxRoomsTotal: number;
  openWebSockets: number;
  tvSockets: number;
  playerSockets: number;
  concurrencyLimit: number;
  humanSeats: number;
  botSeats: number;
  byGame: Record<GameId, LiveGameSnap>;
}

interface DailyPoint {
  date: string;
  dau: number;
  dauByGame: Record<GameId, number>;
  roomsCreated: number;
  roomsCreatedByGame: Record<GameId, number>;
  roomsStarted: number;
  roomsStartedByGame: Record<GameId, number>;
  roundsPlayed: number;
  roundsPlayedByGame: Record<GameId, number>;
  peakConcurrentRooms: number;
  peakConcurrentPlayers: number;
}

interface MonthlyPoint {
  month: string;
  mau: number;
  mauByGame: Record<GameId, number>;
  roomsCreated: number;
  roomsCreatedByGame: Record<GameId, number>;
  roomsStarted: number;
  roomsStartedByGame: Record<GameId, number>;
  roundsPlayed: number;
  roundsPlayedByGame: Record<GameId, number>;
  peakConcurrentRooms: number;
  peakConcurrentPlayers: number;
}

interface RecentRoom {
  game: string;
  createdAt: number;
  closedAt: number;
  durationSec: number;
  reason: string;
  started: boolean;
  roundsPlayed: number;
  humanPlayers: number;
  botPlayers: number;
  peakConcurrent: number;
  country: string | null;
  refererHost: string | null;
}

interface AnalyticsPayload {
  timezone: string;
  live: LiveSnapshot;
  daily: DailyPoint[];
  monthly: MonthlyPoint[];
  recentRooms: RecentRoom[];
}

type AdminSession = { configured: boolean; admin: boolean };
type DailyMetric = 'dau' | 'roomsStarted' | 'roomsCreated' | 'roundsPlayed';
type MonthlyMetric = 'mau' | 'roomsStarted' | 'roomsCreated';

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Could not reach the server.';
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatTimestampPT(epochSec: number): string {
  try {
    return new Date(epochSec * 1000).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return new Date(epochSec * 1000).toLocaleString();
  }
}

function shortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function StackedBarChart<T extends { label: string; total: number; byGame?: Record<GameId, number> }>({
  points,
  stacked,
  unit,
  chartId,
}: {
  points: T[];
  stacked: boolean;
  unit: string;
  chartId: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 760;
  const height = 190;
  const padLeft = 34;
  const padRight = 10;
  const padTop = 14;
  const padBottom = 26;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const maxVal = Math.max(4, ...points.map((p) => p.total));
  // Round ceiling to a clean tick multiple
  const niceMax = maxVal <= 5 ? 5 : Math.ceil(maxVal / 5) * 5;
  const step = innerW / Math.max(1, points.length);
  const barW = Math.max(4, Math.min(28, step * 0.68));

  const activePoint = hoverIdx !== null ? points[hoverIdx] : points[points.length - 1];

  return (
    <div className="adm-chart-wrap">
      <svg
        id={chartId}
        className="adm-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${unit} bar chart`}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.5, 1].map((frac) => {
          const y = padTop + innerH * (1 - frac);
          const tickVal = Math.round(niceMax * frac);
          return (
            <g key={frac}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="rgba(249, 225, 237, 0.09)"
                strokeDasharray={frac === 0 ? undefined : '3 3'}
              />
              <text
                x={padLeft - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#b89aa9"
              >
                {tickVal}
              </text>
            </g>
          );
        })}

        {points.map((pt, i) => {
          const cx = padLeft + i * step + step / 2;
          const x = cx - barW / 2;
          const isHovered = hoverIdx === i;
          const showLabel =
            points.length <= 12 || i === 0 || i === points.length - 1 || i % 5 === 0;

          let cursorY = padTop + innerH;
          const segments: { color: string; y: number; h: number }[] = [];

          if (stacked && pt.byGame && pt.total > 0) {
            for (const g of GAMES) {
              const v = pt.byGame[g.id] || 0;
              if (v <= 0) continue;
              const h = (v / niceMax) * innerH;
              cursorY -= h;
              segments.push({ color: g.color, y: cursorY, h });
            }
          } else if (pt.total > 0) {
            const h = (pt.total / niceMax) * innerH;
            segments.push({ color: '#f0b884', y: padTop + innerH - h, h });
          }

          return (
            <g
              key={pt.label}
              onMouseEnter={() => setHoverIdx(i)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={padLeft + i * step}
                y={padTop}
                width={step}
                height={innerH + padBottom}
                fill={isHovered ? 'rgba(249, 225, 237, 0.05)' : 'transparent'}
              />
              {segments.length === 0 ? (
                <rect
                  x={x}
                  y={padTop + innerH - 1.5}
                  width={barW}
                  height={1.5}
                  fill="rgba(249, 225, 237, 0.14)"
                />
              ) : (
                segments.map((seg, idx) => (
                  <rect
                    key={idx}
                    x={x}
                    y={seg.y}
                    width={barW}
                    height={Math.max(1.5, seg.h)}
                    rx={idx === segments.length - 1 ? 2.5 : 0}
                    fill={seg.color}
                    opacity={hoverIdx === null || isHovered ? 0.95 : 0.55}
                  />
                ))
              )}
              {showLabel && (
                <text
                  x={cx}
                  y={height - 7}
                  textAnchor="middle"
                  fontSize="10"
                  fill={isHovered ? '#f9eff4' : '#b89aa9'}
                >
                  {pt.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="adm-chart-detail">
        {activePoint ? (
          <span>
            <strong>{activePoint.label}:</strong> {activePoint.total} {unit}
            {stacked && activePoint.byGame && activePoint.total > 0 && (
              <>
                {' · '}
                {GAMES.filter((g) => (activePoint.byGame?.[g.id] || 0) > 0)
                  .map((g) => `${g.label}: ${activePoint.byGame?.[g.id]}`)
                  .join(' · ')}
              </>
            )}
          </span>
        ) : (
          <span />
        )}

        {stacked && (
          <div className="adm-legend">
            {GAMES.map((g) => (
              <span key={g.id} className="adm-legend__item">
                <span className="adm-dot" style={{ background: g.color }} />
                {g.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/admin/login', { passcode });
      setPasscode('');
      onLoggedIn();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="adm-login-card" onSubmit={submit}>
      <div>
        <p className="adm-eyebrow">Admin Only</p>
        <h1 className="adm-title">Site &amp; Game Analytics</h1>
      </div>
      <label className="adm-field">
        <span className="adm-field__label">Host passcode</span>
        <input
          id="adm-passcode"
          className="adm-field__input"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoComplete="current-password"
          required
          maxLength={200}
        />
      </label>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      <button
        id="adm-login-btn"
        className="adm-btn adm-btn--primary"
        type="submit"
        disabled={busy || !passcode}
      >
        Unlock Dashboard
      </button>
    </form>
  );
}

export function AdminDashboard() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dailyMetric, setDailyMetric] = useState<DailyMetric>('dau');
  const [monthlyMetric, setMonthlyMetric] = useState<MonthlyMetric>('mau');

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getJson<AnalyticsPayload>('/api/admin/analytics');
      setData(payload);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSession((s) => (s ? { ...s, admin: false } : s));
      } else {
        setError(errMsg(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const checkSession = useCallback(async () => {
    setError(null);
    try {
      const s = await getJson<AdminSession>('/api/admin/session');
      setSession(s);
      if (s.admin) {
        await loadAnalytics();
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [loadAnalytics]);

  useEffect(() => {
    document.title = 'Analytics · Willy Nojopranoto';
    checkSession();
  }, [checkSession]);

  const logout = async () => {
    try {
      await postJson('/api/admin/logout');
    } finally {
      setData(null);
      setSession((s) => (s ? { ...s, admin: false } : s));
    }
  };

  if (!session && !error) {
    return (
      <div className="adm-root">
        <div className="adm-shell">
          <p className="adm-dim">Checking session…</p>
        </div>
      </div>
    );
  }

  if (session && !session.configured) {
    return (
      <div className="adm-root">
        <div className="adm-login-card">
          <p className="adm-eyebrow">Admin Disabled</p>
          <h1 className="adm-title">No Passcode Configured</h1>
          <p className="adm-panel__sub">
            Set <code>SB_ADMIN_PASSCODE</code> on the server to unlock <code>/admin</code>.
          </p>
          <a className="adm-btn" href="/">
            ← Back to homepage
          </a>
        </div>
      </div>
    );
  }

  if (!session?.admin) {
    return (
      <div className="adm-root">
        <AdminLoginForm onLoggedIn={checkSession} />
      </div>
    );
  }

  const live = data?.live;
  const today = data?.daily[data.daily.length - 1];
  const thisMonth = data?.monthly[data.monthly.length - 1];
  const rooms30dCreated = data?.daily.reduce((sum, d) => sum + d.roomsCreated, 0) ?? 0;
  const rooms30dStarted = data?.daily.reduce((sum, d) => sum + d.roomsStarted, 0) ?? 0;
  const rounds30d = data?.daily.reduce((sum, d) => sum + d.roundsPlayed, 0) ?? 0;

  const wsPct = live
    ? Math.min(100, Math.round((live.openWebSockets / Math.max(1, live.concurrencyLimit)) * 100))
    : 0;
  const wsColor =
    wsPct >= 85 ? 'var(--adm-danger)' : wsPct >= 60 ? 'var(--adm-warn)' : 'var(--adm-ok)';

  const dailyPoints = (data?.daily ?? []).map((d) => {
    if (dailyMetric === 'dau') {
      return { label: shortDate(d.date), total: d.dau };
    }
    if (dailyMetric === 'roomsStarted') {
      return {
        label: shortDate(d.date),
        total: d.roomsStarted,
        byGame: d.roomsStartedByGame,
      };
    }
    if (dailyMetric === 'roomsCreated') {
      return {
        label: shortDate(d.date),
        total: d.roomsCreated,
        byGame: d.roomsCreatedByGame,
      };
    }
    return {
      label: shortDate(d.date),
      total: d.roundsPlayed,
      byGame: d.roundsPlayedByGame,
    };
  });

  const monthlyPoints = (data?.monthly ?? []).map((m) => {
    if (monthlyMetric === 'mau') {
      return { label: m.month, total: m.mau };
    }
    if (monthlyMetric === 'roomsStarted') {
      return {
        label: m.month,
        total: m.roomsStarted,
        byGame: m.roomsStartedByGame,
      };
    }
    return {
      label: m.month,
      total: m.roomsCreated,
      byGame: m.roomsCreatedByGame,
    };
  });

  return (
    <div className="adm-root">
      <div className="adm-shell">
        <header className="adm-topbar">
          <div className="adm-title-wrap">
            <p className="adm-eyebrow">willynojopranoto.com · Admin</p>
            <h1 className="adm-title">Usage &amp; Capacity Dashboard</h1>
          </div>
          <nav className="adm-actions" aria-label="Admin navigation">
            <a className="adm-btn" href="/">
              ← Homepage
            </a>
            <a className="adm-btn" href="/spiritboard/admin">
              👻 Hunt &amp; Questions
            </a>
            <button
              id="adm-refresh"
              className="adm-btn"
              type="button"
              onClick={loadAnalytics}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <button id="adm-logout" className="adm-btn" type="button" onClick={logout}>
              Log out
            </button>
          </nav>
        </header>

        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}

        {live && (
          <section className="adm-panel" aria-labelledby="adm-live-heading">
            <div className="adm-panel__head">
              <h2 id="adm-live-heading" className="adm-panel__title">
                Live Instance Capacity (Single Container · 1 vCPU / 512 MiB)
              </h2>
              <p className="adm-panel__sub">
                {live.activeRooms} / {live.maxRoomsTotal} rooms open · {live.humanSeats} human seat
                {live.humanSeats === 1 ? '' : 's'}
                {live.botSeats > 0 ? ` · ${live.botSeats} bots` : ''}
              </p>
            </div>

            <div className="adm-meter-row">
              <div className="adm-meter-labels">
                <span>
                  Open WebSockets: <strong>{live.openWebSockets}</strong> / {live.concurrencyLimit}{' '}
                  <span className="adm-dim">
                    ({live.tvSockets} TV, {live.playerSockets} phones)
                  </span>
                </span>
                <span>{wsPct}% of Cloud Run concurrency cap</span>
              </div>
              <div className="adm-meter-track">
                <div
                  className="adm-meter-fill"
                  style={{ width: `${Math.max(wsPct, live.openWebSockets > 0 ? 2 : 0)}%`, background: wsColor }}
                />
              </div>
            </div>

            <div className="adm-live-games">
              {GAMES.map((g) => {
                const gs = live.byGame[g.id];
                return (
                  <div key={g.id} className="adm-live-pill">
                    <span className="adm-live-pill__name">
                      <span className="adm-dot" style={{ background: g.color }} />
                      {g.label}
                    </span>
                    <span className="adm-live-pill__meta">
                      <strong>
                        {gs?.activeRooms ?? 0} / {gs?.maxRooms ?? 20}
                      </strong>{' '}
                      rooms
                      <br />
                      {gs?.playingRooms ?? 0} playing · {gs?.connectedPlayers ?? 0} phones
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="adm-kpis" aria-label="Headline metrics">
          <div className="adm-kpi">
            <span className="adm-kpi__label">Today Active Players (DAU)</span>
            <span className="adm-kpi__value" id="adm-kpi-dau">
              {today?.dau ?? 0}
            </span>
            <span className="adm-kpi__foot">
              Peak concurrent today: {today?.peakConcurrentPlayers ?? 0}
            </span>
          </div>

          <div className="adm-kpi">
            <span className="adm-kpi__label">This Month Players (MAU)</span>
            <span className="adm-kpi__value" id="adm-kpi-mau">
              {thisMonth?.mau ?? 0}
            </span>
            <span className="adm-kpi__foot">
              Unique devices in {thisMonth?.month ?? 'current month'} (PT)
            </span>
          </div>

          <div className="adm-kpi">
            <span className="adm-kpi__label">Rooms Today (Started / Created)</span>
            <span className="adm-kpi__value" id="adm-kpi-rooms-today">
              {today?.roomsStarted ?? 0} <span className="adm-dim">/ {today?.roomsCreated ?? 0}</span>
            </span>
            <span className="adm-kpi__foot">
              {today?.roundsPlayed ?? 0} round{today?.roundsPlayed === 1 ? '' : 's'} completed today
            </span>
          </div>

          <div className="adm-kpi">
            <span className="adm-kpi__label">Last 30 Days (Started / Created)</span>
            <span className="adm-kpi__value" id="adm-kpi-rooms-30d">
              {rooms30dStarted} <span className="adm-dim">/ {rooms30dCreated}</span>
            </span>
            <span className="adm-kpi__foot">{rounds30d} total rounds played (30d)</span>
          </div>
        </section>

        <section className="adm-panel" aria-labelledby="adm-daily-heading">
          <div className="adm-panel__head">
            <div>
              <h2 id="adm-daily-heading" className="adm-panel__title">
                Last 30 Days ({data?.timezone ?? 'America/Los_Angeles'})
              </h2>
              <p className="adm-panel__sub">Hover any bar to inspect exact counts</p>
            </div>
            <div className="adm-tabs" role="tablist" aria-label="30-day metric">
              {(
                [
                  ['dau', 'DAU (Players)'],
                  ['roomsStarted', 'Rooms Played'],
                  ['roomsCreated', 'Rooms Created'],
                  ['roundsPlayed', 'Rounds'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={dailyMetric === key}
                  className="adm-tab"
                  onClick={() => setDailyMetric(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <StackedBarChart
            chartId="adm-daily-chart"
            points={dailyPoints}
            stacked={dailyMetric !== 'dau'}
            unit={
              dailyMetric === 'dau'
                ? 'unique players'
                : dailyMetric === 'roundsPlayed'
                  ? 'rounds'
                  : 'rooms'
            }
          />
        </section>

        <section className="adm-panel" aria-labelledby="adm-monthly-heading">
          <div className="adm-panel__head">
            <div>
              <h2 id="adm-monthly-heading" className="adm-panel__title">
                Last 12 Months (MAU &amp; Monthly Rooms)
              </h2>
              <p className="adm-panel__sub">Stored in Firestore — retained beyond 30-day Cloud Logs</p>
            </div>
            <div className="adm-tabs" role="tablist" aria-label="12-month metric">
              {(
                [
                  ['mau', 'MAU (Players)'],
                  ['roomsStarted', 'Rooms Played'],
                  ['roomsCreated', 'Rooms Created'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={monthlyMetric === key}
                  className="adm-tab"
                  onClick={() => setMonthlyMetric(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <StackedBarChart
            chartId="adm-monthly-chart"
            points={monthlyPoints}
            stacked={monthlyMetric !== 'mau'}
            unit={monthlyMetric === 'mau' ? 'unique monthly players' : 'rooms'}
          />
        </section>

        <section className="adm-panel" aria-labelledby="adm-games-heading">
          <div className="adm-panel__head">
            <h2 id="adm-games-heading" className="adm-panel__title">
              30-Day Breakdown by Game
            </h2>
            <p className="adm-panel__sub">Rooms played vs. lobby-only opens</p>
          </div>
          <div className="adm-game-cards">
            {GAMES.map((g) => {
              const created = (data?.daily ?? []).reduce(
                (s, d) => s + (d.roomsCreatedByGame[g.id] || 0),
                0,
              );
              const started = (data?.daily ?? []).reduce(
                (s, d) => s + (d.roomsStartedByGame[g.id] || 0),
                0,
              );
              const rounds = (data?.daily ?? []).reduce(
                (s, d) => s + (d.roundsPlayedByGame[g.id] || 0),
                0,
              );
              const monthUsers = thisMonth?.mauByGame[g.id] ?? 0;
              return (
                <div key={g.id} className="adm-game-card">
                  <div className="adm-game-card__head">
                    <span className="adm-dot" style={{ background: g.color }} />
                    {g.label}
                  </div>
                  <div className="adm-game-card__stats">
                    <span>Rooms played / created</span>
                    <strong>
                      {started} / {created}
                    </strong>
                  </div>
                  <div className="adm-game-card__stats">
                    <span>Rounds (30d)</span>
                    <strong>{rounds}</strong>
                  </div>
                  <div className="adm-game-card__stats">
                    <span>This month players</span>
                    <strong>{monthUsers}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="adm-panel" aria-labelledby="adm-recent-heading">
          <div className="adm-panel__head">
            <h2 id="adm-recent-heading" className="adm-panel__title">
              Recent Closed Rooms
            </h2>
            <p className="adm-panel__sub">
              Logged when a room closes (no raw IPs or device tokens stored)
            </p>
          </div>

          {!data || data.recentRooms.length === 0 ? (
            <p className="adm-panel__sub">No closed rooms recorded yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table" id="adm-recent-rooms">
                <thead>
                  <tr>
                    <th>Closed (PT)</th>
                    <th>Game</th>
                    <th>Status</th>
                    <th>Humans</th>
                    <th>Rounds</th>
                    <th>Duration</th>
                    <th>Origin / Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRooms.map((r, idx) => {
                    const gm = GAME_LOOKUP[r.game];
                    return (
                      <tr key={`${r.closedAt}-${idx}`}>
                        <td>{formatTimestampPT(r.closedAt)}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span
                              className="adm-dot"
                              style={{ background: gm?.color ?? '#aa899a' }}
                            />
                            {gm?.label ?? r.game}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`adm-badge ${r.started ? 'adm-badge--played' : 'adm-badge--lobby'}`}
                          >
                            {r.started ? 'Played' : 'Lobby only'}
                          </span>
                        </td>
                        <td>
                          {r.humanPlayers}
                          {r.botPlayers > 0 ? (
                            <span className="adm-dim"> (+{r.botPlayers} bot)</span>
                          ) : null}
                        </td>
                        <td>{r.roundsPlayed}</td>
                        <td>{formatDuration(r.durationSec)}</td>
                        <td>
                          {r.country ? `${r.country} · ` : ''}
                          {r.refererHost ? r.refererHost : <span className="adm-dim">Direct</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
