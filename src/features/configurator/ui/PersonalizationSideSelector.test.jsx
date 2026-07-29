import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationSideSelector } from './PersonalizationSideSelector.jsx';

describe('PersonalizationSideSelector', () => {
  it('shows the active side and emits the selected side', () => {
    const onSelect = vi.fn();
    const { container } = render(<PersonalizationSideSelector onSelect={onSelect} side="front" />);

    expect(screen.getByRole('group', { name: 'Side' })).toHaveClass('personalization-side-selector');
    expect(container.querySelector('.personalization-side-options')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(onSelect).toHaveBeenNthCalledWith(1, 'front');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSelect).toHaveBeenNthCalledWith(2, 'back');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('disables both controls while mutations are locked', () => {
    const onSelect = vi.fn();
    render(<PersonalizationSideSelector disabled onSelect={onSelect} side="back" />);

    const frontButton = screen.getByRole('button', { name: 'Front' });
    const backButton = screen.getByRole('button', { name: 'Back' });
    expect(frontButton).toBeDisabled();
    expect(backButton).toBeDisabled();
    fireEvent.click(frontButton);
    fireEvent.click(backButton);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
