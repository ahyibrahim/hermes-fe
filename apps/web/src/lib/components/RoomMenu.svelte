<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import AddMembersPopup from '$lib/components/AddMembersPopup.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import UserChip from '$lib/components/UserChip.svelte';

  let {
    members,
    selfUsername = null,
    canAdd,
    candidates,
    selectedIds,
    isOnline,
    adding,
    showAddPicker,
    canLeave,
    canKick = false,
    canDelete = false,
    leaving,
    deleting = false,
    kickingId = null,
    roomName = '',
    onToggleAdd,
    onToggleInvitee,
    onConfirmAdd,
    onLeave,
    onKick,
    onDelete,
    onResetPassword,
    onSetRole,
  }: {
    members: PublicUser[];
    selfUsername?: string | null;
    canAdd: boolean;
    candidates: PublicUser[];
    selectedIds: number[];
    isOnline: (name: string) => boolean;
    adding: boolean;
    showAddPicker: boolean;
    canLeave: boolean;
    canKick?: boolean;
    canDelete?: boolean;
    leaving: boolean;
    deleting?: boolean;
    kickingId?: number | null;
    roomName?: string;
    onToggleAdd: () => void;
    onToggleInvitee: (id: number) => void;
    onConfirmAdd: () => void;
    onLeave: () => void;
    onKick?: (user: PublicUser) => void;
    onDelete?: () => void;
    onResetPassword?: (user: PublicUser) => void;
    onSetRole?: (user: PublicUser, role: 'member' | 'admin') => void;
  } = $props();

  let confirmLeave = $state(false);
  let confirmKickId = $state<number | null>(null);
  let confirmDelete = $state(false);
  let deleteTyped = $state('');

  const deleteReady = $derived(
    deleteTyped.trim().toLowerCase() === 'delete' ||
      (roomName.trim() !== '' && deleteTyped.trim().toLowerCase() === roomName.trim().toLowerCase())
  );
</script>

<div class="header-menu room-menu" role="dialog" aria-label="Room">
  <ul class="user-list">
    {#each members as person (person.username)}
      <li class="menu-member">
        <span class="status-dot" class:open={isOnline(person.username)}></span>
        <UserChip
          user={person}
          onResetPassword={person.username === selfUsername ? undefined : onResetPassword}
          onSetRole={person.username === selfUsername ? undefined : onSetRole}
        />
        <span class="role-label">{person.role ?? 'member'}</span>
        {#if canKick && onKick && person.username !== selfUsername && !person.system}
          {#if confirmKickId === person.id}
            <div class="menu-confirm-row member-kick">
              <button type="button" class="menu-item" disabled={kickingId != null} onclick={() => (confirmKickId = null)}>
                Cancel
              </button>
              <button
                type="button"
                class="menu-item danger"
                disabled={kickingId === person.id}
                onclick={() => onKick(person)}
              >
                Kick
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="menu-item danger kick-btn"
              disabled={kickingId != null}
              onclick={() => {
                confirmLeave = false;
                confirmDelete = false;
                confirmKickId = person.id;
              }}
            >
              Kick
            </button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  {#if canAdd || canLeave || canDelete}
    <hr class="menu-rule" />
    <div class="menu-actions">
      {#if canAdd}
        <button
          type="button"
          class="menu-item"
          aria-expanded={showAddPicker}
          disabled={adding}
          onclick={() => {
            confirmLeave = false;
            confirmDelete = false;
            confirmKickId = null;
            onToggleAdd();
          }}
        >
          <IconGlyph name="person-plus" />
          Add people
        </button>
        {#if showAddPicker}
          <AddMembersPopup
            nested
            {candidates}
            {selectedIds}
            {isOnline}
            busy={adding}
            onToggle={onToggleInvitee}
            onConfirm={onConfirmAdd}
          />
        {/if}
      {/if}
      {#if canLeave}
        {#if !confirmLeave}
          <button
            type="button"
            class="menu-item"
            disabled={leaving}
            onclick={() => {
              confirmDelete = false;
              confirmKickId = null;
              confirmLeave = true;
            }}
          >
            <IconGlyph name="leave" />
            Leave room
          </button>
        {:else}
          <p class="menu-confirm">Leave this room?</p>
          <div class="menu-confirm-row">
            <button type="button" class="menu-item" disabled={leaving} onclick={() => (confirmLeave = false)}>
              Cancel
            </button>
            <button type="button" class="menu-item danger" disabled={leaving} onclick={onLeave}>Leave</button>
          </div>
        {/if}
      {/if}
      {#if canDelete && onDelete}
        {#if !confirmDelete}
          <button
            type="button"
            class="menu-item danger"
            disabled={deleting}
            onclick={() => {
              confirmLeave = false;
              confirmKickId = null;
              deleteTyped = '';
              confirmDelete = true;
            }}
          >
            Delete room
          </button>
        {:else}
          <p class="menu-confirm">Type Delete or the room name to destroy it for everyone.</p>
          <input
            class="menu-delete-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder={roomName || 'Delete'}
            bind:value={deleteTyped}
            disabled={deleting}
          />
          <div class="menu-confirm-row">
            <button
              type="button"
              class="menu-item"
              disabled={deleting}
              onclick={() => {
                confirmDelete = false;
                deleteTyped = '';
              }}
            >
              Cancel
            </button>
            <button type="button" class="menu-item danger" disabled={deleting || !deleteReady} onclick={onDelete}>
              Delete
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
