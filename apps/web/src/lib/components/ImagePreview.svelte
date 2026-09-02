<script lang="ts">
  import { untrack } from 'svelte';
  import { getSession } from '$lib/client';

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

  $effect(() => {
    const id = String(fileId);
    const filename = name;
    untrack(() => {
      previewUrl = null;
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
  <img class="img-preview" src={previewUrl} alt={name} />
{/if}
<button type="button" class="file-action" onclick={onDownload}>Download {name}</button>
