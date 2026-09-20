<script lang="ts">
  import type { LinkPreview } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { soft } from '$lib/motion';
  import { getCachedLinkPreview, loadLinkPreview } from '$lib/ui';
  import { untrack } from 'svelte';

  let { url }: { url: string } = $props();

  const initialCached = getCachedLinkPreview(url);
  let preview = $state<LinkPreview | null>(initialCached ?? null);
  let loading = $state(initialCached === undefined);
  let imageFailed = $state(false);
  let faviconFailed = $state(false);
  let imageReady = $state(false);

  const hasCard = $derived(
    Boolean(preview && (preview.title || preview.description || preview.image))
  );

  $effect(() => {
    const target = url;
    const cached = getCachedLinkPreview(target);
    untrack(() => {
      if (cached !== undefined) {
        preview = cached;
        loading = false;
      } else {
        preview = null;
        loading = true;
      }
      imageFailed = false;
      faviconFailed = false;
      imageReady = false;
    });
    let cancelled = false;
    void loadLinkPreview(getSession(), target)
      .then((result) => {
        if (!cancelled) {
          preview = result;
          loading = false;
        }
      })
      .catch(() => {
        if (!cancelled) {
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if loading}
  <div class="link-preview-card link-preview-skeleton" aria-hidden="true" transition:soft>
    <div class="link-preview-skel-image settle-shimmer"></div>
    <span class="link-preview-meta">
      <span class="settle-line settle-line-sm settle-shimmer"></span>
      <span class="settle-line settle-line-md settle-shimmer"></span>
      <span class="settle-line settle-line-lg settle-shimmer"></span>
    </span>
  </div>
{:else if hasCard && preview}
  <a
    class="link-preview-card"
    href={preview.url || url}
    target="_blank"
    rel="noreferrer noopener"
    transition:soft
  >
    {#if preview.image && !imageFailed}
      <span class="link-preview-image-slot">
        <span class="link-preview-skel-image settle-shimmer" class:hidden={imageReady}></span>
        <img
          class="link-preview-image"
          class:settled={imageReady}
          src={preview.image}
          alt=""
          loading="lazy"
          onload={() => (imageReady = true)}
          onerror={() => (imageFailed = true)}
        />
      </span>
    {/if}
    <span class="link-preview-meta">
      {#if preview.site || preview.favicon}
        <span class="link-preview-site-row">
          {#if preview.favicon && !faviconFailed}
            <img
              class="link-preview-favicon"
              src={preview.favicon}
              alt=""
              width="14"
              height="14"
              loading="lazy"
              onerror={() => (faviconFailed = true)}
            />
          {/if}
          {#if preview.site}
            <span class="link-preview-site">{preview.site}</span>
          {/if}
        </span>
      {/if}
      {#if preview.title}
        <span class="link-preview-title">{preview.title}</span>
      {/if}
      {#if preview.description}
        <span class="link-preview-desc">{preview.description}</span>
      {/if}
    </span>
  </a>
{/if}
