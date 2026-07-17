export function ArtworkSelectionOverlay({ anchor }) {
  if (!anchor?.visible) return null;

  return (
    <div
      aria-hidden="true"
      className="artwork-selection-frame"
      data-testid="artwork-selection-frame"
      style={{
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
        height: anchor.height,
        pointerEvents: 'none',
      }}
    />
  );
}
