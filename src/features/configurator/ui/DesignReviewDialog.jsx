import { useEffect, useRef } from 'react';
import {
  getBillableCustomTextItems,
  getCustomTextItems,
} from '../config/customTextItems.js';

const APPEARANCE_SUMMARY_ROWS = [
  ['body', 'Body'],
  ['sleeves', 'Sleeves'],
  ['shoulderSide', 'Shoulder and side panels'],
  ['collar', 'Collar'],
  ['pattern', 'Pattern'],
  ['number', 'Name and number'],
];

export function DesignReviewDialog({ cartError, onAddToCart, onClose, onDownload, onSave, open, preparedDownload, product, quote, selected, shopifyContext, state }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(dialogRef.current);
      if (!focusableElements.length) return;
      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      const activeElement = document.activeElement;

      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [open]);

  if (!open) return null;

  const artworkCount = state.overrides?.decorations?.length ?? 0;
  const artworkLabel = `${artworkCount} artwork item${artworkCount === 1 ? '' : 's'}`;
  const appearance = state.overrides?.appearance;
  const templateLabel = product.options.templates.find((template) => template.id === appearance?.template)?.label ?? 'Solid';
  const customTextItems = getBillableCustomTextItems(getCustomTextItems(state.overrides));
  const customTextLabel = customTextItems.length
    ? `${customTextItems.length} item${customTextItems.length === 1 ? '' : 's'}: ${
      customTextItems.map((item) => item.text.trim()).join(', ')
    }`
    : 'None';
  const extras = selected.extras ?? [];
  const extrasLabel = extras.length
    ? extras.map((extra) => extra.label ?? extra.shortLabel ?? extra.id).join(', ')
    : 'None';
  const customizationTotal = Number.isFinite(quote.customizationTotal)
    ? quote.customizationTotal
    : 0;

  return (
    <div className="review-backdrop" role="presentation">
      <section
        aria-labelledby="design-review-title"
        aria-modal="true"
        className="review-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <div className="review-header">
          <div>
            <p className="eyebrow">Design review</p>
            <h2 id="design-review-title">Review your design</h2>
          </div>
          <button
            aria-label="Close review"
            className="icon-button"
            onClick={() => onCloseRef.current?.()}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="review-product">{product.name}</p>
        <dl className="review-summary">
          <div><dt>Size</dt><dd>{selected.layout?.shortLabel}</dd></div>
          <div><dt>Fabric</dt><dd>{selected.material?.shortLabel}</dd></div>
          <div><dt>Design</dt><dd>{templateLabel}</dd></div>
          <div><dt>Player set</dt><dd>{selected.lighting?.shortLabel ?? 'None'}</dd></div>
          <div><dt>Custom text</dt><dd>{customTextLabel}</dd></div>
          <div><dt>Artwork</dt><dd>{artworkLabel}</dd></div>
          <div><dt>Extras</dt><dd>{extrasLabel}</dd></div>
          {APPEARANCE_SUMMARY_ROWS.map(([zone, label]) => (
            <div key={zone}><dt>{label}</dt><dd>{`${label}: ${appearance?.colors?.[zone] ?? '—'}`}</dd></div>
          ))}
          <div><dt>Customization subtotal</dt><dd>${customizationTotal}</dd></div>
        </dl>
        <div className="review-total"><span>Total</span><strong>${quote.total}</strong></div>
        <p className="review-note">Shopify cart total: ${quote.total}</p>
        {state.overrides?.bottomPattern?.enabled && (
          <p className="review-note">Prepare the production ZIP, then use its download link before adding this design to the cart.</p>
        )}
        {!shopifyContext && (
          <p className="review-note">Open the configurator from a connected Shopify product page to add this design to your cart.</p>
        )}
        {cartError && <p className="review-note" role="alert">{cartError}</p>}
        <div className="review-actions">
          <button className="soft-button" onClick={onClose} type="button">Continue editing</button>
          <button className="soft-button" onClick={onSave} type="button">Save design file</button>
          {preparedDownload && (
            <a
              className="soft-button"
              download={preparedDownload.filename}
              href={preparedDownload.url}
              onClick={onDownload}
            >
              {preparedDownload.label}
            </a>
          )}
          <button className="primary-button" disabled={!shopifyContext} onClick={() => onAddToCart?.()} type="button">Add to Shopify cart</button>
        </div>
      </section>
    </div>
  );
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));
}
