<script lang="ts">
  import type { ConnectionStatus } from '@hermes/core';
  import { colorClass } from '$lib/ui';

  let {
    username,
    color,
    status,
    statusLabel,
    notifyOn,
    notifyLabel,
    onNotify,
    onSignOut,
  }: {
    username: string;
    color?: string | null;
    status: ConnectionStatus;
    statusLabel: string;
    notifyOn: boolean;
    notifyLabel: string;
    onNotify: () => void;
    onSignOut: () => void;
  } = $props();
</script>

<div class="header-menu user-menu" role="dialog" aria-label="Account">
  <p class="menu-who {colorClass(color)}">{username}</p>
  <a class="menu-item" href="/profile">Profile</a>
  <button type="button" class="menu-item" aria-pressed={notifyOn} onclick={onNotify}>
    {notifyLabel}
  </button>
  <p class="menu-status status {status}">
    <span class="status-dot"></span>
    {statusLabel}
  </p>
  <button type="button" class="menu-item danger" onclick={onSignOut}>Sign out</button>
</div>
