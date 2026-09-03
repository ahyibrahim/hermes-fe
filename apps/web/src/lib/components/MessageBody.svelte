<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { parseMessageBody } from '@hermes/core';
  import HoverCard from '$lib/components/HoverCard.svelte';

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

  async function copyFence(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt('Copy code', value);
    }
  }
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
        <button type="button" class="fence-copy" onclick={() => copyFence(part.value)}>Copy</button>
        <pre class="fence"><code>{part.value}</code></pre>
      </div>
    {/if}
  {/each}
</span>
