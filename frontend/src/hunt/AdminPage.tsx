import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { QrCode } from '../tv/QrCode';
import { ApiError, getCatalog, getJson, postJson, TIER_EMOJI, type AdminCode, type Catalog, type Tier } from './api';

type Session = { configured: boolean; admin: boolean };

function errMsg(e: unknown) {
  return e instanceof ApiError ? e.message : 'Could not reach the server.';
}

function prizeText(c: AdminCode, catalog: Catalog | null) {
  if (c.relic) {
    const r = catalog?.[c.relic];
    return r ? `${r.emoji} ${r.name}` : c.relic;
  }
  const t = c.tier ?? 'any';
  return `${TIER_EMOJI[t]} random ${t === 'any' ? '' : t}`.replace(/\s+$/, '');
}

/** Shared by /admin and /admin/print: session check + login form. */
function useAdmin() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    getJson<Session>('/api/admin/session').then(setSession, (e) => setError(errMsg(e)));
  }, []);
  useEffect(refresh, [refresh]);
  return { session, setSession, error, setError, refresh };
}

function Login({ onDone }: { onDone: () => void }) {
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
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="joinform" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Host passcode</span>
        <input
          id="admin-passcode"
          className="field__input"
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoComplete="current-password"
          required
          maxLength={200}
        />
      </label>
      {error && (
        <p className="joinform__error" role="alert">
          {error}
        </p>
      )}
      <button id="admin-login" className="btn btn--primary btn--big" type="submit" disabled={busy || !passcode}>
        Enter
      </button>
    </form>
  );
}

function Gate({ children }: { children: (logout: () => void) => ReactNode }) {
  const { session, setSession, error, refresh } = useAdmin();
  const logout = async () => {
    try {
      await postJson('/api/admin/logout');
    } finally {
      setSession((s) => (s ? { ...s, admin: false } : s));
    }
  };
  if (error) return <p className="joinform__error">{error}</p>;
  if (!session) return <p className="phone__summoning">Checking…</p>;
  if (!session.configured)
    return <p className="phone__sub">Admin is off: this server has no host passcode configured (SB_ADMIN_PASSCODE).</p>;
  if (!session.admin) return <Login onDone={refresh} />;
  return <>{children(logout)}</>;
}

const PRIZES: { value: string; label: string }[] = [
  { value: 'tier:any', label: '✨ Random (any tier)' },
  { value: 'tier:common', label: '🕯️ Random common' },
  { value: 'tier:rare', label: '🔮 Random rare' },
  { value: 'tier:cursed', label: '💀 Random cursed' },
];

