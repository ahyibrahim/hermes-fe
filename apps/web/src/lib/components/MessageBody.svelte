<script lang="ts">
  import type { PublicUser } from '@hermes/core';
  import { isYouTubeUrl, parseMessageBody } from '@hermes/core';
  import HoverCard from '$lib/components/HoverCard.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import LinkPreviewCard from '$lib/components/LinkPreviewCard.svelte';
  import YouTubePreviewCard from '$lib/components/YouTubePreviewCard.svelte';
  import { onDestroy } from 'svelte';

  let {
    content,
    users,
    onWatchTogether,
  }: {
    content: string;
    users: PublicUser[];
    onWatchTogether?: (url: string) => void;
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
    } catch {
      window.prompt('Copy code', value);
      return;
    }
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedIndex = null;
    }, 1500);
  }

  onDestroy(() => clearTimeout(copiedTimer));
</script>

<span class="msg-body">
  {#each parts as part, index (index)}
    {#if part.type === 'text'}
      {part.value}
    {:else if part.type === 'url'}
      {#if onWatchTogether && isYouTubeUrl(part.value)}
        <span class="watch-link-block">
          <a href={part.value} target="_blank" rel="noreferrer noopener">{part.value}</a>
          <YouTubePreviewCard url={part.value} {onWatchTogether} />
          <span class="watch-actions">
            <button
              type="button"
              class="watch-together-cta"
              title="Watch together"
              onclick={() => onWatchTogether(part.value)}
            >
              <IconGlyph name="watch" size={13} />
              <span>Watch together</span>
            </button>
            <a
              class="watch-visit-link"
              href={part.value}
              target="_blank"
              rel="noreferrer noopener"
              title="Visit link"
              aria-label="Visit link"
            >
              <IconGlyph name="external-link" size={13} />
            </a>
          </span>
        </span>
      {:else}
        <span class="url-block">
          <a href={part.value} target="_blank" rel="noreferrer noopener">{part.value}</a>
          <LinkPreviewCard url={part.value} />
        </span>
      {/if}
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
        <div class="fence-header">
          {#if part.lang}
            <span class="fence-lang">{part.lang}</span>
          {:else}
            <span class="fence-lang fence-lang-empty"></span>
          {/if}
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
        </div>
        <pre class="fence"><code>{part.value}</code></pre>
      </div>
    {/if}
  {/each}
</span>
