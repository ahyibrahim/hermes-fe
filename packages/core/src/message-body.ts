export type MessagePart =
  | { type: 'text'; value: string }
  | { type: 'url'; href: string }
  | { type: 'mention'; username: string }
  | { type: 'code'; value: string };

const URL_RE = /https?:\/\/[^\s<>]+/gi;

function trimUrl(raw: string): string {
  return raw.replace(/[),.;:!?]+$/g, '');
}

function isNameBoundary(char: string | undefined): boolean {
  if (char === undefined) {
    return true;
  }
  return !/[a-z0-9_]/i.test(char);
}

function parsePlain(text: string, known: string[]): MessagePart[] {
  if (!text) {
    return [];
  }

  const names = [...known].sort((a, b) => b.length - a.length);
  const parts: MessagePart[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const fromHere = text.slice(cursor);
    URL_RE.lastIndex = 0;
    const urlMatch = URL_RE.exec(fromHere);
    const urlIndex = urlMatch ? cursor + urlMatch.index : -1;

    let mentionIndex = -1;
    let mentionName = '';
    let atSearch = 0;
    while (atSearch < fromHere.length) {
      const at = fromHere.indexOf('@', atSearch);
      if (at === -1) {
        break;
      }
      const after = fromHere.slice(at + 1);
      const match = names.find(
        (name) => after.toLowerCase().startsWith(name.toLowerCase()) && isNameBoundary(after[name.length])
      );
      if (match) {
        mentionIndex = cursor + at;
        mentionName = match;
        break;
      }
      atSearch = at + 1;
    }

    const nextSpecial =
      urlIndex === -1
        ? mentionIndex
        : mentionIndex === -1
          ? urlIndex
          : Math.min(urlIndex, mentionIndex);

    if (nextSpecial === -1) {
      parts.push({ type: 'text', value: text.slice(cursor) });
      break;
    }

    if (nextSpecial > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, nextSpecial) });
    }

    if (urlIndex !== -1 && urlIndex === nextSpecial && urlMatch) {
      const href = trimUrl(urlMatch[0]);
      parts.push({ type: 'url', href });
      cursor = nextSpecial + href.length;
      continue;
    }

    parts.push({ type: 'mention', username: mentionName });
    cursor = nextSpecial + 1 + mentionName.length;
  }

  return parts;
}

/**
 * Split a message into text, http(s) links, @username mentions, and fenced
 * code blocks. Language tags after ``` are ignored. Unclosed fences take the
 * rest of the message. Mentions and URLs are not parsed inside fences.
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
