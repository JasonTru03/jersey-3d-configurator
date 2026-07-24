import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationToolbarOverlay } from './PersonalizationToolbarOverlay.jsx';

const anchor = { visible: true, left: 100, top: 100, width: 100, height: 60 };

function renderToolbar(props = {}) {
  const callbacks = {
    onCopy: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onRotate: vi.fn(),
    onScale: vi.fn(),
  };
  const result = render(
    <PersonalizationToolbarOverlay
      anchor={anchor}
      item={{ id: 'print-1', rotation: 0, scale: 1 }}
      {...callbacks}
      {...props}
    />,
  );
  return { ...result, callbacks: { ...callbacks, ...props } };
}

describe('PersonalizationToolbarOverlay', () => {
  it('exposes the five personalization controls in a compact action dock', () => {
    renderToolbar();

    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
    expect(screen.getByTestId('print-control-dock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to rotate personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize personalization' })).toBeInTheDocument();
  });

  it('captures the rotation pointer and emits continuous rotation after a drag threshold', () => {
    const { callbacks } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    handle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 151, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 180, clientY: 70 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 200, clientY: 100 });

    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    expect(callbacks.onRotate).toHaveBeenCalledTimes(2);
    expect(callbacks.onRotate.mock.calls[0]).toEqual(['print-1', expect.any(Number)]);
    expect(callbacks.onRotate.mock.calls[1][1]).not.toBe(callbacks.onRotate.mock.calls[0][1]);
  });

  it('does not change rotation for a click without a drag', () => {
    const { callbacks } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 150, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 150, clientY: 50 });
    fireEvent.click(handle);

    expect(callbacks.onRotate).not.toHaveBeenCalled();
  });

  it('freezes the entire control dock while rotating and returns it to the latest anchor on release', () => {
    const { callbacks, rerender } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 4, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 250, clientY: 130 });
    const dock = screen.getByTestId('print-control-dock');
    expect(dock).toHaveStyle({ '--print-dock-left': '150px', '--print-dock-top': '48px' });

    rerender(
      <PersonalizationToolbarOverlay
        anchor={{ visible: true, left: 50, top: 180, width: 250, height: 90 }}
        item={{ id: 'print-1', rotation: 30, scale: 1 }}
        {...callbacks}
      />,
    );
    expect(dock).toHaveStyle({ '--print-dock-left': '150px', '--print-dock-top': '48px' });

    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 150, clientY: 230 });
    expect(callbacks.onRotate).toHaveBeenLastCalledWith('print-1', 180);

    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 150, clientY: 50 });
    expect(dock).toHaveStyle({ '--print-dock-left': '175px', '--print-dock-top': '128px' });
  });

  it.each(['pointerCancel', 'lostPointerCapture'])('clears a rotation gesture after %s', (eventName) => {
    const { callbacks } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 5, clientX: 150, clientY: 50 });
    fireEvent[eventName](handle, { pointerId: 5 });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 200, clientY: 100 });

    expect(callbacks.onRotate).not.toHaveBeenCalled();
    expect(screen.getByTestId('print-control-dock')).toHaveStyle({ '--print-dock-left': '150px', '--print-dock-top': '48px' });
  });

  it('rotates by five degrees with arrow keys in the same visual direction as the drag helper', () => {
    const { callbacks } = renderToolbar({ item: { id: 'print-1', rotation: 0, scale: 1 } });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(callbacks.onRotate).toHaveBeenNthCalledWith(1, 'print-1', 355);
    expect(callbacks.onRotate).toHaveBeenNthCalledWith(2, 'print-1', 5);
  });

  it('preserves edit, duplicate, delete, and resize callbacks', () => {
    const { callbacks } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Edit personalization' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));
    const resize = screen.getByRole('button', { name: 'Resize personalization' });
    resize.setPointerCapture = vi.fn();
    fireEvent.pointerDown(resize, { pointerId: 8, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(resize, { pointerId: 8, clientX: 240, clientY: 200 });

    expect(callbacks.onEdit).toHaveBeenCalledWith('print-1');
    expect(callbacks.onCopy).toHaveBeenCalledWith('print-1');
    expect(callbacks.onDelete).toHaveBeenCalledWith('print-1');
    expect(resize.setPointerCapture).toHaveBeenCalledWith(8);
    expect(callbacks.onScale).toHaveBeenCalledWith('print-1', expect.any(Number));
  });

  it('uses the projected selection rectangle and hides when it is not visible', () => {
    const { rerender } = renderToolbar({ anchor: { visible: true, left: 180, top: 220, width: 96, height: 54 } });

    const controls = screen.getByRole('group', { name: 'Selected personalization controls' });
    expect(controls).toHaveStyle({ '--print-left': '180px', '--print-top': '220px', '--print-width': '96px', '--print-height': '54px' });
    expect(screen.getByTestId('print-selection-frame')).toBeInTheDocument();

    rerender(<PersonalizationToolbarOverlay anchor={{ visible: false }} item={{ id: 'print-1', scale: 1 }} />);

    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
  });

  it('treats every action callback as optional', () => {
    render(<PersonalizationToolbarOverlay anchor={anchor} item={{ id: 'player:print-1', rotation: 0, scale: 1 }} />);

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit personalization' }));
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { pointerId: 9, clientX: 150, clientY: 50 });
      fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { key: 'ArrowRight' });
      fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize personalization' }), { pointerId: 9, clientX: 100, clientY: 100 });
    }).not.toThrow();
  });
});
