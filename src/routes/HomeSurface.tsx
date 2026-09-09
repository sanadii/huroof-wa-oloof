import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { AuthAccountControl } from "../features/auth/AuthAccountControl";
import { availableCategoryCatalog } from "../data/category-catalog";
import { categoryReadinessLabel, setupGameKindOptions } from "../features/game/setup-options";

type HomeSurfaceProps = {
  joinForm: ReactNode;
  joinMessage: ReactNode;
  staticPreview?: boolean;
};

function CategoryChooser() {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const categories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar");
    return normalized
      ? availableCategoryCatalog.filter((category) => `${category.displayNameAr} ${category.id}`.toLocaleLowerCase("ar").includes(normalized))
      : availableCategoryCatalog;
  }, [query]);

  return (
    <section className="spatial-home__catalogue" data-home-region="category-chooser" aria-labelledby="category-chooser-title">
      <div>
        <p className="spatial-home__eyebrow">الفئات المدعومة</p>
        <h2 id="category-chooser-title">اختر نقطة انطلاق للإعداد</h2>
        <p>تعكس حالة الجاهزية السجل المتاح حالياً. {availableCategoryCatalog.length} فئات تحتوي على أسئلة.</p>
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
              <Link to={`/host/new?category=${encodeURIComponent(category.id)}`}>
                <strong>{category.displayNameAr}</strong>
                <span>{categoryReadinessLabel(category.questionReadiness)}</span>
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
    </section>
  );
}

export function HomeSurface({ joinForm, joinMessage, staticPreview = false }: HomeSurfaceProps) {
  const [gameKind, setGameKind] = useState('huroof');
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
        </div>
        <div className="spatial-home__dock spatial-home__action-cards" data-home-region="create-join-dock">
          <section className="spatial-home__create" aria-labelledby="create-room-title">
            <h2 id="create-room-title">أنشئ مباراة جديدة</h2>
            <div className="spatial-home__kind-picker" role="radiogroup" aria-labelledby="home-game-kind-label">
              <strong id="home-game-kind-label">اختر نوع اللوح</strong>
              {setupGameKindOptions.map((kind) => (
                <label key={kind.id}>
                  <input type="radio" name="home-game-kind" value={kind.id} checked={gameKind === kind.id} onChange={() => setGameKind(kind.id)} />
                  <span>{kind.labelAr}</span>
                </label>
              ))}
            </div>
            <Link className="button button--primary" to={`/host/new?kind=${gameKind}&mode=classic`}>{staticPreview ? "عرض إعداد المباراة" : "أنشئ مباراة"}</Link>
          </section>
          <section className="spatial-home__join" id="join-room" aria-labelledby="join-room-title">
            <h2 id="join-room-title">انضم إلى غرفة</h2>
            {joinForm}
            {joinMessage}
          </section>
        </div>
      </section>
      </div>

      <CategoryChooser />

      <footer className="spatial-home__footer" data-home-region="footer">
        <p><strong>تحدي الخلية</strong> لعبة معرفة عربية مباشرة بلوحات الحروف والفئات.</p>
        <nav aria-label="روابط المساعدة"><Link to="/how-to-play">قواعد اللعب</Link><Link to="/host/new">إعداد مباراة</Link></nav>
      </footer>
    </main>
  );
}
