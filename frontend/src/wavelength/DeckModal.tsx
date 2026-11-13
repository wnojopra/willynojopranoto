import { useState } from 'react';
import type { WlDeckInfo, WlSettings } from './protocol';

const CUSTOM_DECK_STORAGE_KEY = 'wl-custom-cards';

export function loadSavedCustomCards(): [string, string][] {
  try {
    const raw = localStorage.getItem(CUSTOM_DECK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string')
      .slice(0, 500);
  } catch {
    return [];
  }
}

export function saveCustomCards(cards: [string, string][]) {
  try {
    localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // ignore storage errors
  }
}

function splitLine(line: string): [string, string] | null {
  for (const sep of ['|', '\t', '↔', '<->', '<>']) {
    if (line.includes(sep)) {
      const parts = line.split(sep).map((s) => s.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        return [parts[0].slice(0, 60), parts[1].slice(0, 60)];
      }
      return null;
    }
  }
  if (line.includes(',')) {
    const parts = line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      return [parts[0].slice(0, 60), parts[1].slice(0, 60)];
    }
  }
  for (const sep of [' - ', ' – ', ' — ']) {
    if (line.includes(sep)) {
      const parts = line.split(sep).map((s) => s.trim());
      if (parts.length === 2 && parts[0] && parts[1]) {
        return [parts[0].slice(0, 60), parts[1].slice(0, 60)];
      }
    }
  }
  return null;
}

export function parseCustomText(text: string): [string, string][] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.cards || data.deck || data.clues || [];
      if (Array.isArray(list)) {
        const out: [string, string][] = [];
        for (const item of list) {
          if (Array.isArray(item) && item.length >= 2) {
            const l = String(item[0] ?? '').trim().slice(0, 60);
            const r = String(item[1] ?? '').trim().slice(0, 60);
            if (l && r) out.push([l, r]);
          } else if (item && typeof item === 'object') {
            const l = String(item.left ?? item.l ?? '').trim().slice(0, 60);
            const r = String(item.right ?? item.r ?? '').trim().slice(0, 60);
            if (l && r) out.push([l, r]);
          }
        }
        return out;
      }
    } catch {
      // fall through to line parsing
    }
  }
  const out: [string, string][] = [];
  const lines = trimmed.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const ln = raw.trim();
    if (!ln || ln.startsWith('#') || ln.startsWith('//')) return;
    if (idx === 0 && /^"?left"?\s*[,|\t]\s*"?right"?$/i.test(ln)) return;
    const pair = splitLine(ln);
    if (pair) out.push(pair);
  });
  return out;
}

interface DeckModalProps {
  decks: WlDeckInfo[];
  settings: WlSettings;
  customCards: [string, string][];
  onTogglePack: (packId: string) => void;
  onUpdateCustomCards: (cards: [string, string][], replacePacks: boolean) => void;
  onClose: () => void;
}

