#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  HermesApi,
  HermesWsClient,
  MessageRecord,
  parseChatLine,
  RoomRecord,
  SessionController,
} from '@hermes/core';
import { NodeFileIO, NodeTokenStore, NodeTransport } from '@hermes/core/node';
import { printAbovePrompt, questionPassword } from './terminal.js';

const baseUrl = process.env.HERMES_BASE_URL || 'http://ying-1:3000';
const api = new HermesApi(baseUrl, new NodeFileIO());
const ws = new HermesWsClient(baseUrl, new NodeTransport());
const session = new SessionController({
  baseUrl,
  api,
  ws,
  tokens: new NodeTokenStore(),
});

const rl = readline.createInterface({ input, output });
let inChat = false;
let authLost = false;

function say(line: string): void {
  if (inChat) {
    printAbovePrompt(rl, line);
    return;
  }

  console.log(line);
}

function chatPrompt(): string {
  const room = session.getState().room ?? 'no-room';
  if (session.getConnectionStatus() !== 'open') {
    return `[${room} | offline] `;
  }

  return `[${room}] `;
}

function refreshPrompt(): void {
  rl.setPrompt(chatPrompt());
}

function formatUsersLine(): string {
  const names = new Set(session.getState().roomUsers);
  if (names.size === 0 && session.getState().username) {
    names.add(session.getState().username as string);
  }

  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return `Users: ${sorted.join(', ') || '(none)'}`;
}

function formatMessage(message: MessageRecord): string {
  const fileSuffix = message.file_id == null || message.file_id === '' ? '' : ` [file ${message.file_id}]`;
  return `[${message.created_at}] ${message.sender}: ${message.content}${fileSuffix}`;
}

function printHelp(): void {
  say(`
Slash commands:
  /help                 Show this help
  /health               Check backend health
  /join <room>          Switch room, reload users and history
  /leave [room]         Leave a group or DM (not general)
  /sendfile <path>      Upload a file to the current room
  /getfile <id> [path]  Download a file by id
  /quit                 Exit the client
Type a message and press Enter to send.
`);
}

function printMessages(messages: MessageRecord[]): void {
  if (messages.length === 0) {
    say('No messages yet.');
    return;
  }

  for (const message of messages) {
    say(formatMessage(message));
  }
}

function printRoomList(rooms: RoomRecord[]): void {
  if (rooms.length === 0) {
    say('No rooms returned by the backend.');
    return;
  }

  say('Available rooms:');
  for (const room of rooms) {
    const unread = room.unread_count && room.unread_count > 0 ? `  (${room.unread_count} unread)` : '';
    say(`  ${room.id}  ${room.slug}  ${room.name}${unread}`);
  }
}

function printConnectionStatus(): void {
  const status = session.getConnectionStatus();
  const lastError = session.getLastError();

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

function bindSession(): void {
  session.on('message', (message) => say(formatMessage(message)));
  session.on('roomActivity', ({ room, message }) => say(`[${room}] ${formatMessage(message)}`));
  session.on('history', ({ messages }) => printMessages(messages));
  session.on('presence', () => say(formatUsersLine()));
  session.on('connected', ({ user }) => say(`Connected as ${user}`));
  session.on('joined', ({ room }) => say(`Joined room ${room}`));
  session.on('info', ({ message }) => say(message));
  session.on('error', ({ message }) => say(`Error: ${message}`));
  session.on('status', () => {
    if (inChat) {
      refreshPrompt();
    }
  });
  session.on('authExpired', () => {
    authLost = true;
    say('Session expired. Please log in again.');
  });
}

async function loginLoop(): Promise<void> {
  while (!session.getState().token || !session.getState().username) {
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

    const password = await questionPassword(rl, 'Password: ', { input, output, onCancel: () => shutdown() });
    if (!password) {
      console.log('Password is required.');
      continue;
    }

    try {
      if (choice === 'r' || choice === 'register') {
        const response = await session.register(username, password);
        console.log(`Registered ${response.user.username}`);
      }

      await session.login(username, password);
      console.log(`Logged in as ${session.getState().username}`);
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function ensureAuthenticated(): Promise<void> {
  console.log('Hermes terminal client');
  console.log(`Backend: ${baseUrl}`);

  if (await session.resume()) {
    console.log(`Logged in as ${session.getState().username}`);
    printConnectionStatus();
    return;
  }

  await loginLoop();

  try {
    await session.connect();
    printConnectionStatus();
  } catch (error) {
    console.log(`WebSocket connection unavailable: ${error instanceof Error ? error.message : String(error)}`);
    console.log('You can still send and load history over REST.');
  }
}

async function loadRooms(): Promise<RoomRecord[]> {
  try {
    return await session.listRooms();
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

function shutdown(): never {
  session.shutdown();
  rl.close();
  process.exit(0);
}

async function handleSlashCommand(command: string, args: string[], rest: string): Promise<void> {
  switch (command) {
    case 'help':
      printHelp();
      break;
    case 'health': {
      const health = await session.health();
      say(JSON.stringify(health, null, 2));
      break;
    }
    case 'join': {
      const room = args[0];
      if (!room) {
        say('Usage: /join <room>');
        break;
      }
      await session.enterRoom(room);
      refreshPrompt();
      break;
    }
    case 'leave': {
      const slug = args[0] || session.getState().room;
      if (!slug) {
        say('Usage: /leave [room]');
        break;
      }
      await session.leaveRoom(slug);
      say(`Left ${slug}.`);
      if (session.getState().room === slug) {
        await session.enterRoom('general');
        refreshPrompt();
      }
      break;
    }
    case 'sendfile': {
      const filePath = rest;
      if (!filePath) {
        say('Usage: /sendfile <path>');
        break;
      }
      await session.sendFile(filePath);
      break;
    }
    case 'getfile': {
      const fileId = args[0];
      if (!fileId) {
        say('Usage: /getfile <id> [path]');
        break;
      }
      await session.getFile(fileId, args[1]);
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
    if (authLost) {
      inChat = false;
      authLost = false;
      await ensureAuthenticated();
      const currentRoom = session.getState().room;
      const room = currentRoom ?? (await promptForRoom());
      await session.enterRoom(room);
      inChat = true;
      refreshPrompt();
    }

    const inputLine = await rl.question(chatPrompt());
    const parsed = parseChatLine(inputLine);

    try {
      if (parsed.kind === 'empty') {
        continue;
      }

      if (parsed.kind === 'message') {
        await session.sendMessage(parsed.text);
        continue;
      }

      await handleSlashCommand(parsed.command, parsed.args, parsed.rest);
    } catch (error) {
      say(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

bindSession();

async function run(): Promise<void> {
  await ensureAuthenticated();
  const room = await promptForRoom();
  await session.enterRoom(room);
  await runChatLoop();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
