import { Link } from 'react-router-dom';
import { useFirebaseAuth } from './auth-context';

/** Shared compact account control for game and home headers. */
export function AuthAccountControl({ iconOnly = false }: { iconOnly?: boolean } = {}) {
  const { status, user } = useFirebaseAuth();
  const label = status === 'loading' ? 'جارٍ استعادة الحساب…' : user && !user.isAnonymous ? user.displayName || 'الحساب' : user?.isAnonymous ? 'حساب الضيف' : 'تسجيل الدخول';
  const content = iconOnly ? <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg> : label;
  if (status === 'loading') return <span className="account-control" aria-label={iconOnly ? label : undefined} aria-live="polite">{content}</span>;
  return <Link className="account-control" aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} to={user && !user.isAnonymous ? '/account' : '/login'}>{content}</Link>;
}