export function DeckModal({
  decks,
  settings,
  customCards,
  onTogglePack,
  onUpdateCustomCards,
  onClose,
}: DeckModalProps) {
  const [leftInput, setLeftInput] = useState('');
  const [rightInput, setRightInput] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const parsedBulk = parseCustomText(bulkText);

  function handleAddSingle(e: React.FormEvent) {
    e.preventDefault();
    const l = leftInput.trim().slice(0, 60);
    const r = rightInput.trim().slice(0, 60);
    if (!l || !r) return;
    const next: [string, string][] = [[l, r], ...customCards];
    saveCustomCards(next);
    onUpdateCustomCards(next, false);
    setLeftInput('');
    setRightInput('');
  }

  function handleRemoveCard(idx: number) {
    const next = customCards.filter((_, i) => i !== idx);
    saveCustomCards(next);
    onUpdateCustomCards(next, false);
  }

  function handleImport(replaceAll: boolean) {
    if (!parsedBulk.length) return;
    const next = replaceAll ? parsedBulk : [...parsedBulk, ...customCards].slice(0, 500);
    saveCustomCards(next);
    onUpdateCustomCards(next, replaceAll);
    setBulkText('');
    setShowImport(false);
  }

  function handleExport() {
    if (!customCards.length) return;
    const payload = {
      name: 'Wavelength custom deck',
      exported: new Date().toISOString(),
      count: customCards.length,
      cards: customCards,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wavelength-deck-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setBulkText(text);
      setShowImport(true);
    } catch {
      // ignore
    }
  }

  return (
    <div className="wl-modal-backdrop" onClick={onClose}>
      <div className="wl-modal wl-modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Card Deck & Packs">
        <header className="wl-modal-header">
          <div>
            <h2>Card Packs &amp; Custom Deck</h2>
            <p className="wl-muted wl-small">
              {settings.deckSize} playable cards active ({settings.customCount} custom)
            </p>
          </div>
          <button type="button" className="wl-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="wl-modal-body">
          <div className="wl-pack-grid">
            {decks.map((d) => {
              const on = settings.packs.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={`wl-pack-card ${on ? 'is-active' : ''}`}
                  onClick={() => onTogglePack(d.id)}
                >
                  <div className="wl-pack-top">
                    <span className="wl-pack-emoji">{d.emoji}</span>
                    <strong>{d.name}</strong>
                    <span className="wl-pack-count">{d.count}</span>
                  </div>
                  <p>{d.description}</p>
                </button>
              );
            })}
          </div>

          <div className="wl-custom-section">
            <div className="wl-custom-header">
              <h3>Custom Cards ({customCards.length})</h3>
              <div className="wl-row-gap">
                <button
                  type="button"
                  className="wl-btn wl-btn--secondary wl-btn--sm"
                  onClick={() => setShowImport((v) => !v)}
                >
                  {showImport ? 'Hide Import' : '📥 Import / Paste'}
                </button>
                {customCards.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="wl-btn wl-btn--secondary wl-btn--sm"
                      onClick={handleExport}
                    >
                      📤 Export JSON
                    </button>
                    <button
                      type="button"
                      className="wl-btn wl-btn--ghost wl-btn--sm"
                      onClick={() => {
                        saveCustomCards([]);
                        onUpdateCustomCards([], false);
                      }}
                    >
                      Clear Custom
                    </button>
                  </>
                )}
              </div>
            </div>

            {showImport && (
              <div className="wl-import-box">
                <div className="wl-import-row">
                  <label className="wl-btn wl-btn--secondary wl-btn--sm">
                    Choose .json / .csv / .txt
                    <input
                      type="file"
                      accept=".json,.csv,.txt,application/json,text/plain,text/csv"
                      hidden
                      onChange={handleFileUpload}
                    />
                  </label>
                  <span className="wl-muted wl-small">
                    Or paste one card per line: <code>Cold | Hot</code> or <code>Underrated ↔ Overrated</code>
                  </span>
                </div>
                <textarea
                  className="wl-textarea"
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Cold | Hot\nWorst Pizza Topping | Best Pizza Topping'}
                />
                <div className="wl-import-actions">
                  <span className="wl-small wl-muted">{parsedBulk.length} valid cards parsed</span>
                  <div className="wl-row-gap">
                    <button
                      type="button"
                      className="wl-btn wl-btn--secondary wl-btn--sm"
                      disabled={parsedBulk.length === 0}
                      onClick={() => handleImport(true)}
                    >
                      Use Only Custom ({parsedBulk.length})
                    </button>
                    <button
                      type="button"
                      className="wl-btn wl-btn--primary wl-btn--sm"
                      disabled={parsedBulk.length === 0}
                      onClick={() => handleImport(false)}
                    >
                      Add {parsedBulk.length} Cards
                    </button>
                  </div>
                </div>
              </div>
            )}

            <form className="wl-add-card-form" onSubmit={handleAddSingle}>
              <input
                type="text"
                className="wl-input"
                placeholder="Left end (e.g. Cold)"
                maxLength={60}
                value={leftInput}
                onChange={(e) => setLeftInput(e.target.value)}
              />
              <span className="wl-arrows-sep">↔</span>
              <input
                type="text"
                className="wl-input"
                placeholder="Right end (e.g. Hot)"
                maxLength={60}
                value={rightInput}
                onChange={(e) => setRightInput(e.target.value)}
              />
              <button
                type="submit"
                className="wl-btn wl-btn--primary wl-btn--sm"
                disabled={!leftInput.trim() || !rightInput.trim()}
              >
                + Add
              </button>
            </form>

            {customCards.length > 0 && (
              <ul className="wl-custom-list">
                {customCards.slice(0, 60).map(([l, r], idx) => (
                  <li key={`${l}-${r}-${idx}`} className="wl-custom-row">
                    <span>{l}</span>
                    <span className="wl-arrows-sep">↔</span>
                    <span>{r}</span>
                    <button
                      type="button"
                      className="wl-icon-btn wl-icon-btn--sm"
                      onClick={() => handleRemoveCard(idx)}
                      aria-label="Delete custom card"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="wl-modal-footer">
          <button type="button" className="wl-btn wl-btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
