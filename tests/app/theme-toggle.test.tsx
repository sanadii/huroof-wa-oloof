import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { ThemeToggle } from '../../src/design-system/ThemeToggle';

afterEach(() => window.localStorage.clear());

describe('ThemeToggle', () => {
  it('persists an explicit theme choice and applies it to the document', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    await user.click(screen.getByLabelText('داكن'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('huroof-theme')).toBe('dark');
  });
});
