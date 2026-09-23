import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithPopup,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

export type AuthActionError = {
  code: string;
  message: string;
};

const googleProvider = new GoogleAuthProvider();

export function authErrorMessage(error: unknown): AuthActionError {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'auth/unknown';
  const messages: Record<string, string> = {
    'auth/popup-blocked': 'حظر المتصفح نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة ثم حاول مجدداً.',
    'auth/popup-closed-by-user': 'أُغلقت نافذة تسجيل الدخول قبل اكتمالها.',
    'auth/cancelled-popup-request': 'أُلغيت محاولة تسجيل الدخول. حاول مرة أخرى.',
    'auth/network-request-failed': 'تعذر الاتصال بالشبكة. تحقق من الاتصال ثم حاول مجدداً.',
    'auth/unauthorized-domain': 'هذا النطاق غير معتمد لتسجيل الدخول. تواصل مع دعم اللعبة.',
    'auth/operation-not-allowed': 'طريقة تسجيل الدخول هذه غير مفعّلة في Firebase لهذا التطبيق.',
    'auth/app-not-authorized': 'إعداد تطبيق تسجيل الدخول غير مكتمل على هذا النطاق.',
    'auth/invalid-api-key': 'إعداد تسجيل الدخول غير مكتمل حالياً.',
    'auth/credential-already-in-use': 'هذا الحساب مرتبط بجلسة أخرى. بقيت جلستك الضيف كما هي؛ استخدم حساب Google آخر أو تواصل مع الدعم.',
    'auth/account-exists-with-different-credential': 'هذا البريد مرتبط بطريقة دخول أخرى. بقيت جلستك الضيف كما هي؛ سجّل بالحساب المرتبط أو تواصل مع الدعم.',
    'auth/link-changed-user': 'تعذر ربط Google مع الحفاظ على جلسة الضيف. لم تُستبدل جلسة الضيف.',
    'auth/invalid-email': 'عنوان البريد الإلكتروني غير صالح.',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    'auth/email-already-in-use': 'هذا البريد مسجل بالفعل. استخدم تسجيل الدخول بدلاً من إنشاء حساب.',
    'auth/weak-password': 'اختر كلمة مرور أقوى، من ستة أحرف على الأقل.',
    'auth/too-many-requests': 'تم إيقاف المحاولات مؤقتاً. انتظر قليلاً ثم حاول مجدداً.',
  };
  const diagnosticCode = /^auth\/[a-z-]+$/.test(code) ? code : 'auth/unknown';
  return { code, message: messages[code] ?? `تعذر إتمام تسجيل الدخول حالياً. رمز الخطأ: ${diagnosticCode}` };
}

export async function signInWithEmailPassword(auth: Auth, email: string, password: string): Promise<User> {
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function createEmailPasswordAccount(auth: Auth, email: string, password: string): Promise<User> {
  const user = (await createUserWithEmailAndPassword(auth, email.trim(), password)).user;
  await sendEmailVerification(user);
  return user;
}

/** Links a guest session instead of replacing it, preserving its Firebase UID. */
export async function signInOrLinkGoogle(auth: Auth): Promise<User> {
  const currentUser = auth.currentUser;
  if (!currentUser) return (await signInWithPopup(auth, googleProvider)).user;
  if (!currentUser.isAnonymous && currentUser.providerData.some((provider) => provider.providerId === 'google.com')) return currentUser;
  if (!currentUser.isAnonymous) return currentUser;

  const uid = currentUser.uid;
  try {
    const result = await linkWithPopup(currentUser, googleProvider);
    if (result.user.uid !== uid) {
      throw { code: 'auth/link-changed-user' };
    }
    return result.user;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'auth/credential-already-in-use' && code !== 'auth/account-exists-with-different-credential') {
      throw error;
    }

    // The selected Google account already owns a Firebase user. A guest cannot
    // be linked to it, so switch intentionally to that existing account.
    await signOut(auth);
    return (await signInWithPopup(auth, googleProvider)).user;
  }
}

export async function signOutFirebaseUser(auth: Auth) {
  await signOut(auth);
}
