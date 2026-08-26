#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { HermesApi } from './api.js';
import { parseChatLine } from './commands.js';
import { printAbovePrompt, questionPassword } from './terminal.js';
import { ClientState, MessageRecord, RoomRecord } from './types.js';
import { HermesWsClient, WsIncomingMessage } from './ws.js';

const state: ClientState = {
  username: null,
  token: null,
  room: null,
  roomUsers: [],
  messages: [],
  baseUrl: process.env.HERMES_BASE_URL || 'http://ying-1:3000',
};

const api = new HermesApi(state.baseUrl);
const ws = new HermesWsClient(state.baseUrl);
const rl = readline.createInterface({ input, output });
const displayedMessageIds = new Set<number>();
const pendingEchoes: Array<{ content: string; at: number }> = [];
let socketListenersRegistered = false;
let inChat = false;

function say(line: string): void {
  if (inChat) {
    printAbovePrompt(rl, line);
    return;
  }

  console.log(line);
}

function chatPrompt(): string {
  const room = state.room ?? 'no-room';
  if (ws.getStatus() !== 'open') {
    return `[${room} | offline] `;
  }

  return `[${room}] `;
}

function refreshPrompt(): void {
  rl.setPrompt(chatPrompt());
}

function formatUsersLine(): string {
  const names = new Set(state.roomUsers);
  if (names.size === 0 && state.username) {
    names.add(state.username);
  }

  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return `Users: ${sorted.join(', ') || '(none)'}`;
}

function formatMessage(message: MessageRecord): string {
  return `[${message.created_at}] ${message.sender}: ${message.content}`;
}

function printHelp(): void {
  say(`
Slash commands:
  /help              Show this help
  /health            Check backend health
  /join <room>       Switch room, reload users and history
  /quit              Exit the client
Type a message and press Enter to send.
`);
}

function printMessages(messages: MessageRecord[]): void {
  if (messages.length === 0) {
    say('No messages yet.');
    return;
  }

  for (const message of messages) {
    displayedMessageIds.add(message.id);
    say(formatMessage(message));
  }
}

function rememberPendingEcho(content: string): void {
  pendingEchoes.push({ content, at: Date.now() });
}

function consumePendingEcho(content: string, sender: string): boolean {
  if (sender !== state.username) {
    return false;
  }

  const cutoff = Date.now() - 10_000;
  const index = pendingEchoes.findIndex((entry) => entry.content === content && entry.at >= cutoff);
  if (index === -1) {
    return false;
  }

  pendingEchoes.splice(index, 1);
  return true;
}

function roomMatches(payload: WsIncomingMessage): boolean {
  return payload.room === undefined || payload.room === state.room;
}

function setRoster(users: string[]): void {
  state.roomUsers = [...new Set(users)];
}

function addRoomUser(user: string): boolean {
  if (state.roomUsers.includes(user)) {
    return false;
  }

  state.roomUsers.push(user);
  return true;
}

function removeRoomUser(user: string): boolean {
  const next = state.roomUsers.filter((name) => name !== user);
  if (next.length === state.roomUsers.length) {
    return false;
  }

  state.roomUsers = next;
  return true;
}

function handlePresence(payload: WsIncomingMessage): boolean {
  if (payload.type === 'room_users' && roomMatches(payload) && Array.isArray(payload.users)) {
    setRoster(payload.users);
    say(formatUsersLine());
    return true;
  }

  if (payload.type === 'user_joined' && payload.user && roomMatches(payload)) {
    if (addRoomUser(payload.user)) {
      say(formatUsersLine());
    }
    return true;
  }

  if (payload.type === 'user_left' && payload.user && roomMatches(payload)) {
    if (removeRoomUser(payload.user)) {
      say(formatUsersLine());
    }
    return true;
  }

  return false;
}

async function connectWebSocket(): Promise<void> {
  if (!socketListenersRegistered) {
    ws.onMessage((payload) => {
      if (handlePresence(payload)) {
        return;
      }

      if (payload.type === 'connected') {
        say(`Connected as ${payload.user ?? 'anonymous'}`);
        return;
      }

      if (payload.type === 'joined_room') {
        if (payload.room && payload.room !== state.room) {
          return;
        }

        if (state.username && state.roomUsers.length === 0) {
          setRoster([state.username]);
        }

        say(`Joined room ${payload.room ?? state.room ?? ''}`);
        return;
      }

      if (payload.type === 'message' && payload.message) {
        const message = payload.message;
        if (displayedMessageIds.has(message.id) || consumePendingEcho(message.content, message.sender)) {
          displayedMessageIds.add(message.id);
          return;
        }

        displayedMessageIds.add(message.id);
        state.messages.push(message);
        say(formatMessage(message));
        return;
      }

      if (payload.type === 'error') {
        const detail = typeof payload.message === 'string' ? payload.message : payload.content;
        say(`Error: ${detail ?? 'unknown error'}`);
      }
    });
    socketListenersRegistered = true;
  }

  await ws.connect();
}

function printConnectionStatus(): void {
  const status = ws.getStatus();
  const lastError = ws.getLastError();

  if (status === 'open') {
    say('WebSocket connected. Live room messaging is available.');
    return;
  }

  if (status === 'connecting') {
    say('WebSocket is still connecting...');
    return;
  }

  if (status === 'error' && lastError) {
    say(`WebSocket unavailable: ${lastError}`);
    say('REST will still work, but live room messaging is disabled until the backend websocket endpoint is reachable.');
    return;
  }

  say('WebSocket is not connected yet. Live room messaging will be unavailable until the backend websocket endpoint is reachable.');
}

