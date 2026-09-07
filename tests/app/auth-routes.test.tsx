import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { FirebaseAuthProvider, useFirebaseAuth } from '../../src/features/auth/AuthProvider';
import { AccountRoute, LoginRoute } from '../../src/routes/AuthRoutes';

const authMocks = vi.hoisted(() => ({
  auth: null as { currentUser: unknown; authStateReady: () => Promise<void> } | null,
  change: undefined as ((user: unknown) => void) | undefined,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../src/lib/firebase/client', () => ({ getOptionalFirebaseAuth: () => authMocks.auth }));
vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  onAuthStateChanged: (_auth: unknown, change: (user: unknown) => void) => {
    authMocks.subscribe();
    authMocks.change = change;
    return authMocks.unsubscribe;
  },
  signOut: authMocks.signOut,
}));

const googleUser = { uid: 'google-1', isAnonymous: false, displayName: 'ليان', email: 'lian@example.test', providerData: [{ providerId: 'google.com' }] } as never;
const signedOutAuth = () => ({ currentUser: null, authStateReady: async () => undefined });

afterEach(() => {
  authMocks.auth = null;
  authMocks.change = undefined;
  vi.clearAllMocks();
});

it('renders unavailable login honestly without Firebase web configuration', () => {
  render(<MemoryRouter><FirebaseAuthProvider><LoginRoute /></FirebaseAuthProvider></MemoryRouter>);
  expect(screen.getByText(/إعداد Firebase العام غير مكتمل/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'المتابعة مع Google' })).toBeDisabled();
});

it('waits for restoration then renders a signed-out login', async () => {
  authMocks.auth = signedOutAuth();
  render(<MemoryRouter><FirebaseAuthProvider><LoginRoute /></FirebaseAuthProvider></MemoryRouter>);
  expect(screen.getByText('جارٍ استعادة حالة تسجيل الدخول…')).toBeVisible();
  await screen.findByText(/يمكنك المتابعة كضيف/);
  expect(screen.getByRole('button', { name: 'المتابعة مع Google' })).toBeEnabled();
});

it('shows basic Google identity fields and logs out without creating a guest', async () => {
  const auth = { currentUser: googleUser, authStateReady: async () => undefined };
  authMocks.auth = auth;
  render(<MemoryRouter><FirebaseAuthProvider><AccountRoute /></FirebaseAuthProvider></MemoryRouter>);
  await screen.findByText('ليان');
  expect(screen.getByText('lian@example.test')).toHaveAttribute('dir', 'ltr');
  await act(async () => { await screen.getByRole('button', { name: 'تسجيل الخروج' }).click(); });
  expect(authMocks.signOut).toHaveBeenCalledWith(auth);
  expect(screen.queryByText(/إنشاء جلسة ضيف/)).not.toBeInTheDocument();
});

it('cleans up the Auth observer when the provider unmounts', async () => {
  authMocks.auth = signedOutAuth();
  const view = render(<MemoryRouter><FirebaseAuthProvider><Probe /></FirebaseAuthProvider></MemoryRouter>);
  await screen.findByText('signedOut');
  view.unmount();
  expect(authMocks.unsubscribe).toHaveBeenCalled();
});

it('leaves the restoring state when Firebase cannot restore the session', async () => {
  authMocks.auth = {
    currentUser: null,
    authStateReady: async () => { throw new Error('restore failed'); },
  };
  render(<MemoryRouter><FirebaseAuthProvider><LoginRoute /><Probe /></FirebaseAuthProvider></MemoryRouter>);
  expect(await screen.findByText('error')).toBeVisible();
  expect(screen.getByText(/تعذر استعادة حالة تسجيل الدخول/)).toBeVisible();
});

function Probe() {
  return <span>{useFirebaseAuth().status}</span>;
}
