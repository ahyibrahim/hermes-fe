<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { colorClass, loadAvatarUrl } from '$lib/ui';

  let {
    user,
    size = 'sm',
    online = false,
  }: {
    user: PublicUser;
    size?: 'sm' | 'md' | 'lg';
    online?: boolean;
  } = $props();

  let url = $state<string | null>(null);
  let faceReady = $state(false);

  $effect(() => {
    const current = user;
    let cancelled = false;
    url = null;
    faceReady = false;
    void loadAvatarUrl(getSession(), current).then((next) => {
      if (!cancelled) {
        url = next;
        if (!next) {
          faceReady = false;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const initial = $derived((user.username?.slice(0, 1) || '?').toUpperCase());
</script>

<span class="avatar-wrap" class:online>
  <span class="avatar-face placeholder {size} {colorClass(user.color)}" aria-hidden="true">{initial}</span>
  {#if url}
    <img
      class="avatar-face avatar-face-img {size} {colorClass(user.color)}"
      class:settled={faceReady}
      src={url}
      alt=""
      onload={() => (faceReady = true)}
    />
  {/if}
  {#if online}
    <span class="presence-badge" aria-label="online"></span>
  {/if}
</span>