async function ensureAuthenticated(): Promise<void> {
  console.log('Hermes terminal client');
  console.log(`Backend: ${state.baseUrl}`);

  while (!state.token || !state.username) {
    const choice = (await rl.question('Login (l) or register (r)? ')).trim().toLowerCase();

    if (choice === 'quit' || choice === 'exit' || choice === '/quit' || choice === '/exit') {
      shutdown();
    }

    if (choice !== 'l' && choice !== 'login' && choice !== 'r' && choice !== 'register') {
      console.log('Enter l to login or r to register.');
      continue;
    }

    const username = (await rl.question('Username: ')).trim();
    if (!username) {
      console.log('Username is required.');
      continue;
    }

    const password = await questionPassword(rl, 'Password: ');
    if (!password) {
      console.log('Password is required.');
      continue;
    }

    try {
      if (choice === 'r' || choice === 'register') {
        const response = await api.register(username, password);
        console.log(`Registered ${response.user.username}`);
      }

      const auth = await api.login(username, password);
      state.username = auth.username;
      state.token = auth.token;
      console.log(`Logged in as ${auth.username}`);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await connectWebSocket();
    printConnectionStatus();
  } catch (error) {
    console.log(`WebSocket connection unavailable: ${error instanceof Error ? error.message : String(error)}`);
    console.log('You can still send and load history over REST.');
  }
}

function resolveRoom(input: string, rooms: RoomRecord[]): { slug: string; members: string[] } {
  const trimmed = input.trim();
  const bySlug = rooms.find((room) => room.slug === trimmed);
  if (bySlug) {
    return { slug: bySlug.slug, members: bySlug.members ?? [] };
  }

  const byName = rooms.find((room) => room.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return { slug: byName.slug, members: byName.members ?? [] };
  }

  if (/^\d+$/.test(trimmed)) {
    const byId = rooms.find((room) => room.id === Number(trimmed));
    if (byId) {
      return { slug: byId.slug, members: byId.members ?? [] };
    }
  }

  return { slug: trimmed, members: [] };
}

function printRoomList(rooms: RoomRecord[]): void {
  if (rooms.length === 0) {
    say('No rooms returned by the backend.');
    return;
  }

  say('Available rooms:');
  for (const room of rooms) {
    say(`  ${room.id}  ${room.slug}  ${room.name}`);
  }
}

async function loadRooms(): Promise<RoomRecord[]> {
  if (!state.token) {
    return [];
  }

  try {
    return await api.listRooms(state.token);
  } catch (error) {
    say(`Could not list rooms: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function promptForRoom(): Promise<string> {
  const rooms = await loadRooms();
  printRoomList(rooms);

  while (true) {
    const room = (await rl.question('Room (id or slug): ')).trim();
    if (room) {
      return room;
    }

    console.log('Room name is required.');
  }
}

async function enterRoom(roomInput: string): Promise<void> {
  if (!state.username) {
    say('Please login first.');
    return;
  }

  const rooms = await loadRooms();
  const resolved = resolveRoom(roomInput, rooms);
  const room = resolved.slug;

  if (resolved.slug !== roomInput) {
    say(`Using room ${resolved.slug} (from ${roomInput}).`);
  }

  state.room = room;
  state.messages = [];
  displayedMessageIds.clear();
  pendingEchoes.length = 0;
  setRoster(resolved.members.length > 0 ? resolved.members : state.username ? [state.username] : []);

  try {
    await connectWebSocket();
    await ws.joinRoom(room, state.username);
  } catch (error) {
    say(`Cannot join room over WebSocket. ${error instanceof Error ? error.message : String(error)}`);
    say('Loading history over REST anyway.');
  }

  say(formatUsersLine());

  try {
    if (!state.token) {
      say('Could not load history: missing auth token. Please login again.');
    } else {
      const messages = await api.listMessages(room, state.token);
      state.messages = messages;
      printMessages(messages);
    }
  } catch (error) {
    say(`Could not load history: ${error instanceof Error ? error.message : String(error)}`);
  }

  refreshPrompt();
}

async function sendChatMessage(text: string): Promise<void> {
  if (!state.username || !state.room || !state.token) {
    say('Please login, join a room, and ensure you have a token.');
    return;
  }

  const message = await api.createMessage(state.room, state.username, text, state.token);
  displayedMessageIds.add(message.id);
  rememberPendingEcho(text);
  state.messages.push(message);
  say(formatMessage(message));

  try {
    await ws.sendMessage(state.room, state.username, text);
  } catch (error) {
    say(`Live send unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function shutdown(): never {
  rl.close();
  ws.close();
  process.exit(0);
}

async function handleSlashCommand(command: string, args: string[]): Promise<void> {
  switch (command) {
    case 'help':
      printHelp();
      break;
    case 'health': {
      const health = await api.health();
      say(JSON.stringify(health, null, 2));
      break;
    }
    case 'join': {
      const room = args[0];
      if (!room) {
        say('Usage: /join <room>');
        break;
      }
      await enterRoom(room);
      break;
    }
    case 'quit':
    case 'exit':
      shutdown();
      break;
    default:
      say('Unknown command. Type /help for usage.');
  }
}

async function runChatLoop(): Promise<void> {
  inChat = true;
  refreshPrompt();
  printHelp();

  while (true) {
    const inputLine = await rl.question(chatPrompt());
    const parsed = parseChatLine(inputLine);

    try {
      if (parsed.kind === 'empty') {
        continue;
      }

      if (parsed.kind === 'message') {
        await sendChatMessage(parsed.text);
        continue;
      }

      await handleSlashCommand(parsed.command, parsed.args);
    } catch (error) {
      say(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function run(): Promise<void> {
  await ensureAuthenticated();
  const room = await promptForRoom();
  await enterRoom(room);
  await runChatLoop();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
