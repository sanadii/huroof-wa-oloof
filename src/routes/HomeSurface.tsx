import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { AuthAccountControl } from "../features/auth/AuthAccountControl";
import { gameRuntime } from "../features/game/runtime";
import { availableCategoryCatalog } from "../data/category-catalog";
import {
  catalogCategoryCovers,
  fetchLocalQuestionInventory,
  inventoryCategoryCovers,
  staticPreviewQuestionInventory,
  type LocalQuestionInventory,
} from "../data/local-question-inventory";
import type { ApprovedReleaseCatalog } from "../features/game/runtime/contracts";
import { categoryReadinessLabel } from "../features/game/setup-options";

type HomeSurfaceProps = {
  joinForm: ReactNode;
  joinMessage: ReactNode;
  staticPreview?: boolean;
};

function CategoryChooser({ staticPreview }: { staticPreview: boolean }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [inventory, setInventory] = useState<LocalQuestionInventory>();
  const [inventoryError, setInventoryError] = useState("");
  const [approvedCatalog, setApprovedCatalog] = useState<ApprovedReleaseCatalog>();
  const [approvedCatalogError, setApprovedCatalogError] = useState("");
  const [approvedCatalogAttempt, setApprovedCatalogAttempt] = useState(0);
  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "local") return;
    let active = true;
    void fetchLocalQuestionInventory()
      .then((next) => {
        if (!active) return;
        setInventory(next);
        setInventoryError("");
      })
      .catch(() => {
        if (active) setInventoryError("تعذر تحديث فهرس الفئات المحلي.");
      });
    return () => {
      active = false;
    };
  }, [staticPreview]);
  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "firebase") return;
    let active = true;
    void (gameRuntime.getApprovedReleaseCatalog?.() ?? Promise.reject(new Error("APPROVED_RELEASE_CATALOG_UNAVAILABLE")))
      .then((catalog) => { if (active) { setApprovedCatalog(catalog); setApprovedCatalogError(""); } })
      .catch(() => { if (active) { setApprovedCatalog(undefined); setApprovedCatalogError("لا تتوفر حزمة معتمدة نشطة للعب المباشر حالياً."); } });
    return () => { active = false; };
  }, [approvedCatalogAttempt, staticPreview]);
  const activeInventory = inventory ?? (staticPreview ? staticPreviewQuestionInventory : undefined);
  const inventoryById = useMemo(
    () => new Map(activeInventory?.categories.map((category) => [category.id, category]) ?? []),
    [activeInventory],
  );
  const catalogue = useMemo(
    () => gameRuntime.kind === "firebase"
      ? approvedCatalog ? catalogCategoryCovers(approvedCatalog.categories) : []
      : activeInventory ? inventoryCategoryCovers(activeInventory) : availableCategoryCatalog,
    [activeInventory, approvedCatalog],
  );
  const categories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar");
    return normalized
      ? catalogue.filter((category) => `${category.displayNameAr} ${category.id}`.toLocaleLowerCase("ar").includes(normalized))
      : catalogue;
  }, [catalogue, query]);

  return (
    <section className="spatial-home__catalogue" data-home-region="category-chooser" aria-labelledby="category-chooser-title">
      <div>
        <p className="spatial-home__eyebrow">فهرس الفئات</p>
        <h2 id="category-chooser-title">اختر نقطة انطلاق للإعداد</h2>
        <p>تعكس حالة الجاهزية السجل المتاح حالياً. {catalogue.length} فئة في الفهرس.</p>
      </div>
      <label className="spatial-home__filter">
        <span>تصفية الفئات</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الفئة" />
      </label>
      {categories.length === 0 ? (
        <p className="spatial-home__empty" role="status">لا توجد فئات مطابقة للبحث. امسح البحث لعرض الفئات المتاحة.</p>
      ) : (
        <ul className="spatial-home__categories">
          {categories.slice(0, showAll || query ? categories.length : 8).map((category) => (
            <li key={category.id}>
              {(() => {
                const localCategory = inventoryById.get(category.id);
                const approvedCategory = approvedCatalog?.categories.find((candidate) => candidate.id === category.id);
                const selectable = gameRuntime.kind === "firebase"
                  ? approvedCategory?.playable.categories === true
                  : !localCategory || localCategory.categoryGameEligible;
                const status = gameRuntime.kind === "firebase"
                  ? approvedCategory?.playable.categories
                    ? "جاهزة للعبة الفئات"
                    : "لا تكفي للعبة الفئات في الحزمة المعتمدة"
                  : localCategory
                  ? localCategory.availability === "held_only"
                    ? "قيد المراجعة — غير متاحة للعب"
                    : localCategory.categoryGameEligible
                      ? staticPreview
                        ? "محتوى محلي مدرج في معاينة الواجهة فقط"
                        : "جاهزة للعبة الفئات"
                      : "لا تكفي للعبة الفئات بعد"
                  : categoryReadinessLabel(category.questionReadiness);
                const content = <><strong>{category.displayNameAr}</strong><span>{status}</span></>;
                return selectable ? (
                  <Link to={`/host/new?kind=categories&category=${encodeURIComponent(category.id)}`}>
                    {content}
                  </Link>
                ) : (
                  <span aria-disabled="true" className="spatial-home__category-unavailable">
                    {content}
                  </span>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
      {!query && categories.length > 8 ? (
        <button className="spatial-home__show-more" onClick={() => setShowAll((current) => !current)} type="button">
          {showAll ? "عرض الفئات المختصرة" : `عرض كل الفئات (${categories.length})`}
        </button>
      ) : null}
      {inventoryError ? <p className="spatial-home__empty" role="status">{inventoryError}</p> : null}
      {gameRuntime.kind === "firebase" && !approvedCatalog ? <p className="spatial-home__empty" role="status">{approvedCatalogError || "جارٍ التحقق من فهرس الحزمة المعتمدة…"} {approvedCatalogError ? <button className="spatial-home__show-more" onClick={() => setApprovedCatalogAttempt((attempt) => attempt + 1)} type="button">أعد المحاولة</button> : null}</p> : null}
    </section>
  );
}

export function HomeSurface({ joinForm, joinMessage, staticPreview = false }: HomeSurfaceProps) {
  return (
    <main className="spatial-home-page" id="main-content">
      <a className="skip-link" href="#join-room">تجاوز إلى الانضمام</a>
      <div className="spatial-home__stage-canvas">
      <header className="spatial-home__header" data-home-region="header">
        <Link className="wordmark" to="/">تحدي الخلية</Link>
        <nav aria-label="التنقل الرئيسي">
          <Link to="/" aria-current="page">الرئيسية</Link>
          <Link to="/how-to-play">كيف تلعب؟</Link>
        </nav>
        <div className="spatial-home__utilities">
          {staticPreview ? null : <AuthAccountControl />}
          <a className="spatial-home__join-link" href="#join-room">انضمام</a>
          <details className="spatial-home__theme-details"><summary>المظهر</summary><ThemeToggle /></details>
        </div>
      </header>

      <section className="spatial-home__hero" data-home-region="spatial-stage" aria-labelledby="spatial-home-title">
        <div className="spatial-home__title">
          <p className="spatial-home__eyebrow">لعبة معرفة عربية لفريقين</p>
          <h1 id="spatial-home-title">تحدي الخلية</h1>
          <p>اختر لوحة الحروف أو الفئات، ثم تنافسوا لصنع المسار الفائز.</p>
          <p className="spatial-home__title-context">اجمع فريقك، وابدأ التحدي.</p>
        </div>
        <div className="spatial-home__dock spatial-home__action-cards" data-home-region="create-join-dock">
          <section className="spatial-home__create" aria-labelledby="create-room-title">
            <h2 id="create-room-title">أنشئ مباراة جديدة</h2>
            <p className="spatial-home__section-intro">ابدأ إعداد مباراة لفريقين، ثم اختر نوع اللوح والتفاصيل المناسبة.</p>
            <Link className="button button--primary" to="/host/new">{staticPreview ? "عرض إعداد المباراة" : "أنشئ مباراة"}</Link>
          </section>
          <section className="spatial-home__join" id="join-room" aria-labelledby="join-room-title">
            <h2 id="join-room-title">انضم إلى غرفة</h2>
            {joinForm}
            {joinMessage}
          </section>
        </div>
      </section>
      </div>

      <CategoryChooser staticPreview={staticPreview} />

      <footer className="spatial-home__footer" data-home-region="footer">
        <p><strong>تحدي الخلية</strong> لعبة معرفة عربية مباشرة بلوحات الحروف والفئات.</p>
        <nav aria-label="روابط المساعدة"><Link to="/how-to-play">قواعد اللعب</Link><Link to="/host/new">إعداد مباراة</Link></nav>
      </footer>
    </main>
  );
}
