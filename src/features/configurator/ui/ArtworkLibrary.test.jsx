import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtworkLibrary } from './ArtworkLibrary.jsx';

const decorations = [
  { id: 'crest-1', label: 'Crest Badge', kind: 'badge', source: 'crest' },
  { id: 'upload-1', label: 'Sponsor Logo', kind: 'upload', source: 'data:image/png;base64,logo' },
];

describe('ArtworkLibrary', () => {
  it('renders resolved previews with accessible selection and delete controls', () => {
    const resolveAsset = vi.fn((decoration) => `resolved:${decoration.id}`);

    render(
      <ArtworkLibrary
        activeDecorationId="crest-1"
        decorations={decorations}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        resolveAsset={resolveAsset}
      />,
    );

    expect(screen.getByRole('button', { name: 'Crest Badge' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sponsor Logo' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Delete Crest Badge' })).toBeInTheDocument();
    const [crestPreview] = document.querySelectorAll('.artwork-library img');
    expect(crestPreview).toHaveAttribute('alt', '');
    expect(crestPreview).toHaveAttribute('src', 'resolved:crest-1');
    expect(resolveAsset).toHaveBeenCalledWith(decorations[0]);
  });

  it('selects an artwork without changing its decoration data', () => {
    const onSelect = vi.fn();

    render(
      <ArtworkLibrary
        activeDecorationId="crest-1"
        decorations={decorations}
        onDelete={vi.fn()}
        onSelect={onSelect}
        resolveAsset={(decoration) => decoration.source}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sponsor Logo' }));

    expect(onSelect).toHaveBeenCalledWith('upload-1');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('deletes only the clicked artwork without selecting it', () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();

    render(
      <ArtworkLibrary
        activeDecorationId="crest-1"
        decorations={decorations}
        onDelete={onDelete}
        onSelect={onSelect}
        resolveAsset={(decoration) => decoration.source}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Sponsor Logo' }));

    expect(onDelete).toHaveBeenCalledWith('upload-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders at most eight added artworks', () => {
    const nineDecorations = Array.from({ length: 9 }, (_, index) => ({
      id: `artwork-${index + 1}`,
      label: `Artwork ${index + 1}`,
      kind: 'upload',
      source: `data:image/png;base64,${index + 1}`,
    }));

    render(
      <ArtworkLibrary
        activeDecorationId={null}
        decorations={nineDecorations}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        resolveAsset={(decoration) => decoration.source}
      />,
    );

    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'Artwork 9' })).not.toBeInTheDocument();
  });
});
