export type MessagePart =
  | { type: 'text'; value: string }
  | { type: 'mention'; username: string }
  | { type: 'code'; value: string }
  | { type: 'inline_code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string };

function isNameBoundary(char: string | undefined): boolean {
  if (char === undefined) {
    return true;
  }
  return !/[a-z0-9_]/i.test(char);
}

function findMention(
  text: string,
  cursor: number,
  names: string[]
): { index: number; username: string } | null {
  const fromHere = text.slice(cursor);
  let atSearch = 0;
  while (atSearch < fromHere.length) {
    const at = fromHere.indexOf('@', atSearch);
    if (at === -1) {
      return null;
    }
    const after = fromHere.slice(at + 1);
    const match = names.find(
      (name) => after.toLowerCase().startsWith(name.toLowerCase()) && isNameBoundary(after[name.length])
    );
    if (match) {
      return { index: cursor + at, username: match };
    }
    atSearch = at + 1;
  }
  return null;
}

function findWrapped(
  text: string,
  cursor: number,
  marker: string
): { index: number; value: string; end: number } | null {
  const start = text.indexOf(marker, cursor);
  if (start === -1) {
    return null;
  }
  const innerStart = start + marker.length;
  const close = text.indexOf(marker, innerStart);
  if (close === -1 || close === innerStart) {
    return null;
  }
  return { index: start, value: text.slice(innerStart, close), end: close + marker.length };
}

function parsePlain(text: string, known: string[]): MessagePart[] {
  if (!text) {
    return [];
  }

  const names = [...known].sort((a, b) => b.length - a.length);
  const parts: MessagePart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const mention = findMention(text, cursor, names);
    const bold = findWrapped(text, cursor, '**');
    const italic = findWrapped(text, cursor, '*');
    const code = findWrapped(text, cursor, '`');

    const candidates = [
      mention ? { kind: 'mention' as const, index: mention.index, mention } : null,
      bold ? { kind: 'bold' as const, index: bold.index, wrap: bold } : null,
      italic && (!bold || italic.index < bold.index)
        ? { kind: 'italic' as const, index: italic.index, wrap: italic }
        : null,
      code ? { kind: 'inline_code' as const, index: code.index, wrap: code } : null,
    ].filter((row): row is NonNullable<typeof row> => row !== null);

    if (candidates.length === 0) {
      parts.push({ type: 'text', value: text.slice(cursor) });
      break;
    }

    candidates.sort((a, b) => a.index - b.index || (a.kind === 'bold' && b.kind === 'italic' ? -1 : 0));
    const next = candidates[0];
    if (next.index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, next.index) });
    }

    if (next.kind === 'mention') {
      parts.push({ type: 'mention', username: next.mention.username });
      cursor = next.index + 1 + next.mention.username.length;
      continue;
    }

    if (next.kind === 'bold') {
      parts.push({ type: 'bold', value: next.wrap.value });
      cursor = next.wrap.end;
      continue;
    }

    if (next.kind === 'italic') {
      parts.push({ type: 'italic', value: next.wrap.value });
      cursor = next.wrap.end;
      continue;
    }

    parts.push({ type: 'inline_code', value: next.wrap.value });
    cursor = next.wrap.end;
  }

  return parts;
}

/**
 * Split a message into mentions, fenced code (legacy), inline `code`,
 * *italic*, and **bold**. URLs stay as text. Mentions and emphasis are not
 * parsed inside fences.
 */
export function parseMessageBody(content: string, knownUsers: Iterable<string> = []): MessagePart[] {
  const known = [...new Set([...knownUsers].filter(Boolean))];
  const parts: MessagePart[] = [];
  let i = 0;

  while (i < content.length) {
    const start = content.indexOf('```', i);
    if (start === -1) {
      parts.push(...parsePlain(content.slice(i), known));
      break;
    }

    if (start > i) {
      parts.push(...parsePlain(content.slice(i, start), known));
    }

    const afterOpener = start + 3;
    const newline = content.indexOf('\n', afterOpener);
    const codeStart = newline === -1 ? afterOpener : newline + 1;
    const closer = content.indexOf('```', codeStart);
    if (closer === -1) {
      parts.push({ type: 'code', value: content.slice(codeStart) });
      break;
    }

    parts.push({ type: 'code', value: content.slice(codeStart, closer) });
    i = closer + 3;
    if (content[i] === '\n') {
      i += 1;
    }
  }

  return parts;
}
