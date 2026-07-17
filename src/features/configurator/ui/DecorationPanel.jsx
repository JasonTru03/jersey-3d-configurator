import { ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { createDecoration, MAX_DECORATIONS, patchDecoration, removeDecoration, validateDecorationFile } from '../config/decorations.js';
import { ArtworkLibrary } from './ArtworkLibrary.jsx';

export function DecorationPanel({ onArtworkSelect, product, state, updateState }) {
  const inputRef = useRef(null);
  const [message, setMessage] = useState('');
  const decorations = state.overrides?.decorations ?? [];
  const activeId = state.overrides?.activeDecorationId ?? null;
  const active = decorations.find((item) => item.id === activeId) ?? null;
  const isFull = decorations.length >= MAX_DECORATIONS;

  function updateDecorations(next, nextActiveId = activeId) {
    updateState({ overrides: { decorations: next, activeDecorationId: nextActiveId } });
  }

  function addPreset(preset) {
    if (isFull) {
      setMessage(`You can add up to ${MAX_DECORATIONS} artworks. Remove one to continue.`);
      return;
    }
    const id = `preset-${preset.id}-${Date.now()}`;
    const next = createDecoration({ ...preset, id, region: 'front' });
    updateDecorations([...decorations, next], id);
    setMessage(`${preset.label} added`);
  }

  function updateActive(patch) {
    if (!active) return;
    updateDecorations(decorations.map((item) => item.id === active.id ? patchDecoration(item, patch) : item));
  }

  function removeActive() {
    if (!active) return;
    removeArtwork(active.id);
  }

  function selectArtwork(id) {
    updateDecorations(decorations, id);
    onArtworkSelect?.(id);
  }

  function removeArtwork(id) {
    const decoration = decorations.find((item) => item.id === id);
    if (!decoration) return;
    updateDecorations(removeDecoration(decorations, id), id === activeId ? null : activeId);
    setMessage(`${decoration.label} removed`);
  }

  function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const validation = validateDecorationFile(file);
    if (!validation.ok) {
      setMessage(validation.message);
      return;
    }
    if (isFull) {
      setMessage(`You can add up to ${MAX_DECORATIONS} artworks. Remove one to continue.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const id = `upload-${Date.now()}`;
      const next = createDecoration({ id, kind: 'upload', source: String(reader.result), label: file.name, region: 'front' });
      updateDecorations([...decorations, next], id);
      setMessage(`${file.name} added`);
    };
    reader.onerror = () => setMessage('Image cannot be read. Please choose another file.');
    reader.readAsDataURL(file);
  }

  function openUploadPicker() {
    if (isFull) {
      setMessage(`You can add up to ${MAX_DECORATIONS} artworks. Remove one to continue.`);
      return;
    }
    inputRef.current?.click();
  }

  return (
    <section className="decoration-panel">
      <div className="preset-grid">
        {product.decorationPresets.map((preset) => (
          <button aria-label={preset.label} key={preset.id} onClick={() => addPreset(preset)} type="button">
            <img alt="" src={preset.assetUrl} />
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <input accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={handleUpload} ref={inputRef} type="file" />
      <button className="upload-artwork" onClick={openUploadPicker} type="button">
        <ImagePlus size={16} /> Upload artwork
      </button>
      <p className="decoration-slots">{decorations.length} / {MAX_DECORATIONS} artwork slots used</p>
      <ArtworkLibrary
        activeDecorationId={activeId}
        decorations={decorations}
        onDelete={removeArtwork}
        onSelect={selectArtwork}
      />
      {active && (
        <div className="decoration-actions">
          <strong>{active.label}</strong>
          <div>
            <button aria-label="Rotate left" onClick={() => updateActive({ rotation: active.rotation - 15 })} type="button"><RotateCcw size={16} /></button>
            <button aria-label="Rotate right" onClick={() => updateActive({ rotation: active.rotation + 15 })} type="button"><RotateCw size={16} /></button>
            <button onClick={() => updateActive({ scale: active.scale - 0.15 })} type="button">Smaller</button>
            <button onClick={() => updateActive({ scale: active.scale + 0.15 })} type="button">Larger</button>
            <button aria-label="Delete artwork" className="delete-artwork" onClick={removeActive} type="button"><Trash2 size={16} /></button>
          </div>
        </div>
      )}
      <p aria-live="polite" className="decoration-message">{message || 'Choose artwork, then drag it on the jersey.'}</p>
    </section>
  );
}
