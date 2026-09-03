import http from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { isUserColor, nextUserColor } from '../colors.js';
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
  color: string;
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
  const callMembers = new Map<string, Set<string>>();
  const reads = new Map<string, number>();
  const hidden = new Set<string>();
  const resetTokens = new Map<string, string>();
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
        color: user.color,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

  const profileOf = (username: string): PublicUser | undefined =>
    publicUsers().find((user) => user.username === username);

  const readKey = (username: string, room: string): string => `${username}\0${room}`;

  const unreadCount = (username: string, room: string): number => {
    const last = reads.get(readKey(username, room)) ?? 0;
    return messages.filter(
      (message) => message.room === room && message.id > last && !message.deleted_at
    ).length;
  };

  const hideKey = (username: string, room: string): string => `${username}\0${room}`;

  const lastMessagePreview = (slug: string) => {
    const row = [...messages].reverse().find((message) => message.room === slug);
    if (!row) {
      return null;
    }
    if (row.deleted_at) {
      return { id: row.id, sender: row.sender, content: '', deleted: true, file: false };
    }
    const raw = row.content ?? '';
    return {
      id: row.id,
      sender: row.sender,
      content: raw.length > 80 ? raw.slice(0, 80) : raw,
      deleted: false,
      file: row.file_id != null,
    };
  };

  const revealDm = (slug: string): void => {
    const room = rooms.get(slug);
    if (!room || room.type !== 'dm') {
      return;
    }
    for (const member of room.members) {
      hidden.delete(hideKey(member, slug));
    }
  };

  const markRead = (username: string, room: string): void => {
    const maxId = messages
      .filter((message) => message.room === room)
      .reduce((max, message) => Math.max(max, message.id), 0);
    reads.set(readKey(username, room), maxId);
  };

  const broadcast = (room: string, payload: unknown, except?: WebSocket): void => {
    const data = JSON.stringify(payload);
    for (const client of clients) {
      if (client.room === room && client.socket !== except && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(data);
      }
    }
  };

  const broadcastToMembers = (roomSlug: string, payload: unknown, exceptUser?: string): void => {
    const room = rooms.get(roomSlug);
    if (!room) {
      return;
    }
    const data = JSON.stringify(payload);
    const sent = new Set<WebSocket>();
    for (const member of room.members) {
      if (exceptUser && member === exceptUser) {
        continue;
      }
      for (const client of socketsFor(member)) {
        if (!sent.has(client.socket)) {
          client.socket.send(data);
          sent.add(client.socket);
        }
      }
    }
  };

  const socketsFor = (username: string): Client[] =>
    [...clients].filter((client) => client.user === username && client.socket.readyState === WebSocket.OPEN);

  const sendToUser = (username: string, payload: unknown): void => {
    const data = JSON.stringify(payload);
    for (const client of socketsFor(username)) {
      client.socket.send(data);
    }
  };

  const callRoster = (room: string): string[] => [...(callMembers.get(room) ?? [])].sort((a, b) => a.localeCompare(b));

  const broadcastCall = (room: string, payload: unknown, exceptUser?: string): void => {
    const members = callMembers.get(room);
    if (!members) {
      return;
    }
    for (const name of members) {
      if (exceptUser && name === exceptUser) {
        continue;
      }
      sendToUser(name, payload);
    }
  };

  const removeFromCall = (room: string, username: string, notifyLeaver: boolean): void => {
    const members = callMembers.get(room);
    if (!members?.has(username)) {
      return;
    }
    members.delete(username);
    if (members.size === 0) {
      callMembers.delete(room);
    }
    broadcastCall(room, { type: 'user_left_call', room, user: username });
    if (notifyLeaver) {
      sendToUser(username, { type: 'left_call', room });
    }
  };

  const leaveAllCalls = (username: string): void => {
    for (const room of [...callMembers.keys()]) {
      removeFromCall(room, username, false);
    }
  };

  const remainingSockets = (username: string): number =>
    [...clients].filter((client) => client.user === username).length;

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
          color: nextUserColor([...users.values()].map((user) => user.color)),
        });
        addToGeneral(username);
        const created = users.get(username);
        sendJson(res, 200, {
          user: { id: created?.id, username, role: created?.role, color: created?.color },
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

      if (method === 'POST' && url.pathname === '/auth/reset') {
        const body = JSON.parse((await readBody(req)).toString()) as {
          username?: string;
          token?: string;
          password?: string;
        };
        const username = body.username?.trim().toLowerCase() ?? '';
        const stored = resetTokens.get(username);
        if (!stored || stored !== body.token || !body.password) {
          sendJson(res, 401, { error: 'invalid reset token' });
          return;
        }
        const user = users.get(username);
        if (!user) {
          sendJson(res, 401, { error: 'invalid reset token' });
          return;
        }
        user.password = body.password;
        resetTokens.delete(username);
        for (const [tok, name] of [...tokens]) {
          if (name === username) {
            tokens.delete(tok);
          }
        }
        const token = `tok-${nextToken++}`;
        tokens.set(token, username);
        sendJson(res, 200, { username, token, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
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
          color?: string;
        };
        const user = users.get(username);
        if (!user) {
          sendJson(res, 401, { error: 'authentication required' });
          return;
        }
        if (typeof body.color === 'string') {
          if (!isUserColor(body.color)) {
            sendJson(res, 400, { error: 'color is not in the palette' });
            return;
          }
          const taken = new Set(
            [...users.values()].filter((entry) => entry.id !== user.id).map((entry) => entry.color)
          );
          if (taken.has(body.color) && user.color !== body.color) {
            sendJson(res, 409, { error: 'color is taken' });
            return;
          }
          user.color = body.color;
          const profile = profileOf(username);
          for (const name of new Set([...clients].map((client) => client.user))) {
            sendToUser(name, { type: 'user_updated', user: profile });
          }
          sendJson(res, 200, profile);
          return;
        }
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

      const resetMatch = /^\/users\/([^/]+)\/password-reset$/.exec(url.pathname);
      if (method === 'POST' && resetMatch) {
        const actor = requireUser(req, res);
        if (!actor) {
          return;
        }
        if (users.get(actor)?.role !== 'admin') {
          sendJson(res, 403, { error: 'admin required' });
          return;
        }
        const target = decodeURIComponent(resetMatch[1]).trim().toLowerCase();
        if (!users.has(target)) {
          sendJson(res, 404, { error: 'user not found' });
          return;
        }
        const token = `reset-${nextToken++}`;
        resetTokens.set(target, token);
        sendJson(res, 201, { token, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
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

      if (method === 'GET' && url.pathname === '/ice') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        sendJson(res, 200, { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
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
            .filter((room) => room.members.includes(username) && !hidden.has(hideKey(username, room.slug)))
            .map((room) => ({
              id: room.id,
              slug: room.slug,
              name: room.name,
              type: room.type ?? 'group',
              members: [...new Set([...room.members, ...connectedUsers(room.slug)])],
              unread_count: unreadCount(username, room.slug),
              last_message: lastMessagePreview(room.slug),
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
          if (!existing.members.includes(username)) {
            existing.members.push(username);
          }
          if (!existing.members.includes(other)) {
            existing.members.push(other);
          }
          hidden.delete(hideKey(username, existing.slug));
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

      if (method === 'POST' && url.pathname === '/rooms/leave') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { room?: string };
        const slug = body.room?.trim() ?? '';
        if (!slug) {
          sendJson(res, 400, { error: 'room is required' });
          return;
        }
        if (slug === 'general') {
          sendJson(res, 400, { error: 'cannot leave general' });
          return;
        }
        const room = rooms.get(slug);
        if (room?.type === 'dm' || slug.startsWith('dm:')) {
          sendJson(res, 400, { error: 'cannot leave a DM' });
          return;
        }
        if (!room?.members.includes(username)) {
          sendJson(res, 403, { error: 'not a member of that room' });
          return;
        }
        room.members = room.members.filter((member) => member !== username);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && url.pathname === '/rooms/hide') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { room?: string };
        const slug = body.room?.trim() ?? '';
        if (!slug) {
          sendJson(res, 400, { error: 'room is required' });
          return;
        }
        if (slug === 'general') {
          sendJson(res, 400, { error: 'cannot hide general' });
          return;
        }
        const room = rooms.get(slug);
        if (!room || (room.type !== 'dm' && !slug.startsWith('dm:'))) {
          sendJson(res, 400, { error: 'can only hide a DM' });
          return;
        }
        if (!room.members.includes(username)) {
          sendJson(res, 403, { error: 'not a member of this room' });
          return;
        }
        hidden.add(hideKey(username, slug));
        sendJson(res, 200, { ok: true, room: slug });
        return;
      }

      if (method === 'POST' && url.pathname === '/rooms/read') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const body = JSON.parse((await readBody(req)).toString()) as { room?: string };
        const slug = body.room?.trim() ?? '';
        if (!slug) {
          sendJson(res, 400, { error: 'room is required' });
          return;
        }
        markRead(username, slug);
        sendJson(res, 200, { ok: true, room: slug, unread_count: 0 });
        return;
      }

      if (method === 'GET' && url.pathname === '/messages') {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const room = url.searchParams.get('room') ?? 'general';
        markRead(username, room);
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
        revealDm(room.slug);
        broadcastToMembers(room.slug, { type: 'message', message });
        sendJson(res, 200, message);
        return;
      }

      if (method === 'DELETE' && url.pathname.startsWith('/messages/')) {
        const username = requireUser(req, res);
        if (!username) {
          return;
        }
        const id = Number(url.pathname.slice('/messages/'.length));
        const existing = messages.find((row) => row.id === id);
        if (!existing) {
          sendJson(res, 404, { error: 'message not found' });
          return;
        }
        if (existing.sender !== username) {
          sendJson(res, 403, { error: 'only the sender can unsend' });
          return;
        }
        existing.content = '';
        existing.file_id = null;
        existing.deleted_at = existing.deleted_at ?? new Date().toISOString();
        broadcastToMembers(existing.room, { type: 'message_deleted', message: existing });
        sendJson(res, 200, existing);
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
        files.set(fileId, {
          id: fileId,
          name: parsed.file.filename,
          data: parsed.file.data,
          mime: 'application/octet-stream',
        });
        const message: MessageRecord = {
          id: nextMessageId++,
          room: roomSlug,
          sender: username,
          content: parsed.file.filename,
          created_at: new Date().toISOString(),
          file_id: fileId,
        };
        messages.push(message);
        revealDm(roomSlug);
        broadcastToMembers(roomSlug, { type: 'message', message });
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
          'Content-Type': file.mime || 'application/octet-stream',
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
        let payload: {
          type?: string;
          room?: string;
          to?: string;
          sdp?: unknown;
          candidate?: unknown;
        };
        try {
          payload = JSON.parse(raw.toString()) as typeof payload;
        } catch {
          ws.send(JSON.stringify({ type: 'error', content: 'Invalid message payload' }));
          return;
        }

        if (payload.type === 'join_room') {
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
          markRead(user, room.slug);
          ws.send(JSON.stringify({ type: 'joined_room', room: room.slug }));
          ws.send(JSON.stringify({ type: 'room_users', room: room.slug, users: connectedUsers(room.slug) }));
          broadcast(room.slug, { type: 'user_joined', room: room.slug, user }, ws);
          return;
        }

        if (payload.type === 'join_call') {
          const roomSlug = payload.room?.trim();
          if (!roomSlug) {
            ws.send(JSON.stringify({ type: 'error', content: 'room is required' }));
            return;
          }
          const room = rooms.get(roomSlug);
          if (!room?.members.includes(user)) {
            ws.send(JSON.stringify({ type: 'error', content: 'not a member of that room' }));
            return;
          }
          for (const other of [...callMembers.keys()]) {
            if (other !== roomSlug && callMembers.get(other)?.has(user)) {
              removeFromCall(other, user, true);
            }
          }
          if (!callMembers.has(roomSlug)) {
            callMembers.set(roomSlug, new Set());
          }
          const roster = callMembers.get(roomSlug) as Set<string>;
          const wasEmpty = roster.size === 0;
          const already = roster.has(user);
          roster.add(user);
          ws.send(JSON.stringify({ type: 'call_peers', room: roomSlug, users: callRoster(roomSlug) }));
          if (!already) {
            broadcastCall(roomSlug, { type: 'user_joined_call', room: roomSlug, user }, user);
            if (wasEmpty) {
              broadcastToMembers(roomSlug, { type: 'call_started', room: roomSlug, user }, user);
            }
          }
          return;
        }

        if (payload.type === 'leave_call') {
          const roomSlug = payload.room?.trim();
          if (!roomSlug) {
            ws.send(JSON.stringify({ type: 'error', content: 'room is required' }));
            return;
          }
          removeFromCall(roomSlug, user, true);
          return;
        }

        if (payload.type === 'call_offer' || payload.type === 'call_answer' || payload.type === 'ice_candidate') {
          const roomSlug = payload.room?.trim() ?? '';
          const to = payload.to?.trim().toLowerCase() ?? '';
          const members = callMembers.get(roomSlug);
          if (!roomSlug || !to) {
            ws.send(JSON.stringify({ type: 'error', content: 'room and to are required' }));
            return;
          }
          if (!members?.has(user) || !members.has(to) || to === user) {
            ws.send(JSON.stringify({ type: 'error', content: 'not in that call' }));
            return;
          }
          sendToUser(to, {
            type: payload.type,
            room: roomSlug,
            from: user,
            to,
            sdp: payload.sdp,
            candidate: payload.candidate ?? null,
          });
          return;
        }

        ws.send(JSON.stringify({ type: 'error', content: 'unknown message type' }));
      });

      ws.on('close', () => {
        const left = client.room;
        clients.delete(client);
        if (left) {
          broadcast(left, { type: 'user_left', room: left, user });
        }
        if (remainingSockets(user) === 0) {
          leaveAllCalls(user);
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
          color: nextUserColor([...users.values()].map((user) => user.color)),
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
