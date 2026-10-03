<script lang="ts">
  import type { PublicUser, RoomRecord } from '@hermes/core';
  import { roleAtLeast } from '@hermes/core';
  import Avatar from '$lib/components/Avatar.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import UserChip from '$lib/components/UserChip.svelte';
  import { soft } from '$lib/motion';
  import { formatUnread } from '$lib/ui';

  type Props = {
    rail: 'rooms' | 'people';
    roomsCollapsed: boolean;
    peopleCollapsed: boolean;
    groupRooms: RoomRecord[];
    dmRooms: RoomRecord[];
    people: PublicUser[];
    currentRoom: string | null;
    activeDmPeer: string | null;
    username: string | null;
    me: PublicUser | null;
    creatingRoom: boolean;
    showCreateRoom: boolean;
    newRoomName: string;
    leaving: boolean;
    onSetCollapsed: (rail: 'rooms' | 'people', value: boolean) => void;
    onSelectRoom: (slug: string) => void | Promise<void>;
    onHideSlug: (slug: string) => void | Promise<void>;
    onCreateGroup: () => void | Promise<void>;
    onStartDm: (person: PublicUser) => void | Promise<void>;
    onResetPassword?: (user: PublicUser) => void | Promise<void>;
    onSetRole?: (user: PublicUser, role: 'member' | 'admin') => void | Promise<void>;
    onNewRoomNameChange: (name: string) => void;
    onToggleShowCreateRoom: (show: boolean) => void;
    lookupUser: (name: string) => PublicUser | undefined;
    isOnline: (name: string) => boolean;
    roomTitle: (room: RoomRecord | undefined) => string;
    previewLine: (room: RoomRecord) => string;
  };

  let {
    rail,
    roomsCollapsed,
    peopleCollapsed,
    groupRooms,
    dmRooms,
    people,
    currentRoom,
    activeDmPeer,
    username,
    me,
    creatingRoom,
    showCreateRoom,
    newRoomName,
    leaving,
    onSetCollapsed,
    onSelectRoom,
    onHideSlug,
    onCreateGroup,
    onStartDm,
    onResetPassword,
    onSetRole,
    onNewRoomNameChange,
    onToggleShowCreateRoom,
    lookupUser,
    isOnline,
    roomTitle,
    previewLine,
  }: Props = $props();
</script>

