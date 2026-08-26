export interface ParsedCommand {
  command: string;
  args: string[];
  rest: string;
}

export type ChatInput =
  | { kind: 'empty' }
  | { kind: 'message'; text: string }
  | { kind: 'command'; command: string; args: string[]; rest: string };

export function parseChatLine(input: string): ChatInput {
  const trimmed = input.trim();

  if (!trimmed) {
    return { kind: 'empty' };
  }

  if (!trimmed.startsWith('/')) {
    return { kind: 'message', text: trimmed };
  }

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.search(/\s/);

  if (spaceIndex === -1) {
    return { kind: 'command', command: withoutSlash.toLowerCase(), args: [], rest: '' };
  }

  const command = withoutSlash.slice(0, spaceIndex).toLowerCase();
  const rest = withoutSlash.slice(spaceIndex + 1).trim();
  const args = rest.length === 0 ? [] : rest.split(/\s+/);

  return { kind: 'command', command, args, rest };
}

export function parseCommand(input: string): ParsedCommand {
  const parsed = parseChatLine(input);

  if (parsed.kind === 'empty') {
    return { command: 'help', args: [], rest: '' };
  }

  if (parsed.kind === 'message') {
    return { command: 'send', args: parsed.text.split(/\s+/), rest: parsed.text };
  }

  return { command: parsed.command, args: parsed.args, rest: parsed.rest };
}
