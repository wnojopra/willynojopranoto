import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMsg } from './protocol';

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
export function useGameSocket(
  path: string | null,
  firstMessage: string | null,
  onMessage: (msg: ServerMsg) => void,
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
        handlerRef.current(msg as ServerMsg);
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
