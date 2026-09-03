<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    title = label,
    disabled = false,
    type = 'button',
    tone = 'ghost',
    pressed,
    onclick,
    children,
  }: {
    label: string;
    title?: string;
    disabled?: boolean;
    type?: 'button' | 'submit';
    tone?: 'ghost' | 'accent' | 'danger';
    pressed?: boolean;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button
  {type}
  class="icon-btn tone-{tone}"
  aria-label={label}
  {title}
  {disabled}
  aria-pressed={pressed}
  {onclick}
>
  {@render children()}
</button>
