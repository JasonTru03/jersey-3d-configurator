import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationToolbarOverlay } from './PersonalizationToolbarOverlay.jsx';
import { getPersonalizationControlsLayout } from './personalizationToolbarLayout.js';

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

function makeRect({ left = 0, top = 0, width = 0, height = 0 }) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => {},
  };
}

function renderToolbarInStage({ stageWidth, stageHeight, toolbarRect, anchor: stageAnchor }) {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
    if (this.classList?.contains('print-toolbar-overlay')) {
      return makeRect({ width: stageWidth, height: stageHeight });
    }
    if (this.classList?.contains('stage-toolbar') && toolbarRect) return makeRect(toolbarRect);
    return originalGetBoundingClientRect.call(this);
  });
  const renderStage = (currentAnchor) => (
    <section className="stage-wrap">
      <div className="stage-toolbar"><button type="button">Orbit</button></div>
      <div className="stage">
        <PersonalizationToolbarOverlay
          anchor={currentAnchor}
          item={{ id: 'print-1', rotation: 0, scale: 1 }}
        />
      </div>
    </section>
  );
  const result = render(renderStage(stageAnchor));
  return {
    ...result,
    rerenderToolbar: (nextAnchor) => result.rerender(renderStage(nextAnchor)),
    restoreRects: () => rectSpy.mockRestore(),
  };
}

function getDockButtonRects(dock) {
  const columns = Number(dock.style.getPropertyValue('--print-dock-columns'));
  const left = Number.parseFloat(dock.style.getPropertyValue('--print-dock-position-left'));
  const top = Number.parseFloat(dock.style.getPropertyValue('--print-dock-position-top'));
  const rows = Math.ceil(3 / columns);
  const width = columns * 44 + (columns - 1) * 4;
  return Array.from({ length: 3 }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return makeRect({
      left: left - width / 2 + column * 48,
      top: top + row * 48,
      width: 44,
      height: 44,
    });
  }).slice(0, columns * rows);
}

function getRotateRect(rotateControl) {
  const left = Number.parseFloat(
    rotateControl.style.getPropertyValue('--print-rotate-position-left'),
  );
  const top = Number.parseFloat(
    rotateControl.style.getPropertyValue('--print-rotate-position-top'),
  );
  return makeRect({ left: left - 22, top, width: 44, height: 44 });
}

