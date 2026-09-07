<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import type { Snippet } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { colorClass } from '$lib/ui';
  import { onDestroy, onMount } from 'svelte';

  let {
    user,
    children,
    onResetPassword,
  }: {
    user: PublicUser;
    children: Snippet;
    onResetPassword?: (user: PublicUser) => void;
  } = $props();

  let open = $state(false);
  let canHover = $state(true);
  let nestedAction = $state(false);
  let wrap: HTMLSpanElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tapToOpen = $derived(!canHover && !nestedAction);

  function syncHover(): void {
    canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
  }

  function show(): void {
    if (!canHover) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      open = true;
    }, 220);
  }

  function hide(): void {
    if (!canHover) {
      return;
    }
    clearTimeout(timer);
    open = false;
  }

  function toggleTap(event: MouseEvent): void {
    if (!tapToOpen) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    open = !open;
  }

  function onDocPointer(event: PointerEvent): void {
    if (!tapToOpen || !open || !wrap) {
      return;
    }
    if (event.target instanceof Node && wrap.contains(event.target)) {
      return;
    }
    open = false;
  }

  onMount(() => {
    syncHover();
    nestedAction = Boolean(wrap?.parentElement?.closest('button, a'));
    const media = window.matchMedia('(hover: hover)');
    const onChange = (): void => syncHover();
    media.addEventListener('change', onChange);
    document.addEventListener('pointerdown', onDocPointer);
    return () => {
      media.removeEventListener('change', onChange);
      document.removeEventListener('pointerdown', onDocPointer);
    };
  });

  onDestroy(() => clearTimeout(timer));
</script>

<span
  bind:this={wrap}
  class="hover-wrap"
  role="group"
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {#if tapToOpen}
    <button type="button" class="hover-trigger" aria-expanded={open} aria-haspopup="true" onclick={toggleTap}>
      {@render children()}
    </button>
  {:else}
    {@render children()}
  {/if}
  {#if open}
    <div class="hover-card" role="tooltip">
      <Avatar {user} size="lg" />
      <div class="hover-meta">
        <div class="hover-name {colorClass(user.color)}">{user.username}</div>
        <div class="hover-role">{user.role ?? 'member'}</div>
        {#if onResetPassword && !user.system}
          <button
            type="button"
            class="reset-pw"
            onclick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onResetPassword(user);
            }}
          >
            Reset password
          </button>
        {/if}
      </div>
    </div>
  {/if}
</span>
