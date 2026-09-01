<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { goto } from '$app/navigation';
  import { getSession } from '$lib/client';
  import { onDestroy, onMount } from 'svelte';

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
  let avatarUrl = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  const session = getSession();

  function revokePreview(): void {
    if (avatarUrl) {
      URL.revokeObjectURL(avatarUrl);
      avatarUrl = null;
    }
  }

  async function loadAvatar(user: PublicUser): Promise<void> {
    revokePreview();
    if (!user.avatar_file_id) {
      return;
    }
    try {
      const bytes = await session.fetchAvatar(user.id);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      avatarUrl = URL.createObjectURL(new Blob([copy]));
    } catch (error) {
      avatarError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadProfile(): Promise<boolean> {
    if (!(await session.resume()) && !session.getState().token) {
      return false;
    }
    const me = await session.getMe();
    if (!me) {
      return false;
    }
    profile = me;
    await loadAvatar(me);
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

  onDestroy(() => {
    revokePreview();
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

  async function onAvatarPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    avatarError = '';
    avatarBusy = true;
    try {
      const updated = await session.uploadAvatar(file, file.name);
      profile = updated;
      await loadAvatar(updated);
    } catch (error) {
      avatarError = error instanceof Error ? error.message : String(error);
    } finally {
      avatarBusy = false;
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
        {#if avatarUrl}
          <img class="avatar" src={avatarUrl} alt="" />
        {:else}
          <div class="avatar placeholder" aria-hidden="true">{profile.username.slice(0, 1)}</div>
        {/if}
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
