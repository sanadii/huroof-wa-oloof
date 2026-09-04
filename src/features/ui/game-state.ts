export const stateLabels: Record<string, string> = {
  LOBBY: 'الردهة', ROUND_SETUP: 'تجهيز الجولة', CELL_SELECTION: 'اختيار خلية',
  LETTER_REVEAL: 'كشف الحرف', QUESTION_READING: 'قراءة السؤال', FIRST_ANSWER: 'الإجابة الأولى',
  OPPONENT_CHANCE: 'فرصة الفريق الآخر', QUESTION_FAILED: 'لم تُقبل الإجابة',
  CELL_AWARDED: 'تثبيت الخلية', PATH_CHECK: 'فحص المسار', ROUND_COMPLETE: 'انتهاء الجولة',
  MATCH_COMPLETE: 'انتهاء المباراة', PAUSED: 'المباراة متوقفة', CORRECTION: 'تصحيح النتيجة',
};

export function stateLabel(state?: string) { return stateLabels[state ?? ''] ?? 'جارٍ تحديث حالة المباراة'; }

export function connectionLabel(connection: string) {
  return ({ connecting: 'جارٍ الاتصال', connected: 'متصل', reconnecting: 'جارٍ إعادة الاتصال', offline: 'دون اتصال', stale: 'تحتاج الحالة إلى تحديث' } as Record<string, string>)[connection] ?? 'جارٍ الاتصال';
}
