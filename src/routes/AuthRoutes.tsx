import { Link, Navigate } from 'react-router-dom';
import { type ReactNode, useEffect } from 'react';
import { useFirebaseAuth } from '../features/auth/AuthProvider';

function useDocumentTitle(title: string) {
  useEffect(() => { document.title = `${title} | تحدي الخلية`; }, [title]);
}

function AuthShell({ children }: { children: ReactNode }) {
  return <main className="auth-page spatial-auth" id="main-content"><section className="auth-panel">{children}</section></main>;
}

function statusCopy(status: ReturnType<typeof useFirebaseAuth>['status']) {
  return ({
    loading: 'جارٍ استعادة حالة تسجيل الدخول…',
    unavailable: 'تسجيل الدخول غير متاح في هذه النسخة لأن إعداد Firebase العام غير مكتمل.',
    signedOut: 'يمكنك المتابعة كضيف أو تسجيل الدخول لحفظ هوية جلسة Firebase.',
    anonymous: 'أنت في جلسة ضيف. ربط Google يحافظ على معرّف جلسة الغرفة نفسه.',
    google: 'تم تسجيل الدخول عبر Google.',
    error: 'تحتاج محاولة تسجيل الدخول إلى انتباهك.',
  })[status];
}

export function LoginRoute() {
  useDocumentTitle('تسجيل الدخول');
  const { status, user, pendingAction, error, isAvailable, signInWithGoogle } = useFirebaseAuth();
  const hasGoogleIdentity = Boolean(user && !user.isAnonymous);
  const hasGuestIdentity = Boolean(user?.isAnonymous);
  return <AuthShell>
    <p className="eyebrow">الحساب</p>
    <h1>سجّل دخولك عندما تحتاجه</h1>
    <p>استخدم Google لتعريف حسابك. اللعب وإنشاء الغرف متاحان للضيوف أيضاً.</p>
    <p className="auth-status" aria-live="polite">{error?.message ?? statusCopy(status)}</p>
    {hasGoogleIdentity ? <Link className="button button--primary" to="/account">إدارة الحساب</Link> : <button className="button button--primary auth-google-button" disabled={!isAvailable || pendingAction !== null || status === 'loading'} onClick={() => void signInWithGoogle()}>{pendingAction === 'signIn' ? 'جارٍ فتح Google…' : hasGuestIdentity ? 'ربط Google بجلسة الضيف' : 'المتابعة مع Google'}</button>}
    <Link className="text-link" to="/">العب كضيف أو عُد للرئيسية</Link>
  </AuthShell>;
}

export function AccountRoute() {
  useDocumentTitle('الحساب');
  const { status, user, pendingAction, error, signOut } = useFirebaseAuth();
  if (status === 'loading') return <AuthShell><p className="auth-status" role="status">جارٍ استعادة الحساب…</p></AuthShell>;
  if (!user) return <Navigate replace to="/login" />;
  return <AuthShell>
    <p className="eyebrow">الحساب</p>
    <h1>{user?.displayName || (status === 'anonymous' ? 'جلسة ضيف' : 'الحساب')}</h1>
    <dl className="account-details">
      <div><dt>طريقة الدخول</dt><dd>{user?.isAnonymous ? 'ضيف' : 'Google'}</dd></div>
      {user?.email ? <div><dt>البريد الإلكتروني</dt><dd dir="ltr">{user.email}</dd></div> : null}
      <div><dt>الحالة</dt><dd>{error?.message ?? statusCopy(status)}</dd></div>
    </dl>
    <p className="auth-impact">تسجيل الخروج لا يحذف الغرف، لكنه ينهي هويتك في Firebase وقد يؤثر في الغرفة النشطة على هذا الجهاز.</p>
    <button className="button button--secondary" disabled={pendingAction !== null} onClick={() => void signOut()}>{pendingAction === 'signOut' ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button>
    <Link className="text-link" to="/">العودة للرئيسية</Link>
  </AuthShell>;
}
