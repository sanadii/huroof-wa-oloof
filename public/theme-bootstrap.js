(() => {
  try {
    const saved = localStorage.getItem('huroof-theme');
    const choice = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    const resolved = choice === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.theme = resolved;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
