import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from './TemplateLibrary.jsx';

const templates = [
  { id: 'solid', label: 'Solid' },
  { id: 'vertical-stripes', label: 'Vertical Stripes' },
  { id: 'horizontal-stripes', label: 'Horizontal Stripes' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'color-block', label: 'Color Block' },
];

describe('TemplateLibrary', () => {
  it('renders each template as an accessible selectable preview', () => {
    const onSelect = vi.fn();
    render(<TemplateLibrary activeTemplate="diagonal" onSelect={onSelect} templates={templates} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Diagonal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Solid' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('template-preview-gradient')).toHaveClass('template-preview--gradient');

    fireEvent.click(screen.getByRole('button', { name: 'Color Block' }));
    expect(onSelect).toHaveBeenCalledWith('color-block');
  });
});
