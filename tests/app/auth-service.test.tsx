import { afterEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  linkWithPopup: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  GoogleAuthProvider: class GoogleAuthProvider {},
  createUserWithEmailAndPassword: firebaseMocks.createUserWithEmailAndPassword,
  linkWithPopup: firebaseMocks.linkWithPopup,
  sendEmailVerification: firebaseMocks.sendEmailVerification,
  signInWithEmailAndPassword: firebaseMocks.signInWithEmailAndPassword,
  signInWithPopup: firebaseMocks.signInWithPopup,
  signOut: firebaseMocks.signOut,
}));

import { authErrorMessage, createEmailPasswordAccount, signInOrLinkGoogle, signInWithEmailPassword, signOutFirebaseUser } from '../../src/features/auth/auth-service';

const user = (uid: string, isAnonymous: boolean) => ({
  uid,
  isAnonymous,
  providerData: isAnonymous ? [] : [{ providerId: 'google.com' }],
}) as never;

afterEach(() => vi.clearAllMocks());

describe('Google auth service', () => {
  it('uses a popup sign-in only when no Firebase user exists', async () => {
    const signedIn = user('google-user', false);
    firebaseMocks.signInWithPopup.mockResolvedValue({ user: signedIn });
    await expect(signInOrLinkGoogle({ currentUser: null } as never)).resolves.toBe(signedIn);
    expect(firebaseMocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(firebaseMocks.linkWithPopup).not.toHaveBeenCalled();
  });

  it('links an anonymous user and verifies that the UID is retained', async () => {
    const guest = user('guest-uid', true);
    const linked = user('guest-uid', false);
    firebaseMocks.linkWithPopup.mockResolvedValue({ user: linked });
    await expect(signInOrLinkGoogle({ currentUser: guest } as never)).resolves.toBe(linked);
    expect(firebaseMocks.linkWithPopup).toHaveBeenCalledWith(guest, expect.anything());
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('switches a guest session to its existing Google account on a credential collision', async () => {
    const guest = user('guest-uid', true);
    const googleUser = user('google-user', false);
    firebaseMocks.linkWithPopup.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    firebaseMocks.signInWithPopup.mockResolvedValue({ user: googleUser });
    await expect(signInOrLinkGoogle({ currentUser: guest } as never)).resolves.toBe(googleUser);
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
    expect(firebaseMocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(authErrorMessage({ code: 'auth/popup-blocked' }).message).toContain('حظر المتصفح');
  });

  it('is idempotent for a Google user and signs out only when requested', async () => {
    const googleUser = user('google-user', false);
    await expect(signInOrLinkGoogle({ currentUser: googleUser } as never)).resolves.toBe(googleUser);
    expect(firebaseMocks.linkWithPopup).not.toHaveBeenCalled();
    await signOutFirebaseUser({} as never);
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
  });
});

describe('email/password auth service', () => {
  it('signs in using the trimmed email address', async () => {
    const signedIn = user('password-user', false);
    firebaseMocks.signInWithEmailAndPassword.mockResolvedValue({ user: signedIn });
    await expect(signInWithEmailPassword({} as never, ' admin@example.test ', 'password')).resolves.toBe(signedIn);
    expect(firebaseMocks.signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'admin@example.test', 'password');
  });

  it('creates an account and sends a verification email', async () => {
    const created = user('password-user', false);
    firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user: created });
    await expect(createEmailPasswordAccount({} as never, 'admin@example.test', 'password')).resolves.toBe(created);
    expect(firebaseMocks.sendEmailVerification).toHaveBeenCalledWith(created);
  });
});
