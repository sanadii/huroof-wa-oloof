import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { ThemeToggle } from '../../src/design-system/ThemeToggle';

function mockSystemTheme(initiallyDark: boolean) {
  let matches = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    addEventListener: (_: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    media: '(prefers-color-scheme: dark)',
    removeEventListener: (_: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    get matches() { return matches; },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
  return (nextDark: boolean) => {
    matches = nextDark;
    for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
  };
}

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('persists an explicit theme choice and applies it to the document', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    await user.click(screen.getByLabelText('داكن'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('huroof-theme')).toBe('dark');
  });

  it('resolves and announces the system preference through ThemeProvider', async () => {
    const setSystemTheme = mockSystemTheme(true);
    window.localStorage.setItem('huroof-theme', 'system');
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'حسب الجهاز — داكن الآن' })).toBeChecked();

    act(() => setSystemTheme(false));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(screen.getByRole('radio', { name: 'حسب الجهاز — فاتح الآن' })).toBeChecked();
  });
});
