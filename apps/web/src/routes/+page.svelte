<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import ChatShell from '$lib/components/ChatShell.svelte';
  import { getSession } from '$lib/client';

  let booting = $state(true);
  let ready = $state(false);

  onMount(async () => {
    const ok = await getSession().resume();
    if (!ok) {
      await goto('/login');
      return;
    }
    ready = true;
    booting = false;
  });
</script>

{#if booting}
  <p class="boot">Loading…</p>
{:else if ready}
  <ChatShell />
{/if}
