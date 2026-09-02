<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { USER_COLOR_PALETTE } from '@hermes/core';
  import { goto } from '$app/navigation';
  import AvatarCrop from '$lib/components/AvatarCrop.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import { forgetAvatar } from '$lib/ui';
  import { getSession } from '$lib/client';
  import { onMount } from 'svelte';

  let checking = $state(true);
  let profile = $state<PublicUser | null>(null);
  let currentPassword = $state('');
  let nextPassword = $state('');
  let confirmPassword = $state('');
  let passwordBusy = $state(false);
  let passwordError = $state('');
  let passwordOk = $state('');
  let avatarBusy = $state(false);
  let avatarError = $state('');
  let colorError = $state('');
  let colorBusy = $state(false);
  let cropFile = $state<File | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  const session = getSession();

  async function loadProfile(): Promise<boolean> {
    if (!(await session.resume()) && !session.getState().token) {
      return false;
    }
    const me = await session.getMe();
    if (!me) {
      return false;
    }
    profile = me;
    return true;
  }

  onMount(async () => {
    try {
      if (!(await loadProfile())) {
        await goto('/login');
        return;
      }
    } catch {
      await goto('/login');
      return;
    }
    checking = false;
  });

  async function onChangePassword(event: Event): Promise<void> {
    event.preventDefault();
    passwordError = '';
    passwordOk = '';
    if (!nextPassword.trim()) {
      passwordError = 'New password is required.';
      return;
    }
    if (nextPassword !== confirmPassword) {
      passwordError = 'New passwords do not match.';
      return;
    }

    passwordBusy = true;
    try {
      await session.changePassword(currentPassword, nextPassword);
      currentPassword = '';
      nextPassword = '';
      confirmPassword = '';
      passwordOk = 'Password updated.';
    } catch (error) {
      passwordError = error instanceof Error ? error.message : String(error);
    } finally {
      passwordBusy = false;
    }
  }

  function onAvatarPicked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    avatarError = '';
    cropFile = file;
  }

  async function onCropped(blob: Blob): Promise<void> {
    cropFile = null;
    if (!profile) {
      return;
    }
    avatarBusy = true;
    try {
      const updated = await session.uploadAvatar(blob, 'avatar.png');
      forgetAvatar(updated.id);
      profile = updated;
    } catch (error) {
      avatarError = error instanceof Error ? error.message : String(error);
    } finally {
      avatarBusy = false;
    }
  }

  async function onPickColor(color: string): Promise<void> {
    colorError = '';
    colorBusy = true;
    try {
      profile = await session.setColor(color);
    } catch (error) {
      colorError = error instanceof Error ? error.message : String(error);
    } finally {
      colorBusy = false;
    }
  }
</script>

{#if checking}
  <p class="boot">Loading…</p>
{:else if profile}
  <div class="auth-page">
    <form class="auth-card profile-card" onsubmit={onChangePassword}>
      <p class="alt back"><a href="/">Back to chat</a></p>
      <h1>Profile</h1>
      <p class="lede">Your login name stays as-is. Roles are labels for now.</p>

      <div class="avatar-block">
        <Avatar user={profile} size="lg" />
        <div>
          <button type="button" class="secondary" disabled={avatarBusy} onclick={() => fileInput?.click()}>
            {avatarBusy ? 'Uploading…' : 'Change avatar'}
          </button>
          <input
            type="file"
            hidden
            bind:this={fileInput}
            accept="image/png,image/jpeg,image/webp,image/gif"
            onchange={onAvatarPicked}
          />
        </div>
      </div>
      {#if avatarError}
        <p class="error">{avatarError}</p>
      {/if}

      <p class="lede color-label">Username color</p>
      <div class="color-swatches">
        {#each USER_COLOR_PALETTE as color (color)}
          <button
            type="button"
            class="swatch user-color-{color}"
            class:selected={profile.color === color}
            disabled={colorBusy}
            title={color}
            onclick={() => onPickColor(color)}
          >
            {color}
          </button>
        {/each}
      </div>
      {#if colorError}
        <p class="error">{colorError}</p>
      {/if}

      <label for="profile-username">Username</label>
      <input id="profile-username" value={profile.username} readonly />

      <label for="profile-role">Role</label>
      <input id="profile-role" value={profile.role ?? 'member'} readonly />

      <h2>Password</h2>
      {#if passwordError}
        <p class="error">{passwordError}</p>
      {/if}
      {#if passwordOk}
        <p class="ok">{passwordOk}</p>
      {/if}
      <label for="current-password">Current password</label>
      <input
        id="current-password"
        type="password"
        autocomplete="current-password"
        bind:value={currentPassword}
        disabled={passwordBusy}
      />
      <label for="new-password">New password</label>
      <input
        id="new-password"
        type="password"
        autocomplete="new-password"
        bind:value={nextPassword}
        disabled={passwordBusy}
      />
      <label for="confirm-password">Confirm new password</label>
      <input
        id="confirm-password"
        type="password"
        autocomplete="new-password"
        bind:value={confirmPassword}
        disabled={passwordBusy}
      />
      <button type="submit" disabled={passwordBusy}>{passwordBusy ? 'Please wait…' : 'Update password'}</button>
    </form>
  </div>
{/if}

{#if cropFile}
  <AvatarCrop file={cropFile} onCancel={() => (cropFile = null)} onCrop={onCropped} />
{/if}
