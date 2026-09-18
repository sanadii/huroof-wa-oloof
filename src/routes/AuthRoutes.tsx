import { Link, Navigate } from 'react-router-dom';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '../design-system/BrandMark';
import { InternalHeader } from '../design-system/InternalHeader';
import { useFirebaseAuth } from '../features/auth/AuthProvider';

function useDocumentTitle(title: string) {
  useEffect(() => { document.title = `${title} | الخلية`; }, [title]);
}

function AuthShell({ children }: { children: ReactNode }) {
  return <main className="auth-page spatial-auth" id="main-content"><InternalHeader /><section className="auth-panel">{children}</section><footer className="auth-page__footer"><BrandMark /><span>لعبة معرفة عربية لفريقين</span></footer></main>;
}

function statusCopy(status: ReturnType<typeof useFirebaseAuth>['status']) {
  return ({
    loading: 'جارٍ استعادة حالة تسجيل الدخول…',
    unavailable: 'تسجيل الدخول غير متاح في هذه النسخة حالياً.',
    signedOut: 'يمكنك المتابعة كضيف أو تسجيل الدخول عبر Google أو البريد الإلكتروني.',
    anonymous: 'أنت تلعب كضيف. ربط Google يحافظ على جلسة الغرفة الحالية؛ تسجيل الدخول بالبريد يبدّلها.',
    google: 'تم تسجيل الدخول عبر Google.',
    password: 'تم تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.',
    error: 'تحتاج محاولة تسجيل الدخول إلى انتباهك.',
  })[status];
}

export function LoginRoute() {
  useDocumentTitle('تسجيل الدخول');
  const { status, user, pendingAction, error, isAvailable, signInWithGoogle, signInWithEmailPassword, createEmailPasswordAccount } = useFirebaseAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const hasGoogleIdentity = Boolean(user && !user.isAnonymous);
  const disabled = !isAvailable || pendingAction !== null || status === 'loading';
  const submit = (action: 'signIn' | 'create') => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (action === 'signIn') void signInWithEmailPassword(email, password);
    else void createEmailPasswordAccount(email, password);
  };
  return <AuthShell>
    <p className="eyebrow">الحساب</p>
    <h1>سجّل دخولك عندما تحتاجه</h1>
    <p>سجّل عبر Google أو بالبريد الإلكتروني. اللعب وإنشاء الغرف متاحان للضيوف أيضاً.</p>
    <p className="auth-status" aria-live="polite">{error?.message ?? statusCopy(status)}</p>
    {hasGoogleIdentity ? <Link className="button button--primary" to="/account">إدارة الحساب</Link> : <>
      <button className="button button--primary auth-google-button" disabled={disabled} onClick={() => void signInWithGoogle()}>{pendingAction === 'signIn' ? 'جارٍ تسجيل الدخول…' : 'المتابعة مع Google'}</button>
      <form className="auth-email-form" onSubmit={submit('signIn')}>
        <label>البريد الإلكتروني<input autoComplete="email" dir="ltr" disabled={disabled} name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label>كلمة المرور<input autoComplete="current-password" dir="ltr" disabled={disabled} minLength={6} name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        <button className="button button--secondary" disabled={disabled} type="submit">تسجيل الدخول بالبريد</button>
        <button className="text-link auth-email-form__create" disabled={disabled} onClick={() => void createEmailPasswordAccount(email, password)} type="button">إنشاء حساب جديد وإرسال رسالة التحقق</button>
      </form>
    </>}
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
      <div><dt>طريقة الدخول</dt><dd>{user?.isAnonymous ? 'ضيف' : status === 'password' ? 'البريد الإلكتروني وكلمة المرور' : 'Google'}</dd></div>
      {user?.email ? <div><dt>البريد الإلكتروني</dt><dd dir="ltr">{user.email}</dd></div> : null}
      <div><dt>الحالة</dt><dd>{error?.message ?? statusCopy(status)}</dd></div>
    </dl>
    <p className="auth-impact">تسجيل الخروج لا يحذف الغرف، لكنه ينهي هويتك في Firebase وقد يؤثر في الغرفة النشطة على هذا الجهاز.</p>
    <button className="button button--secondary" disabled={pendingAction !== null} onClick={() => void signOut()}>{pendingAction === 'signOut' ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button>
    <Link className="text-link" to="/">العودة للرئيسية</Link>
  </AuthShell>;
}
