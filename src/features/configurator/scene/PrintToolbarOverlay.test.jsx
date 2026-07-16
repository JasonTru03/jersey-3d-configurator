import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintToolbarOverlay } from './PrintToolbarOverlay.jsx';

describe('PrintToolbarOverlay', () => {
  it('exposes the five name set controls and rotates the selected print', () => {
    const onRotate = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, x: 180, y: 220, placement: 'right-top' }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate print right' }));

    expect(onRotate).toHaveBeenCalledWith('print-1', 15);
    expect(screen.getByRole('button', { name: 'Edit print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize print' })).toBeInTheDocument();
  });

  it('emits a scale change from the resize handle', () => {
    const onScale = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, x: 180, y: 220, placement: 'right-top' }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize print' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onScale).toHaveBeenCalledWith('print-1', expect.any(Number));
  });

  it('uses the projected anchor location and hides when it is not visible', () => {
    const { rerender } = render(
      <PrintToolbarOverlay anchor={{ visible: true, x: 180, y: 220, placement: 'right-top' }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />,
    );

    const controls = screen.getByRole('group', { name: 'Selected print controls' });
    expect(controls).toHaveClass('is-right-top');
    expect(controls).toHaveStyle({ '--print-anchor-x': '180px', '--print-anchor-y': '220px' });

    rerender(<PrintToolbarOverlay anchor={{ visible: false }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />);

    expect(screen.queryByRole('group', { name: 'Selected print controls' })).not.toBeInTheDocument();
  });
});
