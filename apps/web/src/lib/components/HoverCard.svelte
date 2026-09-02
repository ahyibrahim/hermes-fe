<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import type { Snippet } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { colorClass } from '$lib/ui';

  let {
    user,
    children,
  }: {
    user: PublicUser;
    children: Snippet;
  } = $props();

  let open = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show(): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      open = true;
    }, 220);
  }

  function hide(): void {
    clearTimeout(timer);
    open = false;
  }
</script>

<span class="hover-wrap" role="group" onmouseenter={show} onmouseleave={hide} onfocusin={show} onfocusout={hide}>
  {@render children()}
  {#if open}
    <div class="hover-card" role="tooltip">
      <Avatar {user} size="lg" />
      <div class="hover-meta">
        <div class="hover-name {colorClass(user.color)}">{user.username}</div>
        <div class="hover-role">{user.role ?? 'member'}</div>
      </div>
    </div>
  {/if}
</span>
