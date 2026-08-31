import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { SocketHandle, TransportAdapter } from '../adapters.js';

export class NodeTransport implements TransportAdapter {
  open(url: string, token: string): SocketHandle {
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return {
      get readyState() {
        return socket.readyState;
      },
      send(data: string) {
        socket.send(data);
      },
      close() {
        socket.close();
      },
      onOpen(listener) {
        socket.on('open', listener);
      },
      onMessage(listener) {
        socket.on('message', (data) => listener(data.toString()));
      },
      onError(listener) {
        socket.on('error', (error) => listener(error instanceof Error ? error : new Error(String(error))));
      },
      onClose(listener) {
        let handshakeStatus: number | undefined;
        let notified = false;
        const notify = (info: { code?: number; reason?: string; status?: number }) => {
          if (notified) {
            return;
          }
          notified = true;
          listener(info);
        };

        socket.on('unexpected-response', (_req, response: IncomingMessage) => {
          handshakeStatus = response.statusCode;
          response.resume();
          notify({ status: handshakeStatus });
        });

        socket.on('close', (code, reason) => {
          notify({
            code,
            reason: Buffer.isBuffer(reason) ? reason.toString() : String(reason ?? ''),
            status: handshakeStatus,
          });
        });
      },
    };
  }
}
