<script lang="ts">
  import type { LinkPreview } from '@hermes/core';
  import { getSession } from '$lib/client';
  import { untrack } from 'svelte';

  let { url }: { url: string } = $props();

  let preview = $state<LinkPreview | null>(null);
  let imageFailed = $state(false);
  let faviconFailed = $state(false);

  $effect(() => {
    const target = url;
    untrack(() => {
      preview = null;
      imageFailed = false;
      faviconFailed = false;
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
        // Fail soft — keep the bare link.
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if preview && (preview.title || preview.description || preview.image)}
  <a class="link-preview-card" href={preview.url || url} target="_blank" rel="noreferrer noopener">
    {#if preview.image && !imageFailed}
      <img
        class="link-preview-image"
        src={preview.image}
        alt=""
        loading="lazy"
        onerror={() => (imageFailed = true)}
      />
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
