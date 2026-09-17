<script lang="ts">
  import type { LinkPreview } from '@hermes/core';
  import { parseYouTubeVideoId } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { untrack } from 'svelte';

  let {
    url,
    onWatchTogether,
  }: {
    url: string;
    onWatchTogether?: (url: string) => void;
  } = $props();

  const videoId = $derived(parseYouTubeVideoId(url));
  const thumbUrl = $derived(
    videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null
  );

  let preview = $state<LinkPreview | null>(null);
  let thumbFailed = $state(false);

  function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  const title = $derived(preview?.title ?? null);
  const author = $derived(preview?.author ?? preview?.description ?? null);
  const authorUrl = $derived(preview?.authorUrl ?? null);
  const durationLabel = $derived(
    preview?.durationSeconds != null && preview.durationSeconds > 0
      ? formatDuration(preview.durationSeconds)
      : null
  );

  function startWatch(): void {
    onWatchTogether?.(url);
  }

  $effect(() => {
    const target = url;
    untrack(() => {
      preview = null;
      thumbFailed = false;
    });
    let cancelled = false;
    void getSession()
      .getLinkPreview(target)
      .then((result) => {
        if (!cancelled) {
          preview = result;
        }
      })
      .catch(() => {
        // Thumbnail still shows without metadata.
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if videoId && thumbUrl && !thumbFailed}
  <div class="yt-preview-card">
    {#if onWatchTogether}
      <button
        type="button"
        class="yt-preview-thumb-wrap"
        title="Watch together"
        onclick={startWatch}
      >
        <img
          class="yt-preview-thumb"
          src={thumbUrl}
          alt=""
          loading="lazy"
          onerror={() => (thumbFailed = true)}
        />
        {#if durationLabel}
          <span class="yt-preview-duration">{durationLabel}</span>
        {/if}
      </button>
    {:else}
      <a class="yt-preview-thumb-wrap" href={url} target="_blank" rel="noreferrer noopener">
        <img
          class="yt-preview-thumb"
          src={thumbUrl}
          alt=""
          loading="lazy"
          onerror={() => (thumbFailed = true)}
        />
        {#if durationLabel}
          <span class="yt-preview-duration">{durationLabel}</span>
        {/if}
      </a>
    {/if}
    <span class="yt-preview-meta">
      <span class="yt-preview-site">YouTube</span>
      {#if onWatchTogether}
        <button type="button" class="yt-preview-title" title="Watch together" onclick={startWatch}>
          {title ?? 'YouTube video'}
        </button>
      {:else}
        <a class="yt-preview-title" href={url} target="_blank" rel="noreferrer noopener">
          {title ?? 'YouTube video'}
        </a>
      {/if}
      {#if author}
        {#if authorUrl}
          <a
            class="yt-preview-author"
            href={authorUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {author}
          </a>
        {:else}
          <span class="yt-preview-author">{author}</span>
        {/if}
      {/if}
    </span>
  </div>
{/if}