function AdminConsole({ logout }: { logout: () => void }) {
  const [codes, setCodes] = useState<AdminCode[] | null>(null);
  const [max, setMax] = useState(500);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [count, setCount] = useState(10);
  const [prize, setPrize] = useState('tier:any');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    getJson<{ codes: AdminCode[]; max: number }>('/api/admin/codes').then(
      (r) => {
        setCodes(r.codes);
        setMax(r.max);
      },
      (e) => setError(errMsg(e)),
    );
  }, []);
  useEffect(() => {
    load();
    getCatalog().then(setCatalog, () => {});
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const [kind, value] = prize.split(':');
    try {
      await postJson('/api/admin/codes', {
        count,
        label,
        relic: kind === 'relic' ? value : null,
        tier: kind === 'tier' ? value : null,
      });
      setLabel('');
      load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (token: string) => {
    if (confirming !== token) {
      setConfirming(token);
      return;
    }
    setConfirming(null);
    try {
      await postJson(`/api/admin/codes/${encodeURIComponent(token)}/delete`);
      load();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const claimed = codes?.filter((c) => c.claimed).length ?? 0;

  return (
    <>
      <div className="admin__bar">
        <a id="admin-print" className="btn btn--primary" href="/admin/print">
          🖨️ Print stickers
        </a>
        <button id="admin-logout" className="btn btn--ghost" onClick={logout}>
          Log out
        </button>
      </div>

      <form className="admin__create" onSubmit={create}>
        <h2>Hide new Relics</h2>
        <label className="field">
          <span className="field__label">How many</span>
          <input
            id="admin-count"
            className="field__input"
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="field">
          <span className="field__label">Prize</span>
          <select id="admin-prize" className="field__input" value={prize} onChange={(e) => setPrize(e.target.value)}>
            {PRIZES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {catalog && (
              <optgroup label="A specific Relic">
                {Object.values(catalog).map((r) => (
                  <option key={r.key} value={`relic:${r.key}`}>
                    {r.emoji} {r.name} ({r.tier})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Label (for you: where it's hidden)</span>
          <input
            id="admin-label"
            className="field__input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder="Under the punch bowl"
          />
        </label>
        <button id="admin-create" className="btn btn--primary" type="submit" disabled={busy}>
          Make {count} code{count === 1 ? '' : 's'}
        </button>
      </form>

      {error && (
        <p className="joinform__error" role="alert">
          {error}
        </p>
      )}

      <section className="admin__codes">
        <h2>
          Codes <span className="admin__count">{codes ? `${claimed} of ${codes.length} found · max ${max}` : ''}</span>
        </h2>
        {codes && codes.length === 0 && <p className="phone__sub">No codes yet.</p>}
        {codes && codes.length > 0 && (
          <table className="admin__table" id="admin-codes">
            <thead>
              <tr>
                <th>Label</th>
                <th>Prize</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const got = c.claimedRelic ? catalog?.[c.claimedRelic] : undefined;
                return (
                  <tr key={c.token} data-claimed={c.claimed || undefined}>
                    <td>{c.label || <span className="admin__dim">(no label)</span>}</td>
                    <td>{prizeText(c, catalog)}</td>
                    <td>
                      {c.claimed ? (
                        <>
                          {c.claimedName} → {got ? `${got.emoji} ${got.name}` : c.claimedRelic}
                        </>
                      ) : (
                        <span className="admin__dim">hidden</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn--ghost admin__del"
                        onClick={() => remove(c.token)}
                        onBlur={() => setConfirming((t) => (t === c.token ? null : t))}
                      >
                        {confirming === c.token ? 'Really delete?' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** `/admin`: host-only console for the scavenger hunt. */
export function AdminPage() {
  return (
    <main className="admin">
      <h1 className="hunt__title">Hunt admin</h1>
      <Gate>{(logout) => <AdminConsole logout={logout} />}</Gate>
    </main>
  );
}

function Stickers() {
  const [codes, setCodes] = useState<AdminCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getJson<{ codes: AdminCode[] }>('/api/admin/codes').then(
      (r) => setCodes(r.codes.filter((c) => !c.claimed)),
      (e) => setError(errMsg(e)),
    );
  }, []);
  if (error) return <p className="joinform__error">{error}</p>;
  if (!codes) return <p className="phone__summoning">Loading…</p>;
  return (
    <>
      <div className="admin__bar print__controls">
        <a className="btn btn--ghost" href="/admin">
          ← Back
        </a>
        <span className="phone__sub">{codes.length} unclaimed stickers</span>
        <button id="print-go" className="btn btn--primary" onClick={() => window.print()}>
          🖨️ Print
        </button>
      </div>
      <ul className="stickers" id="stickers">
        {codes.map((c) => {
          const hint: Tier = c.relic ? 'any' : (c.tier ?? 'any');
          return (
            <li key={c.token} className="sticker">
              <QrCode className="sticker__qr" value={`${location.origin}/claim/${c.token}`} label="Scan for a Relic" />
              <span className="sticker__title">👻 Spirit Board</span>
              <span className="sticker__cta">
                Scan for a Relic <span aria-hidden="true">{TIER_EMOJI[hint]}</span>
              </span>
              {c.label && <span className="sticker__label">{c.label}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** `/admin/print`: a printable sheet of QR stickers for every unclaimed code. */
export function PrintSheet() {
  return (
    <main className="admin admin--print">
      <Gate>{() => <Stickers />}</Gate>
    </main>
  );
}
