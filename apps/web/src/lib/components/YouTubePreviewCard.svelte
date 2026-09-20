<script lang="ts">
  import type { LinkPreview } from '@hermes/core';
  import { parseYouTubeVideoId } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { soft } from '$lib/motion';
  import { getCachedLinkPreview, loadLinkPreview } from '$lib/ui';
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

  const initialCached = getCachedLinkPreview(url);
  let preview = $state<LinkPreview | null>(initialCached ?? null);
  let metaLoading = $state(initialCached === undefined);
  let thumbFailed = $state(false);
  let thumbReady = $state(false);
  let currentLoadedUrl = $state<string | null>(initialCached !== undefined ? url : null);

  function checkImgReady(node: HTMLImageElement) {
    if (node.complete && node.naturalWidth > 0) {
      thumbReady = true;
    }
  }

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
    if (currentLoadedUrl === target) {
      return;
    }
    const cached = getCachedLinkPreview(target);
    if (cached !== undefined) {
      untrack(() => {
        currentLoadedUrl = target;
        preview = cached;
        metaLoading = false;
      });
      return;
    }
    untrack(() => {
      currentLoadedUrl = null;
      preview = null;
      metaLoading = true;
      thumbFailed = false;
      thumbReady = false;
    });
    let cancelled = false;
    void loadLinkPreview(getSession(), target)
      .then((result) => {
        if (!cancelled) {
          currentLoadedUrl = target;
          preview = result;
          metaLoading = false;
        }
      })
      .catch(() => {
        if (!cancelled) {
          currentLoadedUrl = target;
          metaLoading = false;
        }
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
        <span class="yt-preview-skel settle-shimmer" class:hidden={thumbReady}></span>
        <img
          class="yt-preview-thumb"
          class:settled={thumbReady}
          src={thumbUrl}
          alt=""
          loading="lazy"
          use:checkImgReady
          onload={() => (thumbReady = true)}
          onerror={() => (thumbFailed = true)}
        />
        {#if durationLabel}
          <span class="yt-preview-duration" transition:soft>{durationLabel}</span>
        {/if}
      </button>
    {:else}
      <a class="yt-preview-thumb-wrap" href={url} target="_blank" rel="noreferrer noopener">
        <span class="yt-preview-skel settle-shimmer" class:hidden={thumbReady}></span>
        <img
          class="yt-preview-thumb"
          class:settled={thumbReady}
          src={thumbUrl}
          alt=""
          loading="lazy"
          use:checkImgReady
          onload={() => (thumbReady = true)}
          onerror={() => (thumbFailed = true)}
        />
        {#if durationLabel}
          <span class="yt-preview-duration" transition:soft>{durationLabel}</span>
        {/if}
      </a>
    {/if}
    <span class="yt-preview-meta">
      <span class="yt-preview-site">YouTube</span>
      {#if onWatchTogether}
        <button
          type="button"
          class="yt-preview-title"
          class:yt-preview-title-pending={metaLoading && !title}
          title="Watch together"
          onclick={startWatch}
        >
          {title ?? 'YouTube video'}
        </button>
      {:else}
        <a
          class="yt-preview-title"
          class:yt-preview-title-pending={metaLoading && !title}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
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
            transition:soft
          >
            {author}
          </a>
        {:else}
          <span class="yt-preview-author" transition:soft>{author}</span>
        {/if}
      {:else if metaLoading}
        <span class="settle-line settle-line-sm settle-shimmer" aria-hidden="true"></span>
      {/if}
    </span>
  </div>
{/if}
