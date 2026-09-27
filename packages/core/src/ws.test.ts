import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOCKET_OPEN, SocketCloseInfo, SocketHandle, TransportAdapter } from './adapters.js';
import { HermesWsClient, toSocketUrl } from './ws.js';

test('toSocketUrl maps http and https origins', () => {
  assert.equal(toSocketUrl('http://ying-1:3000'), 'ws://ying-1:3000');
  assert.equal(toSocketUrl('https://s1:3000/'), 'wss://s1:3000');
});

test('toSocketUrl turns an empty base into the page origin', () => {
  assert.equal(toSocketUrl('', 'http://ying-1:3000'), 'ws://ying-1:3000');
  assert.equal(toSocketUrl('', 'https://s1:3443/'), 'wss://s1:3443');
});

test('toSocketUrl prefixes a relative path with the page origin', () => {
  assert.equal(toSocketUrl('/chat', 'http://ying-1:3000'), 'ws://ying-1:3000/chat');
});

/** A socket whose open/close events fire only when the test says so. */
class ScriptedSocket implements SocketHandle {
  readyState = 0;
  closeCalls = 0;
  private readonly openListeners: Array<() => void> = [];
  private readonly closeListeners: Array<(info: SocketCloseInfo) => void> = [];

  send(): void {}
  close(): void {
    this.closeCalls += 1;
  }
  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
  }
  onMessage(): void {}
  onError(): void {}
  onClose(listener: (info: SocketCloseInfo) => void): void {
    this.closeListeners.push(listener);
  }

  fireOpen(): void {
    this.readyState = SOCKET_OPEN;
    this.openListeners.forEach((listener) => listener());
  }
  fireClose(info: SocketCloseInfo = { code: 1006 }): void {
    this.readyState = 3;
    this.closeListeners.forEach((listener) => listener(info));
  }
}

function scriptedClient() {
  const sockets: ScriptedSocket[] = [];
  const transport: TransportAdapter = {
    open() {
      const socket = new ScriptedSocket();
      sockets.push(socket);
      return socket;
    },
  };
  const client = new HermesWsClient('http://hermes.test', transport);
  const closes: SocketCloseInfo[] = [];
  let opens = 0;
  client.onClose((info) => closes.push(info));
  client.onOpen(() => {
    opens += 1;
  });
  return { client, sockets, closes, opens: () => opens };
}

test('a close we asked for stays quiet when its event lands after the next connect', async () => {
  const { client, sockets, closes } = scriptedClient();

  const first = client.connect('tok');
  sockets[0].fireOpen();
  await first;

  client.close();
  const second = client.connect('tok');
  sockets[1].fireOpen();
  await second;

  // The browser delivers the old socket's close event late.
  sockets[0].fireClose({ code: 1000 });

  assert.deepEqual(closes, [], 'an intentional close must not reach close listeners');
  assert.equal(client.getStatus(), 'open');
  assert.equal(client.isConnected(), true, 'the new socket must survive the stale close');
});

test('a stale open from a socket we closed does not report the client as open', async () => {
  const { client, sockets, opens } = scriptedClient();

  void client.connect('tok').catch(() => undefined);
  client.close();
  const second = client.connect('tok');

  sockets[0].fireOpen();
  assert.equal(opens(), 0, 'the abandoned socket must not fire open listeners');
  assert.equal(client.getStatus(), 'connecting');

  sockets[1].fireOpen();
  await second;
  assert.equal(opens(), 1);
  assert.equal(client.isConnected(), true);
});

test('a server-initiated close still reaches close listeners', async () => {
  const { client, sockets, closes } = scriptedClient();

  const first = client.connect('tok');
  sockets[0].fireOpen();
  await first;

  sockets[0].fireClose({ code: 1006 });
  assert.equal(closes.length, 1);
  assert.equal(client.getStatus(), 'closed');
  assert.equal(client.isConnected(), false);
});
