import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoneColorPanel } from './ZoneColorPanel.jsx';

const colors = {
  body: '#F7F5EF',
  sleeves: '#20242A',
  shoulderSide: '#D1B05D',
  collar: '#1F5B4F',
  pattern: '#C84F3D',
  number: '#F4EFE4',
};

describe('ZoneColorPanel', () => {
  it('keeps its active zone local and returns only the selected zone patch', () => {
    const onColorChange = vi.fn();
    render(<ZoneColorPanel colors={colors} onColorChange={onColorChange} palette={['#F7F5EF', '#C84F3D']} />);

    expect(screen.getAllByRole('button', { name: /^(Body|Sleeves|Shoulder & side|Collar|Pattern|Number)$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Body' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('#F7F5EF')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sleeves' }));
    expect(screen.getByRole('button', { name: 'Sleeves' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('#20242A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use #C84F3D' }));
    expect(onColorChange).toHaveBeenCalledWith({ sleeves: '#C84F3D' });
    expect(colors.sleeves).toBe('#20242A');
  });
});
