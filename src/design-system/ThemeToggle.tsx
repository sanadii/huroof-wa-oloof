import { useTheme, type ThemeChoice } from '../app/ThemeProvider';

const labels: Record<ThemeChoice, string> = {
  system: 'حسب الجهاز',
  light: 'فاتح',
  dark: 'داكن',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <fieldset className="theme-toggle" aria-label="مظهر التطبيق">
      <legend className="sr-only">مظهر التطبيق</legend>
      {(Object.keys(labels) as ThemeChoice[]).map((choice) => (
        <label key={choice}>
          <input
            checked={theme === choice}
            name="theme"
            onChange={() => setTheme(choice)}
            type="radio"
            value={choice}
          />
          <span>{labels[choice]}</span>
        </label>
      ))}
    </fieldset>
  );
}
