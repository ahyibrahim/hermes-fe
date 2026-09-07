<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import Avatar from '$lib/components/Avatar.svelte';
  import HoverCard from '$lib/components/HoverCard.svelte';
  import { colorClass } from '$lib/ui';

  let {
    user,
    showName = true,
    showAvatar = true,
    size = 'sm',
    online = false,
    onResetPassword,
  }: {
    user: PublicUser;
    showName?: boolean;
    showAvatar?: boolean;
    size?: 'sm' | 'md' | 'lg';
    online?: boolean;
    onResetPassword?: (user: PublicUser) => void;
  } = $props();
</script>

<HoverCard {user} {onResetPassword}>
  <span class="user-chip">
    {#if showAvatar}
      <Avatar {user} {size} {online} />
    {/if}
    {#if showName}
      <span class="chip-name {colorClass(user.color)}">{user.username}</span>
    {/if}
  </span>
</HoverCard>
