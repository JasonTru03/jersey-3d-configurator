import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomPatternPanel } from './BottomPatternPanel.jsx';

const pattern = {
  enabled: false,
  transform: { scale: 1, rotationDeg: 0, repeat: { u: 3, v: 4 } },
};

describe('BottomPatternPanel', () => {
  it('emits focused nested patches for its enable and transform controls', () => {
    const onChange = vi.fn();
    render(<BottomPatternPanel pattern={pattern} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Pattern scale' }), { target: { value: '1.5' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Pattern rotation' }), { target: { value: '45' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Horizontal repeat' }), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Vertical repeat' }), { target: { value: '6' } });

    expect(onChange.mock.calls.map(([patch]) => patch)).toEqual([
      { enabled: true },
      { transform: { scale: 1.5 } },
      { transform: { rotationDeg: 45 } },
      { transform: { repeat: { u: 5 } } },
      { transform: { repeat: { v: 6 } } },
    ]);
  });

  it('restores the pattern controls to their supplied defaults', () => {
    const onChange = vi.fn();
    render(<BottomPatternPanel pattern={{ ...pattern, enabled: true, transform: { scale: 2, rotationDeg: 45, repeat: { u: 6, v: 7 } } }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset controls' }));

    expect(onChange).toHaveBeenCalledWith({
      enabled: false,
      transform: { scale: 1, rotationDeg: 0, repeat: { u: 3, v: 4 } },
    });
  });
});
