import { useCallback, useEffect, useRef, useState } from 'react';
import type { PsyServerMsg } from './protocol';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

/**
 * Opens a WebSocket and sends `firstMessage` once open. Pass `path = null` to
 * stay disconnected; bump `attempt` to reconnect.
 */
export function usePsychSocket(
  path: string | null,
  firstMessage: string | null,
  onMessage: (msg: PsyServerMsg) => void,
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
        handlerRef.current(msg as PsyServerMsg);
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

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Nunito:wght@400;600;800&display=swap';

/** Adds the game's fonts once, without blocking rendering (allowed by the CSP's style-src). */
export function loadPsychFonts(): void {
  if (document.getElementById('psy-fonts')) return;
  const link = document.createElement('link');
  link.id = 'psy-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_URL;
  document.head.appendChild(link);
}
