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
</script>

<span class="msg-body">
  {#each parts as part, index (index)}
    {#if part.type === 'text'}
      {part.value}
    {:else if part.type === 'url'}
      <a href={part.href} target="_blank" rel="noreferrer noopener">{part.href}</a>
    {:else if part.type === 'mention'}
      {#if lookup(part.username)}
        <HoverCard user={lookup(part.username) as PublicUser}>
          <span class="mention">@{part.username}</span>
        </HoverCard>
      {:else}
        @{part.username}
      {/if}
    {:else if part.type === 'code'}
      <pre class="fence"><code>{part.value}</code></pre>
    {/if}
  {/each}
</span>
