import { type ReactNode, useEffect, useState } from 'react';
import { InternalHeader } from '../design-system/InternalHeader';

type Item = { incomingId: string; categoryId: string; outcome: string; reason: string; storageState: string };
type Page = { runKind: string; after: Record<string, number>; outcomes: Record<string, number>; total: number; offset: number; limit: number; categories: string[]; items: Item[] };
type Detail = { incomingId: string; mode: string; question: string | null; instruction: string | null; answer: string; acceptedAnswers: string[]; letterModeEligible: boolean | null; stagingState?: string; storageState: string; currentStored?: { id: string; prompt?: string; answer?: string }; media?: { assetSha256: string; altAr: string } };

function LocalReviewFrame({ children }: { children: ReactNode }) {
  return <main className="local-import-review" dir="rtl" id="main-content">
    <InternalHeader />
    {children}
  </main>;
}

export const LocalImportReviewRoute = () => {
  const [page, setPage] = useState<Page | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [category, setCategory] = useState('');
  const [outcome, setOutcome] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');
  const load = () => {
    setState('loading');
    const params = new URLSearchParams({ limit: '40', offset: String(offset) });
    if (category) params.set('category', category);
    if (outcome) params.set('outcome', outcome);
    if (query) params.set('q', query);
    void fetch(`/api/local-import-review?${params}`, { cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('IMPORT_REVIEW_UNAVAILABLE'); return response.json() as Promise<Page>; })
      .then(next => { setPage(next); setState('ready'); setSelected(null); })
      .catch(() => setState('error'));
  };
  useEffect(() => { load(); }, [category, outcome, query, offset]);
  const filters = (setter: (value: string) => void) => (value: string) => { setOffset(0); setter(value); };
  const reveal = (id: string) => {
    setDetailState('loading');
    void fetch(`/api/local-import-review/entries/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('IMPORT_REVIEW_DETAIL_UNAVAILABLE'); return response.json() as Promise<Detail>; })
      .then(next => { setSelected(next); setDetailState('idle'); })
      .catch(() => setDetailState('error'));
  };
  if (state === 'loading' && !page) return <LocalReviewFrame><section className="local-import-review__notice" aria-labelledby="local-review-loading"><p className="eyebrow">محلي فقط</p><h1 id="local-review-loading">جارٍ تحميل سجل الاستيراد</h1><p role="status">نُحضّر سجل المصدر للقراءة فقط.</p></section></LocalReviewFrame>;
  if (state === 'error') return <LocalReviewFrame><section className="local-import-review__notice" aria-labelledby="local-review-error" role="alert"><p className="eyebrow">محلي فقط</p><h1 id="local-review-error">تعذر فتح سجل الاستيراد</h1><p>لا يتوفر سجل الاستيراد المحلي أو لا يطابق هذا الطلب حماية السطح المحلي.</p><button className="button button--secondary" onClick={load} type="button">أعد المحاولة</button></section></LocalReviewFrame>;
  if (!page) return null;
  return <LocalReviewFrame>
    <section className="local-import-review__intro"><p className="eyebrow">محلي فقط · مراجعة قراءة فقط</p><h1>مراجعة استيراد البنك المحفوظ</h1><p>يعرض هذا السطح سجل المصدر وقاعدة SQLite الحالية. لا يمنح موافقة ولا يضيف أسئلة إلى اللعب.</p></section>
    <dl className="local-import-review__counts"><div><dt>المخزن الحالي</dt><dd>{page.after.stored ?? 0}</dd></div><div><dt>المسودات</dt><dd>{page.after.drafts ?? 0}</dd></div><div><dt>المعتمد</dt><dd>{page.after.approved ?? 0}</dd></div><div><dt>المخزون المعتمد للعب</dt><dd>{page.after.normalApprovedGameplayPool ?? 0}</dd></div></dl>
    <p className="local-import-review__notice">نتائج المصدر: {Object.entries(page.outcomes).map(([name, count]) => `${name}: ${count}`).join(' · ')}. السجلات المرحّلة تحتاج مراجعة ولا تُعد قابلة للعب.</p>
    <section className="local-import-review__filters" aria-label="تصفية سجل الاستيراد"><label>الفئة<select value={category} onChange={event => filters(setCategory)(event.target.value)}><option value="">كل الفئات</option>{page.categories.map(id => <option key={id} value={id}>{id}</option>)}</select></label><label>النتيجة<select value={outcome} onChange={event => filters(setOutcome)(event.target.value)}><option value="">كل النتائج</option>{Object.keys(page.outcomes).map(name => <option key={name} value={name}>{name}</option>)}</select></label><label>بحث<input aria-label="بحث في سجل الاستيراد" value={query} onChange={event => filters(setQuery)(event.target.value)} /></label></section>
    <p aria-live="polite">{page.total} سجل مصدر · نوع التشغيل: {page.runKind}</p>
    {page.items.length ? <div className="local-import-review__table-wrap"><div className="local-import-review__table" role="table" aria-label="سجل استيراد محلي"><div role="row" className="local-import-review__row local-import-review__row--head"><b role="columnheader">المعرف</b><b role="columnheader">الفئة</b><b role="columnheader">النتيجة</b><b role="columnheader">الحفظ الحالي</b><b role="columnheader">تفاصيل</b></div>{page.items.map(item => <div role="row" className="local-import-review__row" key={item.incomingId}><span role="cell"><bdi dir="ltr">{item.incomingId}</bdi></span><span role="cell"><bdi dir="ltr">{item.categoryId}</bdi></span><span role="cell">{item.outcome}</span><span role="cell">{item.storageState}</span><span role="cell"><button className="button button--secondary" type="button" onClick={() => reveal(item.incomingId)}>كشف المراجعة</button></span></div>)}</div></div> : <p className="local-import-review__notice">لا توجد سجلات ضمن هذه التصفية.</p>}
    <nav className="local-import-review__pager" aria-label="صفحات سجل الاستيراد"><button className="button button--secondary" disabled={page.offset === 0} onClick={() => setOffset(Math.max(0, page.offset - page.limit))} type="button">السابق</button><span>{page.offset + 1}–{Math.min(page.offset + page.items.length, page.total)} من {page.total}</span><button className="button button--secondary" disabled={page.offset + page.limit >= page.total} onClick={() => setOffset(page.offset + page.limit)} type="button">التالي</button></nav>
    {detailState === 'loading' ? <p role="status">جارٍ تحميل الإجابة المحفوظة…</p> : detailState === 'error' ? <p role="alert">تعذر تحميل تفاصيل السجل.</p> : selected ? <section className="local-import-review__detail" aria-live="polite"><h2>تفاصيل مراجعة قراءة فقط</h2><p>{selected.stagingState ? `سبب الترحيل: ${selected.stagingState}` : 'سجل مصدر محفوظ للمراجعة.'}</p><p><b>الحفظ الحالي:</b> {selected.storageState}</p><p><b>النمط:</b> {selected.mode}</p>{selected.question ? <p><b>السؤال الأصلي:</b> {selected.question}</p> : null}{selected.instruction ? <p><b>تعليمات المؤدي الأصلية:</b> {selected.instruction}</p> : null}<p><b>إجابة المصدر المكشوفة:</b> {selected.answer}</p>{selected.currentStored ? <p><b>السجل المحفوظ الحالي:</b> {selected.currentStored.prompt ?? 'لا يوجد نص'} · {selected.currentStored.answer ?? 'لا توجد إجابة'}</p> : null}<p><b>الإجابات المقبولة:</b> {selected.acceptedAnswers.join('، ')}</p><p><b>أهلية الحرف:</b> {selected.letterModeEligible === null ? 'غير معروفة ومحفوظة كما وردت' : selected.letterModeEligible ? 'مذكورة في المصدر' : 'غير مؤهلة في المصدر'}</p>{selected.media ? <img alt={selected.media.altAr} className="local-import-review__media" src={`/api/local-import-review/entries/${encodeURIComponent(selected.incomingId)}/media?sha=${selected.media.assetSha256}`} /> : null}</section> : null}
  </LocalReviewFrame>;
};
