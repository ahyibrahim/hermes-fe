import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { MessageRecord, PublicUser, RoomRecord } from '../types.js';

export interface FakeBackend {
  baseUrl: string;
  port: number;
  joinCount: number;
  close(): Promise<void>;
  revokeToken(token: string): void;
  dropConnections(): void;
  seedUser(username: string, password: string): void;
}

interface StoredUser {
  id: number;
  password: string;
  role: 'member' | 'admin';
  avatarFileId: number | null;
}

interface RoomState extends RoomRecord {
  members: string[];
}

interface Client {
  socket: WebSocket;
  user: string;
  room: string | null;
}

interface StoredFile {
  id: number;
  name: string;
  data: Buffer;
  mime?: string;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function bearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || undefined;
  }
  return undefined;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(
  buf: Buffer,
  contentType: string
): { fields: Record<string, string>; file?: { filename: string; data: Buffer } } {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    return { fields: {} };
  }

  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  const parts = buf.toString('latin1').split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: { filename: string; data: Buffer } | undefined;

  for (const part of parts) {
    if (part === '--' || part === '--\r\n' || part.trim() === '') {
      continue;
    }

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      continue;
    }

    const rawHeaders = part.slice(0, headerEnd);
    let body = part.slice(headerEnd + 4);
    if (body.endsWith('\r\n')) {
      body = body.slice(0, -2);
    }

    const nameMatch = /name="([^"]+)"/.exec(rawHeaders);
    const filenameMatch = /filename="([^"]*)"/.exec(rawHeaders);
    const name = nameMatch?.[1];
    if (!name) {
      continue;
    }

    if (filenameMatch) {
      file = { filename: filenameMatch[1] || 'upload', data: Buffer.from(body, 'latin1') };
    } else {
      fields[name] = Buffer.from(body, 'latin1').toString('utf8');
    }
  }

  return { fields, file };
}

