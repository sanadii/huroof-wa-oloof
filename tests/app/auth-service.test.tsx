import { afterEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  linkWithPopup: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  GoogleAuthProvider: class GoogleAuthProvider {},
  linkWithPopup: firebaseMocks.linkWithPopup,
  signInWithPopup: firebaseMocks.signInWithPopup,
  signOut: firebaseMocks.signOut,
}));

import { authErrorMessage, signInOrLinkGoogle, signOutFirebaseUser } from '../../src/features/auth/auth-service';

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

  it('keeps the guest path on a credential collision and gives Arabic guidance', async () => {
    const guest = user('guest-uid', true);
    firebaseMocks.linkWithPopup.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    await expect(signInOrLinkGoogle({ currentUser: guest } as never)).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
    expect(authErrorMessage({ code: 'auth/credential-already-in-use' }).message).toContain('بقيت جلستك الضيف كما هي');
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
