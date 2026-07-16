import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrintToolbarOverlay } from './PrintToolbarOverlay.jsx';

describe('PrintToolbarOverlay', () => {
  it('exposes the five name set controls', () => {
    const onRotate = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    expect(screen.getByRole('button', { name: 'Edit print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate print' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize print' })).toBeInTheDocument();
  });

  it('captures the rotation pointer and wraps counterclockwise pointer movement through zero degrees', () => {
    const onRotate = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 350 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    const handle = screen.getByRole('button', { name: 'Rotate print' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 9, clientX: 100, clientY: 139 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100, clientY: 121 });

    expect(handle.setPointerCapture).toHaveBeenCalledWith(9);
    expect(onRotate).toHaveBeenLastCalledWith('print-1', expect.closeTo(329.6, 0));

    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 200, clientY: 130 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 150, clientY: 180 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100, clientY: 130 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 150, clientY: 80 });
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 200, clientY: 130 });

    expect(onRotate).toHaveBeenLastCalledWith('print-1', expect.closeTo(160, 0));
  });

  it('does not change rotation for a click without pointer movement', () => {
    const onRotate = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 120 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    const handle = screen.getByRole('button', { name: 'Rotate print' });
    fireEvent.pointerDown(handle, { pointerId: 10, clientX: 200, clientY: 130 });
    fireEvent.pointerUp(handle, { pointerId: 10 });

    expect(onRotate).not.toHaveBeenCalled();
  });

  it('emits a scale change from the resize handle', () => {
    const onScale = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize print' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onScale).toHaveBeenCalledWith('print-1', expect.any(Number));
  });

  it('captures the resize pointer and scales outward and inward within limits', () => {
    const onScale = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize print' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 240, clientY: 200 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 165, clientY: 135 });

    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(onScale.mock.calls[0][1]).toBeGreaterThan(1);
    expect(onScale.mock.calls[1][1]).toBeLessThan(1);
  });

  it('keeps resize scale within the supported range', () => {
    const onScale = vi.fn();
    render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize print' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 1000, clientY: 1000 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 150, clientY: 130 });

    expect(onScale.mock.calls[0][1]).toBe(2.5);
    expect(onScale.mock.calls[1][1]).toBe(0.45);
  });

  it('uses the projected selection rectangle and hides when it is not visible', () => {
    const { rerender } = render(
      <PrintToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />,
    );

    const controls = screen.getByRole('group', { name: 'Selected print controls' });
    expect(controls).toHaveStyle({ '--print-left': '180px', '--print-top': '220px', '--print-width': '96px', '--print-height': '54px' });
    expect(screen.getByTestId('print-selection-frame')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate print' })).toHaveTextContent('×2');

    rerender(<PrintToolbarOverlay anchor={{ visible: false }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />);

    expect(screen.queryByRole('group', { name: 'Selected print controls' })).not.toBeInTheDocument();
  });
});