{#if rail === 'rooms'}
  <aside class="rail rooms-rail">
    <div class="rail-heading">
      <button
        type="button"
        class="rail-toggle"
        aria-label={roomsCollapsed ? 'Expand rooms' : 'Collapse rooms'}
        aria-expanded={!roomsCollapsed}
        onclick={() => onSetCollapsed('rooms', !roomsCollapsed)}
      >
        <IconGlyph name={roomsCollapsed ? 'chevron-right' : 'chevron-left'} />
      </button>
      {#if !roomsCollapsed}
        <span transition:soft>rooms</span>
      {/if}
    </div>
    {#if !roomsCollapsed}
      <div class="rail-body" transition:soft>
        {#if groupRooms.length === 0}
          <p class="empty-hint">No rooms yet.</p>
        {:else}
          <ul class="room-list">
            {#each groupRooms as room (room.id)}
              <li>
                <button
                  type="button"
                  class:active={room.slug === currentRoom}
                  onclick={() => onSelectRoom(room.slug)}
                >
                  <span class="room-copy">
                    <span class="room-label"><span class="hash">#</span>{roomTitle(room)}</span>
                    {#if previewLine(room)}
                      <span class="room-preview">{previewLine(room)}</span>
                    {/if}
                  </span>
                  {#if formatUnread(room.unread_count)}
                    <span class="unread">{formatUnread(room.unread_count)}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="rail-heading sub">Direct messages</div>
        {#if dmRooms.length === 0}
          <p class="empty-hint">No DMs yet.</p>
        {:else}
          <ul class="room-list">
            {#each dmRooms as room (room.id)}
              {@const peer = lookupUser(roomTitle(room))}
              <li class="dm-row">
                <button
                  type="button"
                  class:active={room.slug === currentRoom}
                  onclick={() => onSelectRoom(room.slug)}
                >
                  {#if peer}
                    <Avatar user={peer} size="sm" online={isOnline(peer.username)} />
                  {/if}
                  <span class="room-copy">
                    <span class="room-label"><span class="hash">@</span>{roomTitle(room)}</span>
                    {#if previewLine(room)}
                      <span class="room-preview">{previewLine(room)}</span>
                    {/if}
                  </span>
                  {#if formatUnread(room.unread_count)}
                    <span class="unread">{formatUnread(room.unread_count)}</span>
                  {/if}
                </button>
                <button
                  type="button"
                  class="row-x"
                  title="Close DM"
                  aria-label="Close DM"
                  disabled={leaving}
                  onclick={() => onHideSlug(room.slug)}
                >
                  <IconGlyph name="close" size={12} />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if showCreateRoom}
          <form
            class="new-room"
            onsubmit={(event) => {
              event.preventDefault();
              void onCreateGroup();
            }}
          >
            <div class="new-room-row">
              <input
                type="text"
                placeholder="New room"
                value={newRoomName}
                oninput={(e) => onNewRoomNameChange((e.currentTarget as HTMLInputElement).value)}
                disabled={creatingRoom}
                maxlength="80"
                aria-label="Room name"
              />
              <IconButton
                type="submit"
                label="Create room"
                tone="accent"
                disabled={creatingRoom || !newRoomName.trim()}
                busy={creatingRoom}
              >
                <IconGlyph name="plus" />
              </IconButton>
              <IconButton
                label="Cancel"
                disabled={creatingRoom}
                onclick={() => onToggleShowCreateRoom(false)}
              >
                <IconGlyph name="close" />
              </IconButton>
            </div>
          </form>
        {:else}
          <button type="button" class="new-room-open" onclick={() => onToggleShowCreateRoom(true)}>
            <IconGlyph name="plus" />
            New room
          </button>
        {/if}
      </div>
    {/if}
  </aside>
{:else}
  <aside class="rail people">
    <div class="rail-heading">
      {#if !peopleCollapsed}
        <span transition:soft>people</span>
      {/if}
      <button
        type="button"
        class="rail-toggle"
        aria-label={peopleCollapsed ? 'Expand people' : 'Collapse people'}
        aria-expanded={!peopleCollapsed}
        onclick={() => onSetCollapsed('people', !peopleCollapsed)}
      >
        <IconGlyph name={peopleCollapsed ? 'chevron-left' : 'chevron-right'} />
      </button>
    </div>
    {#if !peopleCollapsed}
      <div class="rail-body" transition:soft>
        {#if people.length === 0}
          <p class="empty-hint">Nobody here yet.</p>
        {:else}
          <ul class="people-list">
            {#each people as person (person.id)}
              {@const activeDm = activeDmPeer === person.username}
              <li>
                {#if person.username === username}
                  <span class="self">
                    <UserChip
                      user={person}
                      online={isOnline(person.username)}
                      onResetPassword={roleAtLeast(me?.role, 'admin') ? onResetPassword : undefined}
                      onSetRole={roleAtLeast(me?.role, 'admin') ? onSetRole : undefined}
                      actorRole={me?.role ?? null}
                    />
                    <span class="role-label">{person.role ?? 'member'}</span>
                    <span class="you">you</span>
                  </span>
                {:else}
                  <div
                    class="person-row"
                    class:active={activeDm}
                    role="button"
                    tabindex="0"
                    onclick={() => void onStartDm(person)}
                    onkeydown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void onStartDm(person);
                      }
                    }}
                  >
                    <UserChip
                      user={person}
                      online={isOnline(person.username)}
                      onResetPassword={roleAtLeast(me?.role, 'admin') ? onResetPassword : undefined}
                      onSetRole={roleAtLeast(me?.role, 'admin') ? onSetRole : undefined}
                      actorRole={me?.role ?? null}
                    />
                    <span class="role-label">{person.role ?? 'member'}</span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </aside>
{/if}
