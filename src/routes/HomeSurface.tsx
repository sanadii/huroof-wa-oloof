import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { InternalHeader } from "../design-system/InternalHeader";
import { BrandMark } from "../design-system/BrandMark";
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
import {
  approvedCategoryPlayable,
  localCategoryPlayable,
} from "../data/category-playability";
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
  const categoryCatalogue = useMemo(
    () => gameRuntime.kind === "firebase"
      ? approvedCatalog ? catalogCategoryCovers(approvedCatalog.categories) : []
      : activeInventory ? inventoryCategoryCovers(activeInventory) : availableCategoryCatalog,
    [activeInventory, approvedCatalog],
  );
  const catalogue = useMemo(
    () => categoryCatalogue.filter((category) => {
      if (gameRuntime.kind === "firebase")
        return approvedCategoryPlayable(
          approvedCatalog?.categories.find((candidate) => candidate.id === category.id),
          "categories",
        );
      if (!activeInventory) return true;
      return localCategoryPlayable(
        inventoryById.get(category.id),
        "categories",
        activeInventory.huroofAvailable,
      );
    }),
    [activeInventory, approvedCatalog, categoryCatalogue, inventoryById],
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
              <Link to={`/host/new?kind=categories&category=${encodeURIComponent(category.id)}`}>
                <img alt="" src={category.cover.web320} />
                <strong>{category.displayNameAr}</strong>
                <span>{!activeInventory && gameRuntime.kind !== "firebase"
                  ? categoryReadinessLabel(category.questionReadiness)
                  : staticPreview
                    ? "محتوى محلي مدرج في معاينة الواجهة فقط"
                    : "جاهزة للعبة الفئات"}</span>
              </Link>
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
      <InternalHeader home hideAccount={staticPreview} />

      <section className="spatial-home__hero" data-home-region="spatial-stage" aria-labelledby="spatial-home-title">
        <div className="spatial-home__title">
          <BrandMark className="spatial-home__hero-mark" />
          <p className="spatial-home__eyebrow">لعبة معرفة عربية لفريقين</p>
          <h1 id="spatial-home-title">اجمع فريقك وابدأ التحدي</h1>
          <p>اختاروا الحروف أو الفئات، وتنافسوا في ليلة أسئلة خفيفة حتى تصنعوا المسار الفائز.</p>
          <Link className="button button--primary spatial-home__hero-action" to="/host/new">ابدأ مباراة</Link>
        </div>
      </section>
      </div>

      <section className="spatial-home__choices" aria-labelledby="game-choices-title">
        <div className="spatial-home__section-heading">
          <p className="spatial-home__eyebrow">اختاروا طريقتكم</p>
          <h2 id="game-choices-title">لعبتان، ووقت واحد ممتع</h2>
        </div>
        <div className="spatial-home__choice-grid">
          <Link className="spatial-home__choice spatial-home__choice--letters" to="/host/new?kind=huroof">
            <img alt="حروف" src="/assets/game-types/huroof.png" />
            <span className="spatial-home__choice-copy"><strong>حروف</strong><span>أجب عن سؤال يبدأ بالحرف الذي تختاره.</span></span>
          </Link>
          <Link className="spatial-home__choice spatial-home__choice--categories" to="/host/new?kind=categories">
            <img alt="بعض المجموعات" src="/assets/game-types/categories.png" />
            <span className="spatial-home__choice-copy"><strong>بعض المجموعات</strong><span>اختر فئة ونافس فريقك بأسئلتها.</span></span>
          </Link>
        </div>
      </section>

      <section className="spatial-home__join-band" data-home-region="create-join-dock" id="join-room" aria-labelledby="join-room-title">
        <div><p className="spatial-home__eyebrow">عندك رمز؟</p><h2 id="join-room-title">انضم إلى غرفة فريقك</h2><p>أدخل رمز الغرفة الذي شاركه معك المضيف.</p></div>
        <div className="spatial-home__join-form">{joinForm}{joinMessage}</div>
      </section>

      <CategoryChooser staticPreview={staticPreview} />

      <section className="spatial-home__how" aria-labelledby="how-title">
        <div><p className="spatial-home__eyebrow">بكل بساطة</p><h2 id="how-title">كيف تبدأون؟</h2></div>
        <ol><li><b>١</b><span>أنشئ غرفة واختر نوع المباراة.</span></li><li><b>٢</b><span>شارك رمز الغرفة مع الفريقين.</span></li><li><b>٣</b><span>ابدأوا وجمعوا المسار الفائز.</span></li></ol>
        <details><summary>هل أحتاج حساباً للعب؟</summary><p>لا. يمكنك إنشاء الغرفة أو الانضمام إليها كضيف، وحساب Google اختياري.</p></details>
      </section>

      <footer className="spatial-home__footer" data-home-region="footer">
        <p><BrandMark /> لعبة معرفة عربية مباشرة بلوحات الحروف والفئات.</p>
        <nav aria-label="روابط المساعدة"><Link to="/how-to-play">قواعد اللعب</Link><Link to="/host/new">إعداد مباراة</Link></nav>
      </footer>
    </main>
  );
}
