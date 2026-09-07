<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import Avatar from '$lib/components/Avatar.svelte';
  import HoverCard from '$lib/components/HoverCard.svelte';

  const CAP = 5;

  let {
    names,
    directory,
  }: {
    names: string[];
    directory: PublicUser[];
  } = $props();

  function resolve(name: string): PublicUser {
    return directory.find((person) => person.username === name) ?? { id: 0, username: name };
  }

  const faces = $derived(names.slice(0, CAP).map(resolve));
  const extra = $derived(Math.max(0, names.length - CAP));
  const extraTitle = $derived(names.slice(CAP).join(', '));
</script>

{#if faces.length > 0}
  <div class="member-stack" aria-label="Who can see this room">
    {#each faces as person, index (person.username)}
      <span class="stack-face" style="z-index: {index + 1}">
        <HoverCard user={person}>
          <Avatar user={person} size="sm" />
        </HoverCard>
      </span>
    {/each}
    {#if extra > 0}
      <span class="stack-more" title={extraTitle}>+{extra}</span>
    {/if}
  </div>
{/if}
