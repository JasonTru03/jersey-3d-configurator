export async function uploadDesignAsset({ atlas, design, metadata, endpoint = '/api/design-assets' }) {
  if (!(atlas instanceof Blob) || atlas.type !== 'image/png') throw new Error('A PNG UV atlas is required.');
  const form = new FormData();
  form.set('atlas', atlas, 'uv-atlas.png');
  form.set('design', new Blob([JSON.stringify(design)], { type: 'application/json' }), 'design.json');
  form.set('metadata', JSON.stringify(metadata));
  const response = await fetch(endpoint, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to upload design assets.');
  return body;
}
