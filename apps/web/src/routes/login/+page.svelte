<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthBrand from '$lib/components/AuthBrand.svelte';
  import AuthForm from '$lib/components/AuthForm.svelte';
  import { getSession } from '$lib/client';
  import { onMount } from 'svelte';

  let checking = $state(true);
  let resetMode = $state(false);
  let resetUsername = $state('');
  let resetToken = $state('');
  let resetPassword = $state('');
  let resetError = $state('');
  let resetBusy = $state(false);

  onMount(async () => {
    if (await getSession().resume()) {
      await goto('/');
      return;
    }
    checking = false;
  });

  async function onSubmit(username: string, password: string): Promise<void> {
    const session = getSession();
    await session.login(username, password);
    try {
      await session.connect();
    } catch {
      // REST still works; ChatShell shows connection status.
    }
    await goto('/');
  }

  async function onRedeem(event: Event): Promise<void> {
    event.preventDefault();
    resetError = '';
    if (!resetUsername.trim() || !resetToken.trim() || !resetPassword) {
      resetError = 'Username, token, and new password are required.';
      return;
    }
    resetBusy = true;
    try {
      const session = getSession();
      await session.redeemPasswordReset(resetUsername.trim(), resetToken.trim(), resetPassword);
      try {
        await session.connect();
      } catch {
        // REST still works.
      }
      await goto('/');
    } catch (error) {
      resetError = error instanceof Error ? error.message : String(error);
    } finally {
      resetBusy = false;
    }
  }
</script>

{#if checking}
  <p class="boot">Loading…</p>
{:else if resetMode}
  <div class="auth-page">
    <AuthBrand />
    <form class="auth-card" onsubmit={onRedeem}>
      <h1>Reset password</h1>
      <p class="lede">Paste the token an admin issued.</p>
      {#if resetError}
        <p class="error">{resetError}</p>
      {/if}
      <label for="reset-username">Username</label>
      <input id="reset-username" bind:value={resetUsername} autocomplete="username" autocapitalize="none" />
      <label for="reset-token">Reset token</label>
      <input id="reset-token" bind:value={resetToken} autocomplete="one-time-code" />
      <label for="reset-password">New password</label>
      <input id="reset-password" type="password" bind:value={resetPassword} autocomplete="new-password" />
      <button type="submit" disabled={resetBusy}>{resetBusy ? 'Please wait…' : 'Set password and sign in'}</button>
      <p class="alt"><button type="button" class="linkish" onclick={() => (resetMode = false)}>Back to sign in</button></p>
    </form>
  </div>
{:else}
  <AuthForm title="Sign in" submitLabel="Sign in" altHref="/register" altLabel="Create an account" onSubmit={onSubmit}>
    <p class="auth-extra">
      <button type="button" class="linkish" onclick={() => (resetMode = true)}>I have a reset token.</button>
    </p>
  </AuthForm>
{/if}
