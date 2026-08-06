#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { HermesApi } from './api.js';
import { parseCommand } from './commands.js';
import { ClientState, MessageRecord } from './types.js';
import { HermesWsClient } from './ws.js';

const state: ClientState = {
  username: null,
  token: null,
  room: null,
  messages: [],
  baseUrl: process.env.HERMES_BASE_URL || 'http://127.0.0.1:3000',
};

const api = new HermesApi(state.baseUrl);
const ws = new HermesWsClient(state.baseUrl);
const rl = readline.createInterface({ input, output });
let socketListenersRegistered = false;

function printHelp(): void {
  console.log(`
Available commands:
  help                 Show this help
  health               Check backend health
  register <user> <password>
  login <user> <password>
  join <room>          Join a room over WebSocket
  history <room>       Fetch room history from REST
  send <message>       Send a message to the current room
  messages             Show current message list
  quit                 Exit the client
`);
}

function printMessages(messages: MessageRecord[]): void {
  if (messages.length === 0) {
    console.log('No messages yet.');
    return;
  }

  for (const message of messages) {
    console.log(`[${message.created_at}] ${message.sender}: ${message.content}`);
  }
}

async function connectWebSocket(): Promise<void> {
  if (!socketListenersRegistered) {
    ws.onMessage((payload) => {
      if (payload.type === 'connected') {
        console.log(`Connected as ${payload.user ?? 'anonymous'}`);
        return;
      }

      if (payload.type === 'joined_room') {
        console.log(`Joined room ${payload.room}`);
        return;
      }

      if (payload.type === 'message' && payload.message) {
        state.messages.push(payload.message);
        console.log(`[live] ${payload.message.sender}: ${payload.message.content}`);
        return;
      }

      if (payload.type === 'error') {
        console.log(`Error: ${payload.message}`);
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
    console.log('WebSocket connected. Live room messaging is available.');
    return;
  }

  if (status === 'connecting') {
    console.log('WebSocket is still connecting...');
    return;
  }

  if (status === 'error' && lastError) {
    console.log(`WebSocket unavailable: ${lastError}`);
    console.log('REST commands will still work, but live room messaging is disabled until the backend websocket endpoint is reachable.');
    return;
  }

  console.log('WebSocket is not connected yet. Live room messaging will be unavailable until the backend websocket endpoint is reachable.');
}

async function run(): Promise<void> {
  console.log('Hermes terminal client started. Type help to see commands.');

  printConnectionStatus();

  while (true) {
    const inputLine = await rl.question('hermes> ');
    const { command, args } = parseCommand(inputLine);

    try {
      switch (command) {
        case 'help':
          printHelp();
          break;
        case 'health': {
          const health = await api.health();
          console.log(JSON.stringify(health, null, 2));
          break;
        }
        case 'register': {
          const [username, password] = args;
          if (!username || !password) {
            console.log('Usage: register <username> <password>');
            break;
          }
          const response = await api.register(username, password);
          state.username = response.user.username;
          console.log(`Registered ${response.user.username}`);
          break;
        }
        case 'login': {
          const [username, password] = args;
          if (!username || !password) {
            console.log('Usage: login <username> <password>');
            break;
          }
          const auth = await api.login(username, password);
          state.username = auth.username;
          state.token = auth.token;
          console.log(`Logged in as ${auth.username}`);

          try {
            await connectWebSocket();
            printConnectionStatus();
          } catch (error) {
            console.log(`WebSocket connection unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
          break;
        }
        case 'join': {
          const [room] = args;
          if (!room) {
            console.log('Usage: join <room>');
            break;
          }
          if (!state.username) {
            console.log('Please login first.');
            break;
          }

          try {
            await connectWebSocket();
          } catch (error) {
            console.log(`Cannot join room yet. ${error instanceof Error ? error.message : String(error)}`);
            break;
          }

          state.room = room;
          await ws.joinRoom(room, state.username);
          console.log(`Requested join for room ${room}`);
          break;
        }
        case 'history': {
          const [room] = args;
          if (!room) {
            console.log('Usage: history <room>');
            break;
          }
          const messages = await api.listMessages(room);
          state.messages = messages;
          printMessages(messages);
          break;
        }
        case 'send': {
          const [messageText] = args;
          if (!messageText) {
            console.log('Usage: send <message>');
            break;
          }
          if (!state.username || !state.room || !state.token) {
            console.log('Please login, join a room, and ensure you have a token.');
            break;
          }
          const message = await api.createMessage(state.room, state.username, messageText, state.token);
          state.messages.push(message);
          console.log(`Sent: ${message.content}`);
          await ws.sendMessage(state.room, state.username, messageText);
          break;
        }
        case 'messages':
          printMessages(state.messages);
          break;
        case 'quit':
        case 'exit':
          rl.close();
          ws.close();
          process.exit(0);
        default:
          console.log('Unknown command. Type help for usage.');
      }
    } catch (error) {
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
