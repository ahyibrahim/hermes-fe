<script lang="ts">
  import type { ConnectionStatus } from '@hermes/core';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
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
  <hr class="menu-rule" />
  <a class="menu-item" href="/profile">
    <IconGlyph name="profile" />
    Profile
  </a>
  <button type="button" class="menu-item" aria-pressed={notifyOn} title={notifyLabel} onclick={onNotify}>
    <IconGlyph name={notifyOn ? 'bell' : 'bell-off'} />
    {notifyLabel}
  </button>
  <p class="menu-status status {status}">
    <span class="status-dot"></span>
    {statusLabel}
  </p>
  <button type="button" class="menu-item danger" onclick={onSignOut}>Sign out</button>
</div>
