import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

/**
 * Opens a WebSocket to the game server and sends `firstMessage` once open.
 *
 * Pass `path = null` to stay disconnected. Bump `attempt` to reconnect.
 */
export function useGameSocket<T extends { type: string }>(
  path: string | null,
  firstMessage: string | null,
  onMessage: (msg: T) => void,
  attempt = 0,
) {
  const [status, setStatus] = useState<ConnStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!path || !firstMessage) {
      setStatus('idle');
      return;
    }
    const ws = new WebSocket(wsUrl(path));
    wsRef.current = ws;
    setStatus('connecting');
    ws.onopen = () => {
      setStatus('open');
      ws.send(firstMessage);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && typeof (msg as { type?: unknown }).type === 'string') {
        handlerRef.current(msg as T);
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) setStatus('closed');
    };
    return () => {
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
  }, [path, firstMessage, attempt]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { status, send };
}

/** Makes sure this browser has its device cookie (needed for rejoining) in dev. */
export function ensureSession(): Promise<void> {
  return fetch('/api/session', { credentials: 'same-origin' }).then(
    () => undefined,
    () => undefined,
  );
}

/** Injects a Google Fonts stylesheet once without blocking rendering. */
export function loadFonts(id: string, href: string): void {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

const SPIRIT_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Cinzel:wght@500;600;700&display=swap';

const PSYCH_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Nunito:wght@400;600;800&display=swap';

const AVALON_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@600;700;800&family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400&display=swap';

export function loadSpiritFonts(): void {
  loadFonts('sb-fonts', SPIRIT_FONTS_URL);
}

export function loadPsychFonts(): void {
  loadFonts('psy-fonts', PSYCH_FONTS_URL);
}

export function loadAvalonFonts(): void {
  loadFonts('ava-fonts', AVALON_FONTS_URL);
}
