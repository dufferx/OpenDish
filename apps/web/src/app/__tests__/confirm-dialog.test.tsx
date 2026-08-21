import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/app/confirm-dialog';

function renderDialog(
  overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete this recipe?',
    description: 'This action cannot be undone.',
    confirmLabel: 'Delete',
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe('ConfirmDialog', () => {
  it('renders title, description and both actions', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this recipe?')).toBeInTheDocument();
    expect(
      screen.getByText('This action cannot be undone.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm action is clicked', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes via onOpenChange when cancel is clicked, without confirming', () => {
    const props = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('disables both actions while pending', () => {
    renderDialog({ pending: true });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
