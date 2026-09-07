import { Link } from 'react-router-dom';
import { useFirebaseAuth } from './auth-context';

/** Shared compact account control for game and home headers. */
export function AuthAccountControl() {
  const { status, user } = useFirebaseAuth();
  if (status === 'loading') return <span className="account-control" aria-live="polite">جارٍ استعادة الحساب…</span>;
  if (user && !user.isAnonymous) return <Link className="account-control" to="/account">{user.displayName || 'الحساب'}</Link>;
  if (user?.isAnonymous) return <Link className="account-control" to="/login">حساب الضيف</Link>;
  return <Link className="account-control" to="/login">تسجيل الدخول</Link>;
}
