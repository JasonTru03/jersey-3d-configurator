import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintToolbarOverlay } from './PrintToolbarOverlay.jsx';

describe('PrintToolbarOverlay', () => {
  it('exposes the five name set controls and rotates the selected print', () => {
    const onRotate = vi.fn();
    render(<PrintToolbarOverlay item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate print right' }));

    expect(onRotate).toHaveBeenCalledWith('print-1', 15);
    expect(screen.getByRole('button', { name: 'Edit print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize print' })).toBeInTheDocument();
  });
});
