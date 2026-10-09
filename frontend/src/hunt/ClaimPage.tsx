import { useEffect, useState, type FormEvent } from 'react';
import type { RelicInfo, RelicKey } from '../protocol';
import { ApiError, getCatalog, getJson, getMe, postJson, type Catalog, type ClaimResult } from './api';

function RelicCard({ info, fresh }: { info: RelicInfo | undefined; fresh: boolean }) {
  if (!info) return null;
  return (
    <figure className={`relicprize relicprize--${info.tier}`} data-fresh={fresh || undefined}>
      <span className="relicprize__emoji" aria-hidden="true">
        {info.emoji}
      </span>
      <figcaption>
        <span className="relicprize__tier">{info.tier}</span>
        <strong className="relicprize__name">{info.name}</strong>
        <span className="relicprize__blurb">{info.blurb}</span>
      </figcaption>
    </figure>
  );
}

/** `/claim/:token`: a hunt QR sticker was scanned. */
export function ClaimPage({ token }: { token: string }) {
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [fresh, setFresh] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/claim/${encodeURIComponent(token)}`;

  useEffect(() => {
    getCatalog().then(setCatalog, () => {});
    getMe()
      .then(() => getJson<ClaimResult>(path))
      .then(setResult, (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not reach the spirits.'));
  }, [path]);

  const claim = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<ClaimResult>(path, result?.status === 'need_name' ? { name: name.trim() } : {});
      setFresh(r.status === 'claimed');
      setResult(r);
      if (r.status === 'claimed' && 'vibrate' in navigator) navigator.vibrate([40, 60, 120]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the spirits.');
    } finally {
      setBusy(false);
    }
  };

  const info = (key: RelicKey | null) => (key && catalog ? catalog[key] : undefined);
  const err = error && (
    <p className="joinform__error" role="alert">
      {error}
    </p>
  );

  let body;
  if (!result) {
    body = error ? err : <p className="phone__big phone__summoning">Something stirs…</p>;
  } else if (result.status === 'claimed' || result.status === 'yours') {
    body = (
      <>
        <p className="hunt__kicker">{result.status === 'claimed' ? 'You found…' : 'You already found this one:'}</p>
        <RelicCard info={info(result.relic)} fresh={fresh} />
        <a id="claim-to-relics" className="btn btn--primary btn--big" href="/relics">
          See my Relics
        </a>
        <p className="phone__sub">Keep hunting. Bring this phone to the séance and your Relics come with you.</p>
      </>
    );
  } else if (result.status === 'need_name') {
    body = (
      <form className="joinform" onSubmit={claim}>
        <p className="hunt__kicker">A Relic is hidden here.</p>
        <label className="field">
          <span className="field__label">Your name (for the séance)</span>
          <input
            id="claim-name"
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
            required
            maxLength={14}
            placeholder="Kevin"
          />
        </label>
        {err}
        <button id="claim-submit" className="btn btn--primary btn--big" type="submit" disabled={busy || !name.trim()}>
          Claim it
        </button>
      </form>
    );
  } else if (result.status === 'unclaimed') {
    body = (
      <>
        <p className="hunt__kicker">A Relic is hidden here.</p>
        {err}
        <button id="claim-submit" className="btn btn--primary btn--big" onClick={() => claim()} disabled={busy}>
          Reveal it
        </button>
      </>
    );
  } else if (result.status === 'taken') {
    body = (
      <>
        <p className="phone__big">Someone got here first 👻</p>
        <p className="phone__sub">The Relic that was here has already been taken. Keep looking.</p>
        <a className="btn" href="/relics">
          My Relics
        </a>
      </>
    );
  } else if (result.status === 'full') {
    body = (
      <>
        <p className="phone__big">Your pockets are full.</p>
        <p className="phone__sub">Use some Relics in a game first, then come back. Leave this one for someone else?</p>
      </>
    );
  } else {
    body = (
      <>
        <p className="phone__big">This sticker has gone cold.</p>
        <p className="phone__sub">That code doesn't exist (or the host removed it).</p>
      </>
    );
  }

  return (
    <main className="phone phone--center hunt">
      <h1 className="hunt__title">
        Spirit Board <span className="byline">by Willy Nojopranoto</span>
      </h1>
      {body}
    </main>
  );
}

/** `/relics`: this phone's hunt collection. */
export function RelicsPage() {
  const [me, setMe] = useState<{ name: string | null; relics: RelicKey[] } | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog, () => {});
    getMe().then(setMe, () => setError('Could not reach the spirits.'));
  }, []);

  return (
    <main className="phone hunt">
      <h1 className="hunt__title">My Relics</h1>
      {error && (
        <p className="joinform__error" role="alert">
          {error}
        </p>
      )}
      {me && (
        <>
          {me.name && <p className="hunt__kicker">Carried by {me.name}</p>}
          {me.relics.length === 0 ? (
            <p className="phone__sub hunt__empty">
              Nothing yet. Relics are hidden around the house: scan the little ghost stickers to find them.
            </p>
          ) : (
            <ul className="hunt__list" id="relic-list">
              {me.relics.map((k, i) => (
                <li key={`${k}-${i}`}>
                  <RelicCard info={catalog?.[k]} fresh={false} />
                </li>
              ))}
            </ul>
          )}
          <a id="relics-play" className="btn btn--primary btn--big" href="/play">
            Bring this phone to the séance
          </a>
          <p className="phone__sub">Each Relic works once. Join a game from this phone and they come with you.</p>
        </>
      )}
    </main>
  );
}
