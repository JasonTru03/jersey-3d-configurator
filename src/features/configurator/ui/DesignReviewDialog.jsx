const APPEARANCE_SUMMARY_ROWS = [
  ['body', 'Body'],
  ['sleeves', 'Sleeves'],
  ['shoulderSide', 'Shoulder and side panels'],
  ['collar', 'Collar'],
  ['pattern', 'Pattern'],
  ['number', 'Name and number'],
];

export function DesignReviewDialog({ cartError, onAddToCart, onClose, onDownload, onSave, open, preparedDownload, product, quote, selected, shopifyContext, state }) {
  if (!open) return null;

  const artworkCount = state.overrides?.decorations?.length ?? 0;
  const artworkLabel = `${artworkCount} artwork item${artworkCount === 1 ? '' : 's'}`;
  const appearance = state.overrides?.appearance;
  const templateLabel = product.options.templates.find((template) => template.id === appearance?.template)?.label ?? 'Solid';

  return (
    <div className="review-backdrop" role="presentation">
      <section aria-labelledby="design-review-title" aria-modal="true" className="review-dialog" role="dialog">
        <div className="review-header">
          <div>
            <p className="eyebrow">Design review</p>
            <h2 id="design-review-title">Review your design</h2>
          </div>
          <button aria-label="Close review" className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        <p className="review-product">{product.name}</p>
        <dl className="review-summary">
          <div><dt>Size</dt><dd>{selected.layout?.shortLabel}</dd></div>
          <div><dt>Colorway</dt><dd>{selected.colorway?.label}</dd></div>
          <div><dt>Fabric</dt><dd>{selected.material?.shortLabel}</dd></div>
          <div><dt>Print</dt><dd>{selected.lighting?.shortLabel}</dd></div>
          <div><dt>Artwork</dt><dd>{artworkLabel}</dd></div>
          <div><dt>Template</dt><dd>{templateLabel}</dd></div>
          {APPEARANCE_SUMMARY_ROWS.map(([zone, label]) => (
            <div key={zone}><dt>{label}</dt><dd>{`${label}: ${appearance?.colors?.[zone] ?? '—'}`}</dd></div>
          ))}
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
