<script lang="ts">
  import { untrack } from 'svelte';
  import { getSession } from '$lib/client';
  import IconButton from '$lib/components/IconButton.svelte';
  import IconGlyph from '$lib/components/IconGlyph.svelte';

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
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    const id = String(fileId);
    const filename = name;
    untrack(() => {
      previewUrl = null;
      expanded = false;
    });
    let objectUrl: string | null = null;
    let cancelled = false;
    void getSession()
      .fetchFile(id)
      .then(({ bytes, mime }) => {
        const type = imageMime(mime, filename);
        if (cancelled || !type) {
          return;
        }
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objectUrl = URL.createObjectURL(new Blob([copy], { type }));
        previewUrl = objectUrl;
      })
      .catch(() => {
        // Keep the Download control when the preview cannot load.
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  });
</script>

{#if previewUrl}
  <button type="button" class="img-preview-frame" onclick={() => (expanded = true)}>
    <img class="img-preview" src={previewUrl} alt={name} />
    <span class="visually-hidden">Expand image</span>
  </button>
{/if}
<div class="file-row">
  <IconButton label="Download {name}" onclick={onDownload}>
    <IconGlyph name="download" />
  </IconButton>
  {#if !previewUrl}
    <span class="file-name">{name}</span>
  {/if}
</div>

{#if expanded && previewUrl}
  <button type="button" class="call-share-expand" aria-label="Close image" onclick={() => (expanded = false)}>
    <img src={previewUrl} alt={name} />
  </button>
{/if}
