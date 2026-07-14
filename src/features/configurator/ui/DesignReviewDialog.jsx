export function DesignReviewDialog({ onClose, onSave, open, product, quote, selected, state }) {
  if (!open) return null;

  const artworkCount = state.overrides?.decorations?.length ?? 0;
  const artworkLabel = `${artworkCount} artwork item${artworkCount === 1 ? '' : 's'}`;

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
        </dl>
        <div className="review-total"><span>Total</span><strong>${quote.total}</strong></div>
        <p className="review-note">Shopping cart and payment will be available after the design service is connected.</p>
        <div className="review-actions">
          <button className="soft-button" onClick={onClose} type="button">Continue editing</button>
          <button className="primary-button" onClick={onSave} type="button">Save design file</button>
        </div>
      </section>
    </div>
  );
}
