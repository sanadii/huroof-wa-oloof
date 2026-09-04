import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { EntryRoute, normalizeRoomCode } from '../../src/routes/EntryRoute';

describe('EntryRoute', () => {
  it('normalizes a room code to uppercase LTR ASCII and keeps the join action accessible', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    expect(document.title).toBe('الدخول | استوديو الحروف');
    const input = screen.getByLabelText('رمز الغرفة');
    await user.type(input, 'ab-12 عرب c');
    expect(input).toHaveValue('AB12C');
    expect(input).toHaveAttribute('dir', 'ltr');
    await user.click(screen.getByRole('button', { name: 'انضم إلى غرفة' }));
    expect(screen.getByText('سيُتابع الانضمام إلى الغرفة AB12C.')).toBeInTheDocument();
  });

  it('exposes deterministic normalization without accepting non-ASCII input', () => {
    expect(normalizeRoomCode('x!9-بY')).toBe('X9Y');
  });
});
