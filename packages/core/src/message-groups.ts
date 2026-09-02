export const MESSAGE_BUBBLE_GAP_MS = 3 * 60 * 1000;

export interface MessageBubbleGroup<T> {
  messages: T[];
  showName: boolean;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTranscriptTimestamp(
  value: string,
  now: Date = new Date(),
  locale?: string
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  if (sameLocalDay(date, now)) {
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function groupConsecutiveBySender<T extends { sender: string; created_at: string }>(
  messages: readonly T[],
  gapMs = MESSAGE_BUBBLE_GAP_MS
): MessageBubbleGroup<T>[] {
  const groups: MessageBubbleGroup<T>[] = [];
  for (const message of messages) {
    const current = groups.at(-1);
    const last = current?.messages.at(-1);
    if (current && last && last.sender === message.sender) {
      const delta = Math.abs(timestampMs(message.created_at) - timestampMs(last.created_at));
      if (delta <= gapMs) {
        current.messages.push(message);
        continue;
      }
      groups.push({ messages: [message], showName: false });
      continue;
    }
    groups.push({ messages: [message], showName: true });
  }
  return groups;
}
