<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { goto, onNavigate } from '$app/navigation';
  import { getSession } from '$lib/client';
  import '../app.css';

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    return getSession().on('authExpired', () => {
      void goto('/login');
    });
  });

  onNavigate((navigation) => {
    if (!document.startViewTransition) return;

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });
</script>

<svelte:head>
  <title>Hermes</title>
</svelte:head>

{@render children()}
