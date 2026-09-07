<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import UserChip from '$lib/components/UserChip.svelte';

  let {
    user,
    online = false,
    selected = false,
    disabled = false,
    onToggle,
  }: {
    user: PublicUser;
    online?: boolean;
    selected?: boolean;
    disabled?: boolean;
    onToggle: () => void;
  } = $props();
</script>

<label class="user-row">
  <input type="checkbox" checked={selected} {disabled} onchange={onToggle} />
  <span class="status-dot" class:open={online}></span>
  <UserChip {user} />
  <span class="role-label">{user.role ?? 'member'}</span>
</label>
