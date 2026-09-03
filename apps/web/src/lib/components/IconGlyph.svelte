<script lang="ts">
  let {
    name,
    size = 14,
  }: {
    name:
      | 'attach'
      | 'send'
      | 'call'
      | 'jump'
      | 'download'
      | 'bell'
      | 'bell-off'
      | 'mic'
      | 'mic-off'
      | 'hangup'
      | 'plus';
    size?: number;
  } = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  {#if name === 'attach'}
    <path
      d="M10.2 4.2 5.4 9a2.4 2.4 0 1 0 3.4 3.4l5.1-5.1a3.6 3.6 0 0 0-5.1-5.1L3.6 7.4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'send'}
    <path
      d="M2.4 8 13.6 2.8 8.8 13.6 7.4 8.6Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M7.4 8.6 13.6 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  {:else if name === 'call'}
    <path
      d="M3.2 2.8h2.6l1 2.4-1.5 1.1a8 8 0 0 0 4.4 4.4l1.1-1.5 2.4 1v2.6A1.2 1.2 0 0 1 12 14.2 10.4 10.4 0 0 1 1.8 4a1.2 1.2 0 0 1 1.4-1.2Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  {:else if name === 'jump'}
    <path
      d="M8 2.6v9.2M4.4 8.4 8 12.2l3.6-3.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'download'}
    <path
      d="M8 2.6v7.6M5 7.8 8 10.8 11 7.8M3.2 13.4h9.6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'bell'}
    <path
      d="M8 2.4a3.4 3.4 0 0 1 3.4 3.4v2.4l1.2 1.8H3.4L4.6 8.2V5.8A3.4 3.4 0 0 1 8 2.4Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M6.4 13.2a1.6 1.6 0 0 0 3.2 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  {:else if name === 'mic'}
    <path
      d="M8 2.6a2.1 2.1 0 0 1 2.1 2.1v3.2A2.1 2.1 0 0 1 8 10 2.1 2.1 0 0 1 5.9 7.9V4.7A2.1 2.1 0 0 1 8 2.6Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
    />
    <path
      d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v1.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  {:else if name === 'mic-off'}
    <path
      d="M8 2.6a2.1 2.1 0 0 1 2.1 2.1v3.2A2.1 2.1 0 0 1 8 10 2.1 2.1 0 0 1 5.9 7.9V4.7A2.1 2.1 0 0 1 8 2.6Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
    />
    <path
      d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v1.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <path d="M3.2 3.2 12.8 12.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {:else if name === 'hangup'}
    <path
      d="M3.2 10.2c2.6-2.2 7-2.2 9.6 0l-1.6 1.6c-1.8-1.1-4.6-1.1-6.4 0Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  {:else if name === 'plus'}
    <path
      d="M8 3.2v9.6M3.2 8h9.6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  {:else}
    <path
      d="M8 2.4a3.4 3.4 0 0 1 3.4 3.4v2.4l1.2 1.8H3.4L4.6 8.2V5.8A3.4 3.4 0 0 1 8 2.4Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path d="M6.4 13.2a1.6 1.6 0 0 0 3.2 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <path d="M3.2 3.2 12.8 12.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {/if}
</svg>