function intersects(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function rectanglesHaveGap(first, second, gap = 8) {
  return first.right + gap <= second.left
    || first.left >= second.right + gap
    || first.bottom + gap <= second.top
    || first.top >= second.bottom + gap;
}

describe('PersonalizationToolbarOverlay', () => {
  it('separates the drag rotation handle from the compact action dock', () => {
    renderToolbar();

    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
    expect(screen.getByTestId('print-control-dock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to rotate personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate personalization' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize personalization' })).toBeInTheDocument();
    expect(screen.getByTestId('print-control-dock')).not.toContainElement(
      screen.getByRole('button', { name: 'Drag to rotate personalization' }),
    );
    expect(screen.getByTestId('print-rotate-control')).toHaveTextContent('DRAG');
    expect(screen.getByTestId('print-rotate-connector')).toBeInTheDocument();
  });

  it('models three distinct action rectangles below an overlapping left-top stage toolbar', async () => {
    const toolbarRect = makeRect({ left: 16, top: 16, width: 144, height: 44 });
    const view = renderToolbarInStage({
      stageWidth: 640,
      stageHeight: 400,
      toolbarRect,
      anchor: { visible: true, left: 10, top: 20, width: 80, height: 40 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-position-top')).toBe('68px'));
      const buttonRects = getDockButtonRects(dock);
      expect(buttonRects).toHaveLength(3);
      expect(buttonRects.every((buttonRect) => !intersects(buttonRect, toolbarRect))).toBe(true);
      expect(buttonRects.every((buttonRect) => (
        buttonRect.left >= 8
        && buttonRect.right <= 632
        && buttonRect.top >= 8
        && buttonRect.bottom <= 392
      ))).toBe(true);
      for (const buttonRect of buttonRects) {
        const hitCount = buttonRects.filter((candidate) => (
          buttonRect.left + 22 >= candidate.left
          && buttonRect.left + 22 <= candidate.right
          && buttonRect.top + 22 >= candidate.top
          && buttonRect.top + 22 <= candidate.bottom
        )).length;
        expect(hitCount).toBe(1);
      }
    } finally {
      view.unmount();
      view.restoreRects();
    }
  });

  it('keeps the rotation handle clear of every action for a narrow selection', async () => {
    const view = renderToolbarInStage({
      stageWidth: 640,
      stageHeight: 400,
      toolbarRect: null,
      anchor: { visible: true, left: 102, top: 114, width: 128, height: 84 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      const rotateControl = screen.getByTestId('print-rotate-control');
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-columns')).toBe('3'));
      const rotateRect = getRotateRect(rotateControl);
      expect(getDockButtonRects(dock).every((buttonRect) => rectanglesHaveGap(buttonRect, rotateRect))).toBe(true);
    } finally {
      view.unmount();
      view.restoreRects();
    }
  });

  it('keeps a right-top dock inside the stage without unnecessary toolbar displacement', async () => {
    const view = renderToolbarInStage({
      stageWidth: 640,
      stageHeight: 400,
      toolbarRect: { left: 16, top: 16, width: 144, height: 44 },
      anchor: { visible: true, left: 590, top: 100, width: 40, height: 40 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      const rotateControl = screen.getByTestId('print-rotate-control');
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-position-left')).toBe('562px'));
      const buttonRects = getDockButtonRects(dock);
      const rotateRect = getRotateRect(rotateControl);
      expect(buttonRects.every((buttonRect) => buttonRect.left >= 8 && buttonRect.right <= 632)).toBe(true);
      expect(buttonRects.every((buttonRect) => rectanglesHaveGap(buttonRect, rotateRect))).toBe(true);
      expect(rotateRect.left).toBeGreaterThanOrEqual(8);
      expect(rotateRect.right).toBeLessThanOrEqual(632);
      expect(rotateRect.top).toBeGreaterThanOrEqual(8);
      expect(rotateRect.bottom).toBeLessThanOrEqual(392);
      expect(dock.style.getPropertyValue('--print-dock-position-top')).toBe('48px');
    } finally {
      view.unmount();
      view.restoreRects();
    }
  });

  it('wraps all three 44px action targets inside a stage narrower than the single-row dock', async () => {
    const view = renderToolbarInStage({
      stageWidth: 120,
      stageHeight: 320,
      toolbarRect: null,
      anchor: { visible: true, left: 90, top: 150, width: 30, height: 40 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      const rotateControl = screen.getByTestId('print-rotate-control');
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-columns')).toBe('2'));
      const buttonRects = getDockButtonRects(dock);
      const rotateRect = getRotateRect(rotateControl);
      expect(buttonRects).toHaveLength(3);
      expect(buttonRects.every((buttonRect) => (
        buttonRect.width === 44
        && buttonRect.height === 44
        && buttonRect.left >= 8
        && buttonRect.right <= 112
        && buttonRect.top >= 8
        && buttonRect.bottom <= 312
      ))).toBe(true);
      expect(buttonRects.some((buttonRect) => buttonRect.top !== buttonRects[0].top)).toBe(true);
      expect(buttonRects.every((buttonRect) => rectanglesHaveGap(buttonRect, rotateRect))).toBe(true);
      expect(rotateRect.left).toBeGreaterThanOrEqual(8);
      expect(rotateRect.right).toBeLessThanOrEqual(112);
      expect(rotateRect.top).toBeGreaterThanOrEqual(8);
      expect(rotateRect.bottom).toBeLessThanOrEqual(312);
    } finally {
      view.unmount();
      view.restoreRects();
    }
  });

  it('finds a clear rotation position above a bottom-clamped wrapped dock', async () => {
    const view = renderToolbarInStage({
      stageWidth: 120,
      stageHeight: 320,
      toolbarRect: null,
      anchor: { visible: true, left: 90, top: 300, width: 30, height: 20 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      const rotateControl = screen.getByTestId('print-rotate-control');
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-columns')).toBe('2'));
      const buttonRects = getDockButtonRects(dock);
      const rotateRect = getRotateRect(rotateControl);
      expect(buttonRects.every((buttonRect) => rectanglesHaveGap(buttonRect, rotateRect))).toBe(true);
      expect(rotateRect.left).toBeGreaterThanOrEqual(8);
      expect(rotateRect.right).toBeLessThanOrEqual(112);
      expect(rotateRect.top).toBeGreaterThanOrEqual(8);
      expect(rotateRect.bottom).toBeLessThanOrEqual(312);
    } finally {
      view.unmount();
      view.restoreRects();
    }
  });

  it('fails explicitly when no clear rotation position exists in the stage', () => {
    expect(() => getPersonalizationControlsLayout(
      { left: 105, top: 248 },
      { left: 90, top: 300, width: 30, height: 20 },
      {
        width: 120,
        height: 320,
        obstacle: { left: 8, right: 112, top: 8, bottom: 212 },
      },
    )).toThrow('Unable to place personalization rotation control within the stage');
  });

  it('moves the action dock and captured rotation handle with the latest selection anchor', async () => {
    const view = renderToolbarInStage({
      stageWidth: 640,
      stageHeight: 400,
      toolbarRect: { left: 16, top: 16, width: 144, height: 44 },
      anchor: { visible: true, left: 10, top: 20, width: 80, height: 40 },
    });

    try {
      const dock = screen.getByTestId('print-control-dock');
      const rotateControl = screen.getByTestId('print-rotate-control');
      const rotateHandle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
      await waitFor(() => expect(dock.style.getPropertyValue('--print-dock-position-top')).toBe('68px'));

      fireEvent.pointerDown(rotateHandle, { pointerId: 20, clientX: 50, clientY: -20 });
      view.rerenderToolbar({ visible: true, left: 400, top: 300, width: 170, height: 90 });

      expect(dock.style.getPropertyValue('--print-dock-columns')).toBe('3');
      expect(dock.style.getPropertyValue('--print-dock-position-left')).toBe('485px');
      expect(dock.style.getPropertyValue('--print-dock-position-top')).toBe('248px');
      expect(rotateControl.style.getPropertyValue('--print-rotate-position-left')).toBe('585px');
      expect(rotateControl.style.getPropertyValue('--print-rotate-position-top')).toBe('248px');

      fireEvent.pointerUp(rotateHandle, { pointerId: 20, clientX: 50, clientY: -20 });
      expect(rotateControl).not.toHaveClass('is-dragging');
    } finally {
      view.unmount();
      view.restoreRects();
    }
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

  it('signals rotation preview begin and end with the final emitted angle', () => {
    const onRotationGestureStart = vi.fn();
    const onRotationGestureEnd = vi.fn();
    const { callbacks } = renderToolbar({ onRotationGestureEnd, onRotationGestureStart });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 27, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 27, clientX: 200, clientY: 100 });
    const finalRotation = callbacks.onRotate.mock.calls.at(-1)[1];
    fireEvent.pointerUp(handle, { pointerId: 27, clientX: 200, clientY: 100 });

    expect(onRotationGestureStart).toHaveBeenCalledOnce();
    expect(onRotationGestureStart).toHaveBeenCalledWith('print-1');
    expect(onRotationGestureEnd).toHaveBeenCalledOnce();
    expect(onRotationGestureEnd).toHaveBeenCalledWith('print-1', finalRotation);
  });

  it('keeps keyboard rotation discrete without starting a drag preview', () => {
    const onRotationGestureStart = vi.fn();
    const onRotationGestureEnd = vi.fn();
    const { callbacks } = renderToolbar({ onRotationGestureEnd, onRotationGestureStart });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(callbacks.onRotate).toHaveBeenCalledWith('print-1', 5);
    expect(onRotationGestureStart).not.toHaveBeenCalled();
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
  });

  it('does not change rotation for a click without a drag', () => {
    const { callbacks } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 150, clientY: 50 });
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 150, clientY: 50 });
    fireEvent.click(handle);

    expect(callbacks.onRotate).not.toHaveBeenCalled();
  });

  it('keeps the entire control set attached to a changing anchor while rotating', () => {
    const { callbacks, rerender } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 4, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 250, clientY: 130 });
    const dock = screen.getByTestId('print-control-dock');
    const rotateControl = screen.getByTestId('print-rotate-control');
    expect(dock).toHaveStyle({
      '--print-dock-position-left': '150px',
      '--print-dock-position-top': '48px',
    });
    expect(rotateControl).toHaveStyle({
      '--print-rotate-position-left': '250px',
      '--print-rotate-position-top': '48px',
    });

    rerender(
      <PersonalizationToolbarOverlay
        anchor={{ visible: true, left: 50, top: 180, width: 250, height: 90 }}
        item={{ id: 'print-1', rotation: 30, scale: 1 }}
        {...callbacks}
      />,
    );
    expect(dock).toHaveStyle({
      '--print-dock-position-left': '175px',
      '--print-dock-position-top': '128px',
    });
    expect(rotateControl).toHaveStyle({
      '--print-rotate-position-left': '300px',
      '--print-rotate-position-top': '118px',
    });

    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 150, clientY: 230 });
    expect(callbacks.onRotate).toHaveBeenLastCalledWith('print-1', 180);

    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 150, clientY: 50 });
    expect(rotateControl).not.toHaveClass('is-dragging');
  });

  it('clears a hidden anchor gesture before showing the latest unfrozen dock', () => {
    const onRotationGestureEnd = vi.fn();
    const onRotationGestureCancel = vi.fn();
    const { callbacks, rerender } = renderToolbar({ onRotationGestureCancel, onRotationGestureEnd });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 10, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 200, clientY: 100 });
    expect(screen.getByTestId('print-rotate-control')).toHaveClass('is-dragging');

    rerender(
      <PersonalizationToolbarOverlay
        anchor={{ visible: false }}
        item={{ id: 'print-1', rotation: 0, scale: 1 }}
        {...callbacks}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();

    rerender(
      <PersonalizationToolbarOverlay
        anchor={{ visible: true, left: 20, top: 200, width: 80, height: 40 }}
        item={{ id: 'print-1', rotation: 0, scale: 1 }}
        {...callbacks}
      />,
    );
    expect(screen.getByTestId('print-rotate-control')).not.toHaveClass('is-dragging');
    expect(screen.getByTestId('print-control-dock')).toHaveStyle({
      '--print-dock-position-left': '60px',
      '--print-dock-position-top': '148px',
    });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(10);
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
    expect(onRotationGestureCancel).toHaveBeenCalledOnce();
    expect(onRotationGestureCancel).toHaveBeenCalledWith('print-1');
  });

  it('does not let an old pointer gesture rotate a newly selected item', () => {
    const onRotationGestureEnd = vi.fn();
    const onRotationGestureCancel = vi.fn();
    const { callbacks, rerender } = renderToolbar({ onRotationGestureCancel, onRotationGestureEnd });
    const oldHandle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    oldHandle.hasPointerCapture = vi.fn(() => true);
    oldHandle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(oldHandle, { pointerId: 11, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(oldHandle, { pointerId: 11, clientX: 200, clientY: 100 });
    callbacks.onRotate.mockClear();
    rerender(
      <PersonalizationToolbarOverlay
        anchor={anchor}
        item={{ id: 'print-2', rotation: 90, scale: 1 }}
        {...callbacks}
      />,
    );
    fireEvent.pointerMove(oldHandle, { pointerId: 11, clientX: 250, clientY: 130 });

    expect(callbacks.onRotate).not.toHaveBeenCalled();
    expect(oldHandle.releasePointerCapture).toHaveBeenCalledWith(11);
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
    expect(onRotationGestureCancel).toHaveBeenCalledWith('print-1');
  });

  it('releases a captured rotation pointer when the overlay unmounts', () => {
    const onRotationGestureEnd = vi.fn();
    const onRotationGestureCancel = vi.fn();
    const { unmount } = renderToolbar({ onRotationGestureCancel, onRotationGestureEnd });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 12, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 12, clientX: 200, clientY: 100 });
    unmount();

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(12);
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
    expect(onRotationGestureCancel).toHaveBeenCalledWith('print-1');
  });

  it('cancels an active rotation when personalization mutations become locked', () => {
    const onRotationGestureEnd = vi.fn();
    const onRotationGestureCancel = vi.fn();
    const { callbacks, rerender } = renderToolbar({ onRotationGestureCancel, onRotationGestureEnd });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 28, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 28, clientX: 200, clientY: 100 });
    const finalRotation = callbacks.onRotate.mock.calls.at(-1)[1];

    rerender(
      <PersonalizationToolbarOverlay
        anchor={anchor}
        item={{ id: 'print-1', rotation: finalRotation, scale: 1 }}
        {...callbacks}
        personalizationMutationDisabled
      />,
    );

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(28);
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
    expect(onRotationGestureCancel).toHaveBeenCalledWith('print-1');
  });

  it('releases a captured resize pointer when the overlay unmounts', () => {
    const { unmount } = renderToolbar();
    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    handle.hasPointerCapture = vi.fn(() => true);
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { pointerId: 19, clientX: 200, clientY: 160 });
    unmount();

    expect(handle.releasePointerCapture).toHaveBeenCalledWith(19);
  });

  it.each(['pointerCancel', 'lostPointerCapture'])('clears a rotation gesture after %s', (eventName) => {
    const onRotationGestureEnd = vi.fn();
    const onRotationGestureCancel = vi.fn();
    const { callbacks } = renderToolbar({ onRotationGestureCancel, onRotationGestureEnd });
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 5, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 200, clientY: 100 });
    fireEvent[eventName](handle, { pointerId: 5 });
    callbacks.onRotate.mockClear();
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 200, clientY: 100 });

    expect(callbacks.onRotate).not.toHaveBeenCalled();
    expect(onRotationGestureEnd).not.toHaveBeenCalled();
    expect(onRotationGestureCancel).toHaveBeenCalledWith('print-1');
    expect(screen.getByTestId('print-control-dock')).toHaveStyle({
      '--print-dock-position-left': '150px',
      '--print-dock-position-top': '48px',
    });
  });

  it('consumes a distinct pointer-up position once and does not duplicate the last move', () => {
    const first = renderToolbar();
    const firstHandle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    firstHandle.hasPointerCapture = vi.fn(() => true);
    firstHandle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(firstHandle, { pointerId: 13, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(firstHandle, { pointerId: 13, clientX: 250, clientY: 130 });
    fireEvent.pointerUp(firstHandle, { pointerId: 13, clientX: 150, clientY: 230 });
    expect(first.callbacks.onRotate).toHaveBeenCalledTimes(2);
    expect(first.callbacks.onRotate).toHaveBeenLastCalledWith('print-1', 180);
    expect(firstHandle.releasePointerCapture).toHaveBeenCalledWith(13);
    first.unmount();

    const second = renderToolbar();
    const secondHandle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    fireEvent.pointerDown(secondHandle, { pointerId: 14, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(secondHandle, { pointerId: 14, clientX: 250, clientY: 130 });
    fireEvent.pointerUp(secondHandle, { pointerId: 14, clientX: 250, clientY: 130 });

    expect(second.callbacks.onRotate).toHaveBeenCalledTimes(1);
  });

  it('keeps rotation and resize gestures mutually exclusive across pointer ids', () => {
    const { callbacks } = renderToolbar();
    const rotateHandle = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    const resizeHandle = screen.getByRole('button', { name: 'Resize personalization' });
    resizeHandle.setPointerCapture = vi.fn();
    rotateHandle.setPointerCapture = vi.fn();

    fireEvent.pointerDown(rotateHandle, { pointerId: 15, clientX: 150, clientY: 50 });
    fireEvent.pointerDown(resizeHandle, { pointerId: 16, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(resizeHandle, { pointerId: 16, clientX: 240, clientY: 200 });
    expect(resizeHandle.setPointerCapture).not.toHaveBeenCalled();
    expect(callbacks.onScale).not.toHaveBeenCalled();

    fireEvent.pointerCancel(rotateHandle, { pointerId: 15 });
    fireEvent.pointerDown(resizeHandle, { pointerId: 17, clientX: 200, clientY: 160 });
    fireEvent.pointerDown(rotateHandle, { pointerId: 18, clientX: 150, clientY: 50 });
    fireEvent.pointerMove(rotateHandle, { pointerId: 18, clientX: 250, clientY: 130 });

    expect(resizeHandle.setPointerCapture).toHaveBeenCalledWith(17);
    expect(rotateHandle.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(callbacks.onRotate).not.toHaveBeenCalled();
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
    expect(callbacks.onDelete).toHaveBeenCalledWith('print-1', expect.objectContaining({
      onFailure: expect.any(Function),
      onStart: expect.any(Function),
    }));
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
