import { render } from '@testing-library/svelte';
import { expect, test } from 'vitest';
import MessageBody from './MessageBody.svelte';

test('renders bullet and numbered lists and strikethrough', () => {
  const { container } = render(MessageBody, {
    content: 'plan:\n- ~~old~~ new\n- **two**\n3. three\n4. four\ndone',
    users: [],
  });

  const bullets = container.querySelector('ul.msg-list');
  expect([...(bullets?.children ?? [])].map((child) => child.tagName)).toEqual(['LI', 'LI']);
  expect(bullets?.querySelector('li s')?.textContent).toBe('old');
  expect(bullets?.querySelector('li strong')?.textContent).toBe('two');
  // Whitespace text nodes inside a list would show as blank lines under pre-wrap.
  const TEXT_NODE = 3;
  const stray = [...(bullets?.childNodes ?? [])].filter((node) => node.nodeType === TEXT_NODE && node.textContent);
  expect(stray.map((node) => node.textContent)).toEqual([]);

  const numbered = container.querySelector('ol.msg-list');
  expect(numbered?.getAttribute('start')).toBe('3');
  expect([...(numbered?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(['three', 'four']);

  expect(container.textContent).toContain('plan:');
  expect(container.textContent).toContain('done');
});
