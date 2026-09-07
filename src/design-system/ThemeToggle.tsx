import { useTheme, type ThemeChoice } from '../app/ThemeProvider';

const labels: Record<ThemeChoice, string> = {
  system: 'حسب الجهاز',
  light: 'فاتح',
  dark: 'داكن',
};

function ThemeIcon({ choice }: { choice: ThemeChoice }) {
  if (choice === 'light') {
    return <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
  }
  if (choice === 'dark') {
    return <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24"><path d="M20.4 15.4A8.7 8.7 0 0 1 8.6 3.6 8.7 8.7 0 1 0 20.4 15.4Z" /></svg>;
  }
  return <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24"><rect height="12" rx="1.5" width="18" x="3" y="4" /><path d="M8 20h8M12 16v4" /></svg>;
}

export function ThemeToggle() {
  const { resolvedTheme, theme, setTheme } = useTheme();
  const resolvedLabel = labels[resolvedTheme];
  return (
    <fieldset className="theme-toggle" aria-label="مظهر التطبيق">
      <legend className="sr-only">مظهر التطبيق</legend>
      <output aria-live="polite" className="sr-only">
        {theme === 'system' ? `حسب الجهاز — ${resolvedLabel} الآن` : `المظهر ${labels[theme]}`}
      </output>
      {(Object.keys(labels) as ThemeChoice[]).map((choice) => (
        <label key={choice}>
          <input
            aria-label={choice === 'system' ? `حسب الجهاز — ${resolvedLabel} الآن` : labels[choice]}
            checked={theme === choice}
            name="theme"
            onChange={() => setTheme(choice)}
            type="radio"
            value={choice}
          />
          <span title={labels[choice]}><ThemeIcon choice={choice} /></span>
        </label>
      ))}
    </fieldset>
  );
}
