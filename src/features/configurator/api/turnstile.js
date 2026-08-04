export async function getDesignUploadTurnstileToken({
  action = 'production_draft',
  endpoint = '/api/production-drafts/config',
  turnstile = window.turnstile,
} = {}) {
  const response = await fetch(endpoint, { cache: 'no-store' });
  const config = await response.json().catch(() => ({}));
  if (!response.ok || typeof config.turnstileSiteKey !== 'string' || config.turnstileSiteKey.length === 0) throw new Error(config.error || 'Design upload verification is not configured.');
  if (!turnstile?.ready || !turnstile?.execute) throw new Error('Design upload verification is unavailable.');
  await new Promise((resolve) => turnstile.ready(resolve));
  const token = await turnstile.execute(config.turnstileSiteKey, { action });
  if (typeof token !== 'string' || token.length === 0) throw new Error('Design upload verification failed.');
  return token;
}
