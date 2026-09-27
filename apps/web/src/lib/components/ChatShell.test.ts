import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';
import ChatShell from './ChatShell.svelte';
import { bootWorld, type TestWorld } from '../../test/harness';
import { setPhoneViewport } from '../../test/viewport';

let world: TestWorld | null = null;

afterEach(async () => {
  await world?.close();
  world = null;
});

function roomsRail(): HTMLElement {
  const rail = document.querySelector<HTMLElement>('.rooms-rail');
  if (!rail) {
    throw new Error('rooms rail is not rendered');
  }
  return rail;
}

function roomButton(label: string): HTMLButtonElement | null {
  const buttons = roomsRail().querySelectorAll<HTMLButtonElement>('.room-list button');
  return [...buttons].find((button) => button.querySelector('.room-label')?.textContent === label) ?? null;
}

function unreadBadge(label: string): string | null {
  return roomButton(label)?.querySelector('.unread')?.textContent ?? null;
}

function transcriptText(): string {
  return document.querySelector('.messages')?.textContent ?? '';
}

async function mountShell(): Promise<void> {
  render(ChatShell);
  await waitFor(() => expect(roomButton('#General')?.classList.contains('active')).toBe(true));
  await waitFor(() => expect(world?.me.getConnectionStatus()).toBe('open'));
}

async function openGroup(owner: string, name: string, memberNames: string[]): Promise<string> {
  if (!world) {
    throw new Error('no world');
  }
  const ids = await Promise.all(memberNames.map((member) => world!.userId(member)));
  const room = await world.others.get(owner)!.createRoom(name, ids);
  return room.slug;
}

describe('ChatShell', () => {
  test('a DM from a room not yet on the rail appears live with an unread badge', async () => {
    world = await bootWorld('alice', ['bob']);
    await mountShell();
    expect(roomButton('@bob')).toBeNull();

    const bob = world.others.get('bob')!;
    const dm = await bob.createDm(await world.userId('alice'));
    await bob.enterRoom(dm.slug);
    await bob.sendMessage('psst');

    await waitFor(() => expect(unreadBadge('@bob')).toBe('1'));
    expect(roomButton('#General')?.classList.contains('active')).toBe(true);
  });

  test('unread counts up for a background room and clears when entered', async () => {
    world = await bootWorld('alice', ['bob']);
    await mountShell();

    const slug = await openGroup('bob', 'side', ['alice']);
    await waitFor(() => expect(roomButton('#side')).not.toBeNull());

    const bob = world.others.get('bob')!;
    await bob.enterRoom(slug);
    await bob.sendMessage('one');
    await waitFor(() => expect(unreadBadge('#side')).toBe('1'));
    await bob.sendMessage('two');
    await waitFor(() => expect(unreadBadge('#side')).toBe('2'));

    await fireEvent.click(roomButton('#side')!);
    await waitFor(() => expect(roomButton('#side')?.classList.contains('active')).toBe(true));
    await waitFor(() => expect(transcriptText()).toContain('two'));
    expect(unreadBadge('#side')).toBeNull();
  });

  test('a message sent while room history is loading stays in the transcript', async () => {
    world = await bootWorld('alice', ['bob']);
    await mountShell();

    const slug = await openGroup('bob', 'side', ['alice']);
    const bob = world.others.get('bob')!;
    await bob.enterRoom(slug);
    await bob.sendMessage('before switch');
    await waitFor(() => expect(roomButton('#side')).not.toBeNull());

    world.backend.holdMessageLists();
    await fireEvent.click(roomButton('#side')!);
    await waitFor(() => expect(world!.backend.messageListHolds).toBeGreaterThanOrEqual(1));
    await bob.sendMessage('during load');
    world.backend.resumeMessageLists();

    await waitFor(() => {
      expect(transcriptText()).toContain('before switch');
      expect(transcriptText()).toContain('during load');
    });
  });

  test('on a phone, the collapsed rail opens as a drawer and the backdrop closes it', async () => {
    setPhoneViewport(true);
    world = await bootWorld('alice');
    render(ChatShell);

    const shell = await waitFor(() => {
      const node = document.querySelector('.shell');
      expect(node?.classList.contains('phone')).toBe(true);
      return node as HTMLElement;
    });
    // Entering the first room collapses phone rails; let that finish before tapping.
    await waitFor(() => expect(world?.me.getState().room).toBe('general'));
    expect(shell.classList.contains('rooms-collapsed')).toBe(true);
    expect(shell.classList.contains('people-collapsed')).toBe(true);
    expect(document.querySelector('.rail-drawer-backdrop')).toBeNull();

    const expand = within(roomsRail()).getByRole('button', { name: 'Expand rooms' });
    await fireEvent.click(expand);
    await waitFor(() => expect(shell.classList.contains('rooms-collapsed')).toBe(false));
    expect(within(roomsRail()).getByRole('button', { name: 'Collapse rooms' }).getAttribute('aria-expanded')).toBe(
      'true'
    );

    const backdrop = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('.rail-drawer-backdrop');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    await fireEvent.click(backdrop);
    await waitFor(() => expect(shell.classList.contains('rooms-collapsed')).toBe(true));
    expect(screen.getAllByRole('button', { name: 'Expand rooms' })).toHaveLength(1);
  });

  test('widening past the phone breakpoint slides an open drawer shut before rejoining the grid', async () => {
    setPhoneViewport(true);
    world = await bootWorld('alice');
    render(ChatShell);
    await waitFor(() => expect(world?.me.getState().room).toBe('general'));
    const shell = document.querySelector('.shell') as HTMLElement;

    await fireEvent.click(within(roomsRail()).getByRole('button', { name: 'Expand rooms' }));
    await waitFor(() => expect(shell.classList.contains('rooms-collapsed')).toBe(false));

    setPhoneViewport(false);
    await waitFor(() => expect(shell.classList.contains('rooms-collapsed')).toBe(true));
    expect(shell.classList.contains('phone'), 'the drawer closes while still floating').toBe(true);

    await waitFor(() => expect(shell.classList.contains('phone')).toBe(false));
    expect(shell.classList.contains('rooms-collapsed'), 'desktop rails come back as saved').toBe(false);
    expect(shell.classList.contains('people-collapsed')).toBe(false);
  });
});
