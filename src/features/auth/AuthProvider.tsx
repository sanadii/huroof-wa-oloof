import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { getOptionalFirebaseAuth } from '../../lib/firebase/client';
import { authErrorMessage, createEmailPasswordAccount, signInOrLinkGoogle, signInWithEmailPassword, signOutFirebaseUser, type AuthActionError } from './auth-service';
import { FirebaseAuthContext, type AuthPendingAction, type FirebaseAuthContextValue, type FirebaseAuthStatus, useFirebaseAuth } from './auth-context';

function userStatus(user: User | null): Exclude<FirebaseAuthStatus, 'loading' | 'unavailable' | 'error'> {
  if (!user) return 'signedOut';
  if (user.isAnonymous) return 'anonymous';
  return user.providerData.some((provider) => provider.providerId === 'password') ? 'password' : 'google';
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FirebaseAuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [pendingAction, setPendingAction] = useState<AuthPendingAction>(null);
  const [error, setError] = useState<AuthActionError | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const actionQueue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    let auth: Auth | null;
    try {
      auth = getOptionalFirebaseAuth();
    } catch {
      setIsAvailable(false);
      setStatus('error');
      setError({ code: 'auth/configuration-failed', message: 'تعذر تهيئة تسجيل الدخول حالياً. تحقق من إعداد Firebase العام.' });
      return undefined;
    }
    authRef.current = auth;
    if (!auth) {
      setIsAvailable(false);
      setStatus('unavailable');
      return undefined;
    }
    setIsAvailable(true);
    let restored = false;
    const applyUser = (nextUser: User | null) => {
      if (!active) return;
      setUser(nextUser);
      setError(null);
      if (restored) setStatus(userStatus(nextUser));
    };
    const unsubscribe = onAuthStateChanged(auth, applyUser, () => {
      if (!active) return;
      setUser(auth.currentUser);
      setStatus('error');
      setError({ code: 'auth/observer-failed', message: 'تعذر استعادة حالة تسجيل الدخول. حدّث الصفحة ثم حاول مجدداً.' });
    });
    void auth.authStateReady().then(() => {
      restored = true;
      applyUser(auth.currentUser);
    }).catch(() => {
      if (!active) return;
      setUser(auth.currentUser);
      setStatus('error');
      setError({ code: 'auth/restore-failed', message: 'تعذر استعادة حالة تسجيل الدخول. حدّث الصفحة ثم حاول مجدداً.' });
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const runAction = (pending: Exclude<AuthPendingAction, null>, action: (auth: Auth) => Promise<void>) => {
    const run = actionQueue.current.then(async () => {
      const auth = authRef.current;
      if (!auth) {
        setStatus('unavailable');
        return;
      }
      setPendingAction(pending);
      setError(null);
      try {
        await action(auth);
        setUser(auth.currentUser);
        setStatus(userStatus(auth.currentUser));
      } catch (caught) {
        const nextError = authErrorMessage(caught);
        setUser(auth.currentUser);
        setStatus('error');
        setError(nextError);
      } finally {
        setPendingAction(null);
      }
    });
    actionQueue.current = run.catch(() => undefined);
    return run;
  };

  const value = useMemo<FirebaseAuthContextValue>(() => ({
    status,
    user,
    pendingAction,
    error,
    isAvailable,
    signInWithGoogle: () => runAction('signIn', async (auth) => { await signInOrLinkGoogle(auth); }),
    signInWithEmailPassword: (email, password) => runAction('signIn', async (auth) => { await signInWithEmailPassword(auth, email, password); }),
    createEmailPasswordAccount: (email, password) => runAction('signIn', async (auth) => { await createEmailPasswordAccount(auth, email, password); }),
    signOut: () => runAction('signOut', signOutFirebaseUser),
  }), [status, user, pendingAction, error, isAvailable]);
  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export { useFirebaseAuth };
