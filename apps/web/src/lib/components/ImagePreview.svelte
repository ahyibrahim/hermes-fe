<script lang="ts">
  import { untrack } from 'svelte';
  import { getSession } from '$lib/client';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';
  import { backdrop, soft } from '$lib/motion';
  import { portal } from '$lib/ui';

  let {
    fileId,
    name,
    onDownload,
  }: {
    fileId: number | string;
    name: string;
    onDownload: () => void;
  } = $props();

  let previewUrl = $state<string | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let imageReady = $state(false);
  let expanded = $state(false);

  function imageMime(mime: string, filename: string): string | null {
    const type = mime.toLowerCase().split(';')[0].trim();
    if (type.startsWith('image/') && type !== 'image/svg+xml') {
      return type;
    }
    const match = filename.toLowerCase().match(/\.(png|jpe?g|gif|webp|bmp)$/);
    if (!match) {
      return null;
    }
    if (match[1] === 'jpg' || match[1] === 'jpeg') {
      return 'image/jpeg';
    }
    return `image/${match[1]}`;
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
    untrack(() => {
      previewUrl = null;
      loading = true;
      failed = false;
      imageReady = false;
      expanded = false;
    });
    let objectUrl: string | null = null;
    let cancelled = false;
    void getSession()
      .fetchFile(id)
      .then(({ bytes, mime }) => {
        const type = imageMime(mime, filename);
        if (cancelled) {
          return;
        }
        if (!type) {
          loading = false;
          failed = true;
          return;
        }
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objectUrl = URL.createObjectURL(new Blob([copy], { type }));
        previewUrl = objectUrl;
        loading = false;
      })
      .catch(() => {
        if (!cancelled) {
          loading = false;
          failed = true;
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  });
</script>

{#if loading}
  <div class="img-preview-skel settle-shimmer" aria-hidden="true"></div>
{:else if previewUrl}
  <button
    type="button"
    class="img-preview-frame"
    transition:soft
    onclick={() => (expanded = true)}
  >
    <span class="img-preview-slot" class:loading={!imageReady}>
      <span class="img-preview-skel settle-shimmer" aria-hidden="true"></span>
      <img
        class="img-preview"
        class:settled={imageReady}
        src={previewUrl}
        alt={name}
        onload={() => (imageReady = true)}
      />
    </span>
    <span class="visually-hidden">Expand image</span>
  </button>
{/if}
<div class="file-row">
  <IconButton label="Download {name}" onclick={onDownload}>
    <IconGlyph name="download" />
  </IconButton>
  {#if !previewUrl || failed}
    <span class="file-name">{name}</span>
  {/if}
</div>

{#if expanded && previewUrl}
  <button
    type="button"
    class="call-share-expand"
    aria-label="Close image"
    use:portal
    transition:backdrop
    onclick={() => (expanded = false)}
  >
    <img src={previewUrl} alt={name} />
  </button>
{/if}
