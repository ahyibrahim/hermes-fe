<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import AddMembersPopup from '$lib/components/AddMembersPopup.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import UserChip from '$lib/components/UserChip.svelte';

  let {
    members,
    canAdd,
    candidates,
    selectedIds,
    isOnline,
    adding,
    showAddPicker,
    canLeave,
    leaving,
    onToggleAdd,
    onToggleInvitee,
    onConfirmAdd,
    onLeave,
  }: {
    members: PublicUser[];
    canAdd: boolean;
    candidates: PublicUser[];
    selectedIds: number[];
    isOnline: (name: string) => boolean;
    adding: boolean;
    showAddPicker: boolean;
    canLeave: boolean;
    leaving: boolean;
    onToggleAdd: () => void;
    onToggleInvitee: (id: number) => void;
    onConfirmAdd: () => void;
    onLeave: () => void;
  } = $props();

  let confirmLeave = $state(false);
</script>

<div class="header-menu room-menu" role="dialog" aria-label="Room">
  <ul class="user-list">
    {#each members as person (person.username)}
      <li class="menu-member">
        <span class="status-dot" class:open={isOnline(person.username)}></span>
        <UserChip user={person} />
        <span class="role-label">{person.role ?? 'member'}</span>
      </li>
    {/each}
  </ul>
  {#if canAdd || canLeave}
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
            onclick={() => (confirmLeave = true)}
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
    </div>
  {/if}
</div>
