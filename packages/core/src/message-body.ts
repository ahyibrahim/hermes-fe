export type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'mention'; username: string }
  | { type: 'inline_code'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'url'; value: string };

export type MessagePart =
  | InlinePart
  | { type: 'code'; value: string; lang?: string }
  | { type: 'list'; ordered: boolean; start?: number; items: InlinePart[][] };

const TRAILING_URL_PUNCT = /[),.;:!?]+$/;

function trimUrl(raw: string): string {
  let value = raw;
  while (value.length > 0) {
    const next = value.replace(TRAILING_URL_PUNCT, '');
    if (next === value) {
      break;
    }
    value = next;
  }
  return value;
}

function findUrl(text: string, cursor: number): { index: number; value: string } | null {
  const fromHere = text.slice(cursor);
  const match = fromHere.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match || match.index === undefined) {
    return null;
  }
  const value = trimUrl(match[0]);
  if (!/^https?:\/\/[^\s/]/i.test(value)) {
    return null;
  }
  return { index: cursor + match.index, value };
}

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

function parsePlain(text: string, known: string[]): InlinePart[] {
  if (!text) {
    return [];
  }

  const names = [...known].sort((a, b) => b.length - a.length);
  const parts: InlinePart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const mention = findMention(text, cursor, names);
    const url = findUrl(text, cursor);
    const bold = findWrapped(text, cursor, '**');
    const italic = findWrapped(text, cursor, '*');
    const strike = findWrapped(text, cursor, '~~');
    const code = findWrapped(text, cursor, '`');

    const candidates = [
      mention ? { kind: 'mention' as const, index: mention.index, mention } : null,
      url ? { kind: 'url' as const, index: url.index, url } : null,
      bold ? { kind: 'bold' as const, index: bold.index, wrap: bold } : null,
      italic && (!bold || italic.index < bold.index)
        ? { kind: 'italic' as const, index: italic.index, wrap: italic }
        : null,
      strike ? { kind: 'strike' as const, index: strike.index, wrap: strike } : null,
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

    if (next.kind === 'url') {
      parts.push({ type: 'url', value: next.url.value });
      cursor = next.index + next.url.value.length;
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

    if (next.kind === 'strike') {
      parts.push({ type: 'strike', value: next.wrap.value });
      cursor = next.wrap.end;
      continue;
    }

    parts.push({ type: 'inline_code', value: next.wrap.value });
    cursor = next.wrap.end;
  }

  return parts;
}

const BULLET_LINE = /^ {0,3}[-*] +(\S.*)$/;
const ORDERED_LINE = /^ {0,3}(\d{1,9})\. +(\S.*)$/;

function listLine(line: string): { ordered: boolean; number?: number; text: string } | null {
  const bullet = BULLET_LINE.exec(line);
  if (bullet) {
    return { ordered: false, text: bullet[1] };
  }
  const ordered = ORDERED_LINE.exec(line);
  if (ordered) {
    return { ordered: true, number: Number(ordered[1]), text: ordered[2] };
  }
  return null;
}

/**
 * Consecutive `- ` / `* ` or `1. ` lines become a list; everything else is
 * inline text. A list owns the line breaks around it, since it renders as a
 * block.
 */
function parseBlocks(text: string, known: string[]): MessagePart[] {
  const lines = text.split('\n');
  if (!lines.some((line) => listLine(line))) {
    return parsePlain(text, known);
  }

  const parts: MessagePart[] = [];
  let pending: string[] = [];
  let list: { ordered: boolean; start?: number; items: string[] } | null = null;

  const flushText = (): void => {
    if (pending.length > 0) {
      parts.push(...parsePlain(pending.join('\n'), known));
      pending = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      parts.push({
        type: 'list',
        ordered: list.ordered,
        ...(list.ordered && list.start !== undefined && list.start !== 1 ? { start: list.start } : {}),
        items: list.items.map((item) => parsePlain(item, known)),
      });
      list = null;
    }
  };

  for (const line of lines) {
    const item = listLine(line);
    if (!item) {
      flushList();
      pending.push(line);
      continue;
    }
    if (!list || list.ordered !== item.ordered) {
      flushList();
      flushText();
      list = { ordered: item.ordered, start: item.number, items: [] };
    }
    list.items.push(item.text);
  }
  flushList();
  flushText();

  return parts;
}

/**
 * Split a message into mentions, http(s) URLs, fenced code (legacy), inline
 * `code`, *italic*, **bold**, ~~strike~~, and `-` / `*` / `1.` lists.
 * Mentions, URLs, and emphasis are not parsed inside fences or inline code.
 */
export function parseMessageBody(content: string, knownUsers: Iterable<string> = []): MessagePart[] {
  const known = [...new Set([...knownUsers].filter(Boolean))];
  const parts: MessagePart[] = [];
  let i = 0;

  while (i < content.length) {
    const start = content.indexOf('```', i);
    if (start === -1) {
      parts.push(...parseBlocks(content.slice(i), known));
      break;
    }

    if (start > i) {
      parts.push(...parseBlocks(content.slice(i, start), known));
    }

    const afterOpener = start + 3;
    const newline = content.indexOf('\n', afterOpener);
    const langRaw = newline === -1 ? content.slice(afterOpener) : content.slice(afterOpener, newline);
    const lang = langRaw.trim() || undefined;
    const codeStart = newline === -1 ? afterOpener : newline + 1;
    const closer = content.indexOf('```', codeStart);
    if (closer === -1) {
      parts.push({ type: 'code', value: content.slice(codeStart), ...(lang ? { lang } : {}) });
      break;
    }

    parts.push({ type: 'code', value: content.slice(codeStart, closer), ...(lang ? { lang } : {}) });
    i = closer + 3;
    if (content[i] === '\n') {
      i += 1;
    }
  }

  return parts;
}
