<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import type { Snippet } from 'svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { popup } from '$lib/motion';
  import { colorClass, portal } from '$lib/ui';
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
  let cardEl: HTMLDivElement | undefined = $state();
  let cardTop = $state(0);
  let cardLeft = $state(0);
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const tapToOpen = $derived(!canHover && !nestedAction);
  const showAdminActions = $derived(Boolean((onResetPassword || onSetRole) && !user.system));

  function updatePosition(): void {
    if (!wrap || typeof window === 'undefined') {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    const cardWidth = 230;
    const cardHeight = 110;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + cardHeight > window.innerHeight && rect.top - cardHeight - 4 > 0) {
      top = rect.top - cardHeight - 4;
    }
    if (left + cardWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - cardWidth - 8);
    }
    if (left < 8) {
      left = 8;
    }
    cardTop = top;
    cardLeft = left;
  }

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
      updatePosition();
      open = true;
    }, 220);
  }

  function hide(delayMs = 180): void {
    if (!canHover) {
      return;
    }
    clearTimers();
    showTimer = undefined;
    hideTimer = setTimeout(() => {
      open = false;
    }, delayMs);
  }

  function cancelHide(): void {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  function stillInside(next: EventTarget | null): boolean {
    return Boolean(next instanceof Node && (wrap?.contains(next) || cardEl?.contains(next)));
  }

  function toggleTap(event: MouseEvent): void {
    if (!tapToOpen) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!open) {
      updatePosition();
      open = true;
    } else {
      open = false;
    }
  }

  function onDocPointer(event: PointerEvent): void {
    if (!tapToOpen || !open) {
      return;
    }
    if (event.target instanceof Node && (wrap?.contains(event.target) || cardEl?.contains(event.target))) {
      return;
    }
    open = false;
  }

  onMount(() => {
    syncHover();
    nestedAction = Boolean(wrap?.parentElement?.closest('button, a'));
    const media = window.matchMedia('(hover: hover)');
    const onChange = (): void => syncHover();
    const onScrollOrResize = (): void => {
      if (open) {
        updatePosition();
      }
    };
    media.addEventListener('change', onChange);
    document.addEventListener('pointerdown', onDocPointer);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      media.removeEventListener('change', onChange);
      document.removeEventListener('pointerdown', onDocPointer);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
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
    <div
      bind:this={cardEl}
      class="hover-card"
      style="top: {cardTop}px; left: {cardLeft}px;"
      role="tooltip"
      use:portal
      transition:popup
      onmouseenter={() => {
        cancelHide();
      }}
      onmouseleave={() => hide()}
      onclick={(event) => event.stopPropagation()}
    >
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
