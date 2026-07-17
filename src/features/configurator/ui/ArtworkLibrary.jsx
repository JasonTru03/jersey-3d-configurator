import { Trash2 } from 'lucide-react';

export function ArtworkLibrary({ decorations, activeDecorationId, onSelect, onDelete, resolveAsset }) {
  return (
    <section aria-label="Added artwork" className="artwork-library">
      {decorations.slice(0, 8).map((decoration) => (
        <div className="artwork-library-item" key={decoration.id}>
          <button
            aria-pressed={decoration.id === activeDecorationId}
            className="artwork-library-select"
            onClick={() => onSelect(decoration.id)}
            type="button"
          >
            <img alt="" src={resolveAsset(decoration)} />
            <span>{decoration.label}</span>
          </button>
          <button
            aria-label={`Delete ${decoration.label}`}
            className="artwork-library-delete"
            onClick={() => onDelete(decoration.id)}
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}
