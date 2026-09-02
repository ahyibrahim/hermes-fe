<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { colorClass, loadAvatarUrl } from '$lib/ui';

  let {
    user,
    size = 'sm',
  }: {
    user: PublicUser;
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    const current = user;
    let cancelled = false;
    url = null;
    void loadAvatarUrl(getSession(), current).then((next) => {
      if (!cancelled) {
        url = next;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const initial = $derived((user.username?.slice(0, 1) || '?').toUpperCase());
</script>

{#if url}
  <img class="avatar-face {size} {colorClass(user.color)}" src={url} alt="" />
{:else}
  <span class="avatar-face placeholder {size} {colorClass(user.color)}" aria-hidden="true">{initial}</span>
{/if}
