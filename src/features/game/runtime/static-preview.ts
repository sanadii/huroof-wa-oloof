/**
 * Static hosting has no room authority, database, or local service. This flag
 * is intentionally opt-in so localhost fixture and Firebase runtimes keep
 * their existing behavior.
 */
export const isStaticPreviewBuild = (
  value = import.meta.env.VITE_STATIC_PREVIEW,
) => value === "true";

export const staticPreviewNotice =
  "هذه معاينة منشورة للواجهة فقط. إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا.";
