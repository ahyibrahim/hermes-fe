<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { parseMessageBody } from '@hermes/core';
  import HoverCard from '$lib/components/HoverCard.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import { onDestroy } from 'svelte';

  let {
    content,
    users,
  }: {
    content: string;
    users: PublicUser[];
  } = $props();

  const parts = $derived(parseMessageBody(content, users.map((user) => user.username)));

  function lookup(name: string): PublicUser | undefined {
    const lower = name.toLowerCase();
    return users.find((user) => user.username.toLowerCase() === lower);
  }

  let copiedIndex = $state<number | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyFence(index: number, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copiedIndex = index;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedIndex = null;
      }, 1500);
    } catch {
      window.prompt('Copy code', value);
    }
  }

  onDestroy(() => clearTimeout(copiedTimer));
</script>

<span class="msg-body">
  {#each parts as part, index (index)}
    {#if part.type === 'text'}
      {part.value}
    {:else if part.type === 'mention'}
      {#if lookup(part.username)}
        <HoverCard user={lookup(part.username) as PublicUser}>
          <span class="mention">@{part.username}</span>
        </HoverCard>
      {:else}
        @{part.username}
      {/if}
    {:else if part.type === 'inline_code'}
      <code class="inline-code">{part.value}</code>
    {:else if part.type === 'bold'}
      <strong>{part.value}</strong>
    {:else if part.type === 'italic'}
      <em>{part.value}</em>
    {:else if part.type === 'code'}
      <div class="fence-wrap">
        <span class="fence-copy">
          <IconButton
            label={copiedIndex === index ? 'Copied' : 'Copy code'}
            title={copiedIndex === index ? 'Copied' : 'Copy code'}
            onclick={() => copyFence(index, part.value)}
          >
            {#if copiedIndex === index}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3.5 8.4 6.6 11.5 12.5 4.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <rect
                  x="5.2"
                  y="3.4"
                  width="7.4"
                  height="9.4"
                  rx="1.2"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                />
                <path
                  d="M3.6 11.2V4.4A1.2 1.2 0 0 1 4.8 3.2h5.6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
            {/if}
          </IconButton>
        </span>
        <pre class="fence"><code>{part.value}</code></pre>
      </div>
    {/if}
  {/each}
</span>
