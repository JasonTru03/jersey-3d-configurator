import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationToolbarOverlay } from './PersonalizationToolbarOverlay.jsx';

describe('PersonalizationToolbarOverlay', () => {
  it('exposes the five personalization controls', () => {
    const onRotate = vi.fn();
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize personalization' })).toBeInTheDocument();
  });

  it('rotates the selected personalization clockwise by forty-five degrees per click', () => {
    const onRotate = vi.fn();
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 0 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate personalization 45 degrees' }));

    expect(onRotate).toHaveBeenCalledWith('print-1', 45);
  });

  it('wraps a 315-degree personalization rotation back to zero', () => {
    const onRotate = vi.fn();
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 315 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate personalization 45 degrees' }));

    expect(onRotate).toHaveBeenCalledWith('print-1', 0);
  });

  it('emits a scale change from the resize handle', () => {
    const onScale = vi.fn();
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onScale).toHaveBeenCalledWith('print-1', expect.any(Number));
  });

  it('captures the resize pointer and scales outward and inward within limits', () => {
    const onScale = vi.fn();
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize personalization' });
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
    render(<PersonalizationToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);

    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 1000, clientY: 1000 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 150, clientY: 130 });

    expect(onScale.mock.calls[0][1]).toBe(2.5);
    expect(onScale.mock.calls[1][1]).toBe(0.45);
  });

  it('uses the projected selection rectangle and hides when it is not visible', () => {
    const { rerender } = render(
      <PersonalizationToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />,
    );

    const controls = screen.getByRole('group', { name: 'Selected personalization controls' });
    expect(controls).toHaveStyle({ '--print-left': '180px', '--print-top': '220px', '--print-width': '96px', '--print-height': '54px' });
    expect(screen.getByTestId('print-selection-frame')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate personalization' })).toHaveTextContent('×2');

    rerender(<PersonalizationToolbarOverlay anchor={{ visible: false }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} />);

    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
  });
});
