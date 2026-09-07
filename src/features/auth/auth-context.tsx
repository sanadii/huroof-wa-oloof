import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { AuthActionError } from './auth-service';

export type FirebaseAuthStatus = 'loading' | 'unavailable' | 'signedOut' | 'anonymous' | 'google' | 'error';
export type AuthPendingAction = 'signIn' | 'signOut' | null;

export type FirebaseAuthContextValue = {
  status: FirebaseAuthStatus;
  user: User | null;
  pendingAction: AuthPendingAction;
  error: AuthActionError | null;
  isAvailable: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const loadingAuthContext: FirebaseAuthContextValue = {
  status: 'loading', user: null, pendingAction: null, error: null, isAvailable: false,
  signInWithGoogle: async () => undefined, signOut: async () => undefined,
};

const unavailableAuthContext: FirebaseAuthContextValue = {
  status: 'unavailable', user: null, pendingAction: null, error: null, isAvailable: false,
  signInWithGoogle: async () => undefined, signOut: async () => undefined,
};

export const FirebaseAuthContext = createContext<FirebaseAuthContextValue>(unavailableAuthContext);

/** Keeps public routes interactive while the optional Firebase SDK loads in a separate chunk. */
export function DeferredFirebaseAuthProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [Provider, setProvider] = useState<((props: { children: ReactNode }) => ReactNode) | null>(null);
  useEffect(() => {
    if (!enabled || Provider) return undefined;
    let active = true;
    void import('./AuthProvider').then(({ FirebaseAuthProvider }) => { if (active) setProvider(() => FirebaseAuthProvider); });
    return () => { active = false; };
  }, [enabled, Provider]);
  if (Provider) return <Provider>{children}</Provider>;
  return <FirebaseAuthContext.Provider value={enabled ? loadingAuthContext : unavailableAuthContext}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth() { return useContext(FirebaseAuthContext); }
