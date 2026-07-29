import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationSideSelector } from './PersonalizationSideSelector.jsx';

describe('PersonalizationSideSelector', () => {
  it('shows the active side and emits the selected side', () => {
    const onSelect = vi.fn();
    render(<PersonalizationSideSelector onSelect={onSelect} side="front" />);

    expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSelect).toHaveBeenCalledWith('back');
  });

  it('disables both controls while mutations are locked', () => {
    render(<PersonalizationSideSelector disabled onSelect={vi.fn()} side="back" />);

    expect(screen.getByRole('button', { name: 'Front' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});
