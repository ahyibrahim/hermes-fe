export interface ParsedCommand {
  command: string;
  args: string[];
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed) {
    return { command: "help", args: [] };
  }

  const [command, ...args] = trimmed.split(/\s+/);
  return { command: command.toLowerCase(), args };
}
