import { fireEvent, screen } from '@testing-library/react';

export const shellPicker = () => screen.getByRole('combobox', { name: 'Shell' });

// Opens the shell picker with the keyboard and picks the option whose name matches.
export function pickShell(name: string | RegExp) {
  fireEvent.keyDown(shellPicker(), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name }));
}
