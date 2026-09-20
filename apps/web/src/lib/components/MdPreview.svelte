<script lang="ts">
  import { untrack } from 'svelte';
  import { getSession } from '$lib/client';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import { backdrop, panel } from '$lib/motion';
  import { getCachedMdPreview, loadMdPreview, portal } from '$lib/ui';

  let {
    fileId,
    name,
    onDownload,
  }: {
    fileId: number | string;
    name: string;
    onDownload: () => void;
  } = $props();

  const initialCached = getCachedMdPreview(fileId);
  let html = $state<string | null>(initialCached?.html ?? null);
  let truncated = $state(initialCached?.truncated ?? false);
  let failed = $state(initialCached === null);
  let expanded = $state(false);
  let currentLoadedId = $state<string | null>(initialCached !== undefined ? String(fileId) : null);

  function isMarkdown(mime: string, filename: string): boolean {
    const type = mime.toLowerCase().split(';')[0].trim();
    if (type === 'text/markdown' || type === 'text/x-markdown') {
      return true;
    }
    return /\.(md|markdown)$/i.test(filename);
  }

  function closeExpand(event?: KeyboardEvent): void {
    if (event && event.key !== 'Escape') {
      return;
    }
    expanded = false;
  }

  $effect(() => {
    if (!expanded) {
      return;
    }
    const onKey = (event: KeyboardEvent) => closeExpand(event);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  });

  $effect(() => {
    const id = String(fileId);
    const filename = name;
    if (currentLoadedId === id) {
      return;
    }
    const cached = getCachedMdPreview(id);
    if (cached !== undefined) {
      untrack(() => {
        currentLoadedId = id;
        html = cached?.html ?? null;
        truncated = cached?.truncated ?? false;
        failed = cached === null;
      });
      return;
    }
    untrack(() => {
      currentLoadedId = null;
      html = null;
      truncated = false;
      failed = false;
      expanded = false;
    });
    let cancelled = false;
    void loadMdPreview(getSession(), id, filename)
      .then((res) => {
        if (cancelled) {
          return;
        }
        currentLoadedId = id;
        if (res) {
          html = res.html;
          truncated = res.truncated;
          failed = false;
        } else {
          failed = true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          currentLoadedId = id;
          failed = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if html}
  <button type="button" class="md-preview-frame" onclick={() => (expanded = true)}>
    <div class="md-preview">
      {@html html}
      {#if truncated}
        <p class="md-preview-truncated">Preview truncated — download for the full file.</p>
      {/if}
    </div>
    <span class="visually-hidden">Expand markdown</span>
  </button>
{/if}
<div class="file-row">
  <IconButton label="Download {name}" onclick={onDownload}>
    <IconGlyph name="download" />
  </IconButton>
  {#if html}
    <IconButton label="Expand {name}" title="Expand" onclick={() => (expanded = true)}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          d="M3 6.5V3.5h3M13 9.5v3h-3M3.5 3.5 6.5 6.5M12.5 12.5 9.5 9.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </IconButton>
  {/if}
  {#if !html || failed}
    <span class="file-name">{name}</span>
  {/if}
</div>

{#if expanded && html}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="md-expand-backdrop"
    role="presentation"
    use:portal
    transition:backdrop
    onclick={() => (expanded = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="md-expand-panel"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      transition:panel
      onclick={(event) => event.stopPropagation()}
    >
      <header class="md-expand-header">
        <span class="md-expand-name">{name}</span>
        <div class="md-expand-actions">
          <IconButton label="Download {name}" onclick={onDownload}>
            <IconGlyph name="download" />
          </IconButton>
          <IconButton label="Close" title="Close" onclick={() => (expanded = false)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </IconButton>
        </div>
      </header>
      <div class="md-expand-body md-preview">
        {@html html}
        {#if truncated}
          <p class="md-preview-truncated">Preview truncated — download for the full file.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
