<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import UserRow from '$lib/components/UserRow.svelte';

  let {
    candidates,
    selectedIds,
    isOnline,
    busy,
    onToggle,
    onConfirm,
  }: {
    candidates: PublicUser[];
    selectedIds: number[];
    isOnline: (name: string) => boolean;
    busy: boolean;
    onToggle: (id: number) => void;
    onConfirm: () => void;
  } = $props();
</script>

<div class="add-popup" role="dialog" aria-label="Add people">
  <ul class="user-list">
    {#each candidates as person (person.id)}
      <li>
        <UserRow
          user={person}
          online={isOnline(person.username)}
          selected={selectedIds.includes(person.id)}
          disabled={busy}
          onToggle={() => onToggle(person.id)}
        />
      </li>
    {/each}
  </ul>
  <button
    type="button"
    class="add-popup-confirm"
    disabled={busy || selectedIds.length === 0}
    onclick={onConfirm}
  >
    Add
  </button>
</div>
