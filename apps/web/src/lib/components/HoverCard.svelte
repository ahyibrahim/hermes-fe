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
    onSetRole,
  }: {
    user: PublicUser;
    children: Snippet;
    onResetPassword?: (user: PublicUser) => void;
    onSetRole?: (user: PublicUser, role: 'member' | 'admin') => void;
  } = $props();

  let open = $state(false);
  let canHover = $state(true);
  let nestedAction = $state(false);
  let wrap: HTMLSpanElement | undefined = $state();
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const tapToOpen = $derived(!canHover && !nestedAction);
  const showAdminActions = $derived(Boolean((onResetPassword || onSetRole) && !user.system));

  function clearTimers(): void {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  }

  function syncHover(): void {
    canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;
  }

  function show(): void {
    if (!canHover) {
      return;
    }
    clearTimers();
    showTimer = setTimeout(() => {
      open = true;
    }, 220);
  }

  function hide(delayMs = 180): void {
    if (!canHover) {
      return;
    }
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      open = false;
    }, delayMs);
  }

  function cancelHide(): void {
    clearTimeout(hideTimer);
  }

  function stillInside(next: EventTarget | null): boolean {
    return Boolean(next instanceof Node && wrap?.contains(next));
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

  onDestroy(() => clearTimers());
</script>

<span
  bind:this={wrap}
  class="hover-wrap"
  role="group"
  onmouseenter={() => {
    cancelHide();
    show();
  }}
  onmouseleave={() => hide()}
  onfocusin={() => {
    cancelHide();
    show();
  }}
  onfocusout={(event) => {
    if (stillInside(event.relatedTarget)) {
      return;
    }
    hide();
  }}
>
  {#if tapToOpen}
    <button type="button" class="hover-trigger" aria-expanded={open} aria-haspopup="true" onclick={toggleTap}>
      {@render children()}
    </button>
  {:else}
    {@render children()}
  {/if}
  {#if open}
    <!-- stop row-level DM click when interacting with the card -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="hover-card" role="tooltip" onclick={(event) => event.stopPropagation()}>
      <div class="hover-card-inner">
        <Avatar {user} size="lg" />
        <div class="hover-meta">
          <div class="hover-name {colorClass(user.color)}">{user.username}</div>
          <div class="hover-role">{user.role ?? 'member'}</div>
          {#if showAdminActions}
            {#if onSetRole}
              {#if (user.role ?? 'member') === 'admin'}
                <button
                  type="button"
                  class="reset-pw"
                  onclick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSetRole(user, 'member');
                  }}
                >
                  Demote to member
                </button>
              {:else}
                <button
                  type="button"
                  class="reset-pw"
                  onclick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSetRole(user, 'admin');
                  }}
                >
                  Promote to admin
                </button>
              {/if}
            {/if}
            {#if onResetPassword}
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
          {/if}
        </div>
      </div>
    </div>
  {/if}
</span>
