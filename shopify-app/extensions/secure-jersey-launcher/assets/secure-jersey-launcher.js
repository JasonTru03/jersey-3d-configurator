(() => {
  if (document.documentElement.dataset.secureJerseyLauncherReady === 'true') return;
  document.documentElement.dataset.secureJerseyLauncherReady = 'true';

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-secure-jersey-launcher-button]');
    const launcher = button?.closest('[data-secure-jersey-launcher]');
    if (!button || !launcher) return;

    const productForm = launcher.closest('form[action*="/cart/add"]')
      || document.querySelector('form[action*="/cart/add"]');
    const variantId = productForm?.elements?.id?.value
      || productForm?.querySelector('select[name="id"]')?.value
      || productForm?.querySelector('input[name="id"]:checked')?.value
      || productForm?.querySelector('input[type="hidden"][name="id"]')?.value
      || new URL(window.location.href).searchParams.get('variant')
      || launcher.dataset.initialVariantId;
    if (!/^[1-9][0-9]{0,31}$/u.test(variantId ?? '')) {
      event.preventDefault();
      return;
    }
    const destination = new URL(button.href);
    destination.searchParams.set('variantId', variantId);
    button.href = destination.toString();
  });
})();
