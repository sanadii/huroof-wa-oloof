import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AuthAccountControl } from '../features/auth/AuthAccountControl';
import { BrandMark } from './BrandMark';
import { ThemeToggle } from './ThemeToggle';

/** Shared product navigation for all non-gameplay application surfaces. */
export function InternalHeader({ hideAccount = false, home = false }: { hideAccount?: boolean; home?: boolean } = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => menuButton.current?.focus(), 0);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  return <>
    {home ? null : <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>}
    <div className="stable-header-spacer" aria-hidden="true" data-home-region={home ? 'header' : undefined} />
    {createPortal(<header className="app-header stable-header">
      <Link aria-label="الخلية" className="wordmark" to="/"><BrandMark /></Link>
      <button aria-controls="internal-navigation" aria-expanded={menuOpen} className="app-header__menu-toggle" onClick={() => setMenuOpen(open => !open)} ref={menuButton} type="button">القائمة</button>
      <nav aria-label="التنقل الرئيسي" className={menuOpen ? 'is-open' : ''} id="internal-navigation">
        <NavLink end onClick={() => closeMenu()} to="/">الرئيسية</NavLink>
        <NavLink onClick={() => closeMenu()} to="/host/new">إنشاء مباراة</NavLink>
        <NavLink onClick={() => closeMenu()} to="/how-to-play">كيف تلعب؟</NavLink>
        <NavLink onClick={() => closeMenu()} to="/questions">الأسئلة</NavLink>
      </nav>
      <div className="app-header__utilities"><span className="stable-header__account" style={hideAccount ? { visibility: 'hidden' } : undefined}><AuthAccountControl iconOnly /></span><ThemeToggle compact iconOnly /></div>
    </header>, document.body)}
  </>;
}
