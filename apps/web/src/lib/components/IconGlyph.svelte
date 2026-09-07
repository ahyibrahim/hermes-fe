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
      | 'mic-pick'
      | 'hangup'
      | 'plus'
      | 'person-plus'
      | 'profile'
      | 'leave'
      | 'share'
      | 'share-off'
      | 'cog'
      | 'chevron-left'
      | 'chevron-right'
      | 'chevron-down'
      | 'chevron-up'
      | 'close';
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
    <g transform="translate(-1.15 1.25)">
      <path
        d="M2.4 8 13.6 2.8 8.8 13.6 7.4 8.6Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path d="M7.4 8.6 13.6 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </g>
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
  {:else if name === 'mic-pick'}
    <path
      d="M6.4 2.4a1.7 1.7 0 0 1 1.7 1.7v2.6A1.7 1.7 0 0 1 6.4 8.4 1.7 1.7 0 0 1 4.7 6.7V4.1A1.7 1.7 0 0 1 6.4 2.4Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
    />
    <path
      d="M3.2 6.5a3.2 3.2 0 0 0 6.4 0M6.4 9.8v1.4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
    />
    <path
      d="M10.2 10.2 12.2 12.2 14.2 10.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'hangup'}
    <!-- Same handset family as Join call, rotated into the hung-up pose. -->
    <g transform="translate(8 8) rotate(135) translate(-8 -8)">
      <path
        d="M3.2 2.8h2.6l1 2.4-1.5 1.1a8 8 0 0 0 4.4 4.4l1.1-1.5 2.4 1v2.6A1.2 1.2 0 0 1 12 14.2 10.4 10.4 0 0 1 1.8 4a1.2 1.2 0 0 1 1.4-1.2Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </g>
  {:else if name === 'share'}
    <rect x="2.4" y="3.2" width="11.2" height="7.4" rx="1.1" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path d="M6.2 13h3.6M8 10.6V13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  {:else if name === 'share-off'}
    <rect x="2.4" y="3.2" width="11.2" height="7.4" rx="1.1" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path d="M6.2 13h3.6M8 10.6V13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    <path d="M3.2 3.2 12.8 12.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {:else if name === 'cog'}
    <path
      d="M8.75 2.15h-1.5l-.22 1.4a3.9 3.9 0 0 0-1.2.66L4.5 3.6 3.45 4.65l.62 1.3a3.9 3.9 0 0 0-.66 1.2L2.15 7.25v1.5l1.4.22c.12.43.34.83.66 1.2l-.62 1.3L4.5 12.4l1.33-.61c.37.3.77.54 1.2.66l.22 1.4h1.5l.22-1.4c.43-.12.83-.35 1.2-.66l1.33.61 1.05-1.05-.62-1.3c.3-.37.54-.77.66-1.2l1.4-.22v-1.5l-1.4-.22a3.9 3.9 0 0 0-.66-1.2l.62-1.3L11.5 3.6l-1.33.61a3.9 3.9 0 0 0-1.2-.66L8.75 2.15Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linejoin="round"
    />
    <circle cx="8" cy="8" r="1.85" fill="none" stroke="currentColor" stroke-width="1.3" />
  {:else if name === 'plus'}
    <path
      d="M8 3.2v9.6M3.2 8h9.6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  {:else if name === 'profile'}
    <circle cx="8" cy="5.2" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path
      d="M3.4 13.2c0-2.4 2-4 4.6-4s4.6 1.6 4.6 4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  {:else if name === 'person-plus'}
    <circle cx="6" cy="5" r="2.1" fill="none" stroke="currentColor" stroke-width="1.4" />
    <path
      d="M2.6 13.2c0-2.1 1.5-3.5 3.4-3.5s3.4 1.4 3.4 3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
    <path
      d="M12.2 5.6v5.2M9.6 8.2h5.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  {:else if name === 'leave'}
    <path
      d="M3 3.2h6.2v9.6H3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
    <path
      d="M7.4 8h6M11.2 5.8 13.6 8l-2.4 2.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'chevron-left'}
    <path
      d="M10.2 3.2 5.4 8l4.8 4.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'chevron-right'}
    <path
      d="M5.8 3.2 10.6 8 5.8 12.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'chevron-down'}
    <path
      d="M3.2 5.8 8 10.6l4.8-4.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'chevron-up'}
    <path
      d="M3.2 10.2 8 5.4l4.8 4.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'close'}
    <path
      d="M4 4 12 12M12 4 4 12"
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
