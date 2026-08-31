<script lang="ts">
  import { goto } from '$app/navigation';
  import AuthForm from '$lib/components/AuthForm.svelte';
  import { getSession } from '$lib/client';
  import { onMount } from 'svelte';

  let checking = $state(true);

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
</script>

{#if checking}
  <p class="boot">Loading…</p>
{:else}
  <AuthForm
    title="Sign in"
    lede="Hermes"
    submitLabel="Sign in"
    altHref="/register"
    altLabel="Create an account"
    onSubmit={onSubmit}
  />
{/if}
