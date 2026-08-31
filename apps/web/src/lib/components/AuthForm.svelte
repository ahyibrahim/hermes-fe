<script lang="ts">
  let {
    title,
    lede,
    submitLabel,
    altHref,
    altLabel,
    passwordAutocomplete = 'current-password',
    onSubmit,
  }: {
    title: string;
    lede: string;
    submitLabel: string;
    altHref: string;
    altLabel: string;
    passwordAutocomplete?: 'current-password' | 'new-password';
    onSubmit: (username: string, password: string) => Promise<void>;
  } = $props();

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
    error = '';
    const name = username.trim();
    if (!name || !password) {
      error = 'Username and password are required.';
      return;
    }

    busy = true;
    try {
      await onSubmit(name, password);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="auth-page">
  <form class="auth-card" onsubmit={handleSubmit}>
    <h1>{title}</h1>
    <p class="lede">{lede}</p>
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <label for="username">Username</label>
    <input
      id="username"
      name="username"
      autocomplete="username"
      autocapitalize="none"
      spellcheck="false"
      bind:value={username}
      disabled={busy}
    />
    <label for="password">Password</label>
    <input
      id="password"
      name="password"
      type="password"
      autocomplete={passwordAutocomplete}
      bind:value={password}
      disabled={busy}
    />
    <button type="submit" disabled={busy}>{busy ? 'Please wait…' : submitLabel}</button>
    <p class="alt"><a href={altHref}>{altLabel}</a></p>
  </form>
</div>