export async function startFakeBackend(): Promise<FakeBackend> {
  const users = new Map<string, StoredUser>();
  const tokens = new Map<string, string>();
  const rooms = new Map<string, RoomState>([
    ['general', { id: 1, slug: 'general', name: 'General', type: 'group', members: [] }],
  ]);
  const messages: MessageRecord[] = [];
  const files = new Map<number, StoredFile>();
  const clients = new Set<Client>();
  let nextMessageId = 1;
  let nextFileId = 1;
  let nextToken = 1;
  let nextUserId = 1;
  let nextRoomId = 2;
  let joinCount = 0;

  const connectedUsers = (room: string): string[] => [
    ...new Set([...clients].filter((client) => client.room === room).map((client) => client.user)),
  ];

  const addToGeneral = (username: string): void => {
    const general = rooms.get('general');
    if (general && !general.members.includes(username)) {
      general.members.push(username);
    }
  };

  const usernameById = (id: number): string | undefined => {
    for (const [username, user] of users) {
      if (user.id === id) {
        return username;
      }
    }
    return undefined;
  };

  const publicUsers = (): PublicUser[] =>
    [...users.entries()]
      .map(([username, user]) => ({
        id: user.id,
        username,
        role: user.role,
        avatar_file_id: user.avatarFileId,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

  const profileOf = (username: string): PublicUser | undefined =>
    publicUsers().find((user) => user.username === username);

  const broadcast = (room: string, payload: unknown, except?: WebSocket): void => {
    const data = JSON.stringify(payload);
    for (const client of clients) {
      if (client.room === room && client.socket !== except && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(data);
      }
    }
  };

  const requireUser = (req: http.IncomingMessage, res: http.ServerResponse): string | null => {
    const token = bearerToken(req);
    if (!token) {
      sendJson(res, 401, { error: 'authentication required' });
      return null;
    }
    const username = tokens.get(token);
    if (!username) {
      sendJson(res, 401, { error: 'invalid token' });
      return null;
    }
    return username;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', service: 'hermes-fake', message: 'Backend is running' });
        return;
      }

      if (method === 'POST' && url.pathname === '/auth/register') {
        const body = JSON.parse((await readBody(req)).toString()) as { username?: string; password?: string };
        const username = body.username?.trim().toLowerCase() ?? '';
        const password = body.password ?? '';
        if (!username || !password) {
          sendJson(res, 400, { error: 'username and password are required' });
          return;
        }
        if (users.has(username)) {
          sendJson(res, 409, { error: 'username already exists' });
          return;
        }
        users.set(username, {
          id: nextUserId++,
          password,
          role: users.size === 0 ? 'admin' : 'member',
          avatarFileId: null,
        });
        addToGeneral(username);
        const created = users.get(username);
        sendJson(res, 200, {
          user: { id: created?.id, username, role: created?.role },
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/auth/login') {
        const body = JSON.parse((await readBody(req)).toString()) as { username?: string; password?: string };
        const username = body.username?.trim().toLowerCase() ?? '';
        const password = body.password ?? '';
        if (users.get(username)?.password !== password) {
          sendJson(res, 401, { error: 'invalid credentials' });
          return;
        }
        const token = `tok-${nextToken++}`;
        tokens.set(token, username);
        sendJson(res, 200, { username, token });
        return;
      }

      if (method === 'POST' && url.pathname === '/auth/logout') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const token = bearerToken(req);
        if (token) {
          tokens.delete(token);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && url.pathname === '/users') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        sendJson(res, 200, publicUsers());
        return;
      }

      if (method === 'GET' && url.pathname === '/users/me') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const profile = profileOf(username);
        if (!profile) {
          sendJson(res, 401, { error: 'authentication required' });
          return;
        }
        sendJson(res, 200, profile);
        return;
      }

      if (method === 'PATCH' && url.pathname === '/users/me') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as {
          current_password?: string;
          password?: string;
        };
        const user = users.get(username);
        if (!user || user.password !== body.current_password) {
          sendJson(res, 401, { error: 'invalid credentials' });
          return;
        }
        if (!body.password?.trim()) {
          sendJson(res, 400, { error: 'current_password and password are required' });
          return;
        }
        user.password = body.password;
        const keep = bearerToken(req);
        for (const [token, name] of [...tokens]) {
          if (name === username && token !== keep) {
            tokens.delete(token);
          }
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && url.pathname === '/users/me/avatar') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const user = users.get(username);
        if (!user) {
          sendJson(res, 401, { error: 'authentication required' });
          return;
        }
        const parsed = parseMultipart(await readBody(req), req.headers['content-type'] ?? '');
        if (!parsed.file) {
          sendJson(res, 400, { error: 'file is required' });
          return;
        }
        const fileId = nextFileId++;
        files.set(fileId, {
          id: fileId,
          name: parsed.file.filename,
          data: parsed.file.data,
          mime: 'image/png',
        });
        user.avatarFileId = fileId;
        sendJson(res, 200, profileOf(username));
        return;
      }

      const avatarMatch = /^\/users\/(\d+)\/avatar$/.exec(url.pathname);
      if (method === 'GET' && avatarMatch) {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const id = Number(avatarMatch[1]);
        const owner = [...users.values()].find((user) => user.id === id);
        if (!owner?.avatarFileId) {
          sendJson(res, 404, { error: 'avatar not found' });
          return;
        }
        const file = files.get(owner.avatarFileId);
        if (!file) {
          sendJson(res, 404, { error: 'avatar not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': file.mime || 'application/octet-stream',
          'Content-Length': file.data.length,
        });
        res.end(file.data);
        return;
      }

      if (method === 'GET' && url.pathname === '/users/online') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        sendJson(
          res,
          200,
          [...new Set([...clients].map((client) => client.user))].sort((a, b) => a.localeCompare(b))
        );
        return;
      }

      if (method === 'GET' && url.pathname === '/rooms') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        sendJson(
          res,
          200,
          [...rooms.values()]
            .filter((room) => room.members.includes(username))
            .map((room) => ({
              id: room.id,
              slug: room.slug,
              name: room.name,
              type: room.type ?? 'group',
              members: [...new Set([...room.members, ...connectedUsers(room.slug)])],
            }))
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/rooms') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { name?: string; members?: unknown };
        const name = body.name?.trim() ?? '';
        if (!name) {
          sendJson(res, 400, { error: 'name is required' });
          return;
        }
        const creator = users.get(username);
        if (!creator) {
          sendJson(res, 401, { error: 'authentication required' });
          return;
        }
        const memberIds = Array.isArray(body.members)
          ? body.members.filter((id): id is number => typeof id === 'number' && Number.isInteger(id))
          : [];
        const members = new Set<string>([username]);
        for (const id of memberIds) {
          const member = usernameById(id);
          if (member) {
            members.add(member);
          }
        }
        const slug = `group:${name.toLowerCase().replace(/\s+/g, '-')}:${Date.now()}`;
        const room: RoomState = {
          id: nextRoomId++,
          slug,
          name,
          type: 'group',
          members: [...members],
        };
        rooms.set(slug, room);
        sendJson(res, 200, {
          id: room.id,
          slug: room.slug,
          name: room.name,
          type: room.type,
          members: room.members,
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/rooms/dm') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { userId?: unknown };
        if (typeof body.userId !== 'number' || !Number.isInteger(body.userId)) {
          sendJson(res, 400, { error: 'userId is required' });
          return;
        }
        const other = usernameById(body.userId);
        if (!other) {
          sendJson(res, 400, { error: 'both users must exist' });
          return;
        }
        if (other === username) {
          sendJson(res, 400, { error: 'cannot DM yourself' });
          return;
        }
        const pair = [username, other].sort((a, b) => a.localeCompare(b));
        const slug = `dm:${pair[0]}:${pair[1]}`;
        const existing = rooms.get(slug);
        if (existing) {
          sendJson(res, 200, {
            id: existing.id,
            slug: existing.slug,
            name: existing.name,
            type: existing.type ?? 'dm',
            members: existing.members,
          });
          return;
        }
        const room: RoomState = {
          id: nextRoomId++,
          slug,
          name: pair.join(', '),
          type: 'dm',
          members: pair,
        };
        rooms.set(slug, room);
        sendJson(res, 200, {
          id: room.id,
          slug: room.slug,
          name: room.name,
          type: room.type,
          members: room.members,
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/messages') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const room = url.searchParams.get('room') ?? 'general';
        sendJson(
          res,
          200,
          messages.filter((message) => message.room === room)
        );
        return;
      }

      if (method === 'POST' && url.pathname === '/messages') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { room?: string; content?: string };
        if (!body.room || !body.content) {
          sendJson(res, 400, { error: 'room and content are required' });
          return;
        }
        const room = rooms.get(body.room) ?? {
          id: nextRoomId++,
          slug: body.room,
          name: body.room,
          type: 'group',
          members: [],
        };
        rooms.set(room.slug, room);
        if (!room.members.includes(username)) {
          room.members.push(username);
        }
        const message: MessageRecord = {
          id: nextMessageId++,
          room: room.slug,
          sender: username,
          content: body.content,
          created_at: new Date().toISOString(),
        };
        messages.push(message);
        broadcast(room.slug, { type: 'message', message });
        sendJson(res, 200, message);
        return;
      }

      if (method === 'POST' && url.pathname === '/files') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const raw = await readBody(req);
        const parsed = parseMultipart(raw, req.headers['content-type'] ?? '');
        const roomSlug = parsed.fields.room;
        if (!roomSlug || !parsed.file) {
          sendJson(res, 400, { error: 'file is required' });
          return;
        }
        const fileId = nextFileId++;
        files.set(fileId, { id: fileId, name: parsed.file.filename, data: parsed.file.data });
        const message: MessageRecord = {
          id: nextMessageId++,
          room: roomSlug,
          sender: username,
          content: parsed.file.filename,
          created_at: new Date().toISOString(),
          file_id: fileId,
        };
        messages.push(message);
        broadcast(roomSlug, { type: 'message', message });
        sendJson(res, 200, {
          file: { id: fileId, room: roomSlug, name: parsed.file.filename, filename: parsed.file.filename },
          message,
        });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/files/')) {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const id = Number(url.pathname.slice('/files/'.length));
        const file = files.get(id);
        if (!file) {
          sendJson(res, 404, { error: 'file not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': file.data.length,
        });
        res.end(file.data);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token')?.trim() || bearerToken(req);
    const user = token ? tokens.get(token) : undefined;
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { socket: ws, user, room: null };
      clients.add(client);
      ws.send(JSON.stringify({ type: 'connected', user }));

      ws.on('message', (raw) => {
        let payload: { type?: string; room?: string };
        try {
          payload = JSON.parse(raw.toString()) as { type?: string; room?: string };
        } catch {
          ws.send(JSON.stringify({ type: 'error', content: 'Invalid message payload' }));
          return;
        }

        if (payload.type !== 'join_room') {
          ws.send(JSON.stringify({ type: 'error', content: 'unknown message type' }));
          return;
        }

        const roomSlug = payload.room?.trim();
        if (!roomSlug) {
          ws.send(JSON.stringify({ type: 'error', content: 'room is required' }));
          return;
        }

        joinCount += 1;
        if (client.room) {
          const left = client.room;
          client.room = null;
          broadcast(left, { type: 'user_left', room: left, user }, ws);
        }

        const room = rooms.get(roomSlug) ?? {
          id: nextRoomId++,
          slug: roomSlug,
          name: roomSlug,
          type: 'group',
          members: [],
        };
        rooms.set(room.slug, room);
        if (!room.members.includes(user)) {
          room.members.push(user);
        }
        client.room = room.slug;
        ws.send(JSON.stringify({ type: 'joined_room', room: room.slug }));
        ws.send(JSON.stringify({ type: 'room_users', room: room.slug, users: connectedUsers(room.slug) }));
        broadcast(room.slug, { type: 'user_joined', room: room.slug, user }, ws);
      });

      ws.on('close', () => {
        const left = client.room;
        clients.delete(client);
        if (left) {
          broadcast(left, { type: 'user_left', room: left, user });
        }
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    get joinCount() {
      return joinCount;
    },
    seedUser(username: string, password: string) {
      const name = username.trim().toLowerCase();
      if (!users.has(name)) {
        users.set(name, {
          id: nextUserId++,
          password,
          role: users.size === 0 ? 'admin' : 'member',
          avatarFileId: null,
        });
      } else {
        const existing = users.get(name);
        if (existing) {
          existing.password = password;
        }
      }
      addToGeneral(name);
    },
    revokeToken(token: string) {
      tokens.delete(token);
    },
    dropConnections() {
      for (const client of [...clients]) {
        client.socket.close();
      }
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        for (const client of [...clients]) {
          client.socket.terminate();
        }
        wss.close();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
