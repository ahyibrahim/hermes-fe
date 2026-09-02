<script lang="ts">
  import { onMount } from 'svelte';

  let {
    file,
    onCancel,
    onCrop,
  }: {
    file: File;
    onCancel: () => void;
    onCrop: (blob: Blob) => void;
  } = $props();

  const VIEW = 256;
  const OUT = 256;

  let canvas: HTMLCanvasElement | undefined = $state();
  let zoom = $state(1);
  let ready = $state(false);
  let image: HTMLImageElement | null = null;
  let ox = 0;
  let oy = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const minZoom = $derived.by(() => {
    ready;
    if (!image) {
      return 1;
    }
    const cover = VIEW / Math.min(image.naturalWidth, image.naturalHeight);
    const contain = VIEW / Math.max(image.naturalWidth, image.naturalHeight);
    return contain / cover;
  });

  function sizeAt(z: number): { w: number; h: number } {
    if (!image) {
      return { w: VIEW, h: VIEW };
    }
    const cover = VIEW / Math.min(image.naturalWidth, image.naturalHeight);
    const scale = cover * z;
    return { w: image.naturalWidth * scale, h: image.naturalHeight * scale };
  }

  function clampAxis(pos: number, drawn: number): number {
    if (drawn <= VIEW) {
      return Math.min(VIEW - drawn, Math.max(0, pos));
    }
    return Math.min(0, Math.max(VIEW - drawn, pos));
  }

  function clampOffsets(): void {
    const { w, h } = sizeAt(zoom);
    ox = clampAxis(ox, w);
    oy = clampAxis(oy, h);
  }

  function paint(): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !image) {
      return;
    }
    clampOffsets();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, VIEW, VIEW);
    const { w, h } = sizeAt(zoom);
    ctx.drawImage(image, ox, oy, w, h);
  }

  function center(): void {
    const { w, h } = sizeAt(zoom);
    ox = (VIEW - w) / 2;
    oy = (VIEW - h) / 2;
    paint();
  }

  function canvasScale(): { sx: number; sy: number } {
    const rect = canvas?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { sx: 1, sy: 1 };
    }
    return { sx: VIEW / rect.width, sy: VIEW / rect.height };
  }

  function setZoom(next: number): void {
    const z = Math.min(3, Math.max(minZoom, next));
    const prev = sizeAt(zoom);
    const cx = prev.w === 0 ? 0.5 : (VIEW / 2 - ox) / prev.w;
    const cy = prev.h === 0 ? 0.5 : (VIEW / 2 - oy) / prev.h;
    zoom = z;
    const { w, h } = sizeAt(zoom);
    ox = VIEW / 2 - cx * w;
    oy = VIEW / 2 - cy * h;
    paint();
  }

  function onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    const target = event.currentTarget as HTMLCanvasElement;
    target.classList.add('dragging');
    target.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) {
      return;
    }
    const { sx, sy } = canvasScale();
    ox += (event.clientX - lastX) * sx;
    oy += (event.clientY - lastY) * sy;
    lastX = event.clientX;
    lastY = event.clientY;
    paint();
  }

  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    const target = event.currentTarget as HTMLCanvasElement;
    target.classList.remove('dragging');
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  function confirm(): void {
    if (!image) {
      return;
    }
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext('2d');
    if (!ctx) {
      return;
    }
    const { w, h } = sizeAt(zoom);
    ctx.drawImage(image, ox, oy, w, h);
    out.toBlob(
      (blob) => {
        if (blob) {
          onCrop(blob);
        }
      },
      'image/png',
      0.92
    );
  }

  onMount(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      image = img;
      ready = true;
      zoom = 1;
      center();
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  });
</script>

<div class="crop-modal">
  <div class="crop-card">
    <h2>Crop avatar</h2>
    <p class="lede">Drag to pan. Zoom out to see the whole photo, then frame the square.</p>
    <canvas
      bind:this={canvas}
      width={VIEW}
      height={VIEW}
      class="crop-canvas"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    ></canvas>
    <label class="crop-zoom">
      Zoom
      <input
        type="range"
        min={minZoom}
        max="3"
        step="0.05"
        value={zoom}
        oninput={(event) => setZoom(Number((event.currentTarget as HTMLInputElement).value))}
      />
    </label>
    <div class="crop-actions">
      <button type="button" class="secondary" onclick={onCancel}>Cancel</button>
      <button type="button" onclick={confirm} disabled={!ready}>Upload crop</button>
    </div>
  </div>
</div>
