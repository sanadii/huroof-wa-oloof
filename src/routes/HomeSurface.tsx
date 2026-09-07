import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { AuthAccountControl } from "../features/auth/AuthAccountControl";
import { SpatialBoardScene } from "../features/board/SpatialBoardScene";
import { categoryCatalog } from "../data/category-catalog";
import { categoryReadinessLabel, matchModeOptions } from "../features/game/setup-options";

type HomeSurfaceProps = { joinForm: ReactNode; joinMessage: ReactNode };

function CategoryChooser() {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const categories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar");
    return normalized
      ? categoryCatalog.filter((category) => `${category.displayNameAr} ${category.id}`.toLocaleLowerCase("ar").includes(normalized))
      : categoryCatalog;
  }, [query]);

  return (
    <section className="spatial-home__catalogue" data-home-region="category-chooser" aria-labelledby="category-chooser-title">
      <div>
        <p className="spatial-home__eyebrow">الفئات المدعومة</p>
        <h2 id="category-chooser-title">اختر نقطة انطلاق للإعداد</h2>
        <p>تعكس حالة الجاهزية السجل المتاح حالياً. {categoryCatalog.length} فئة في السجل.</p>
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

export function HomeSurface({ joinForm, joinMessage }: HomeSurfaceProps) {
  return (
    <main className="spatial-home-page" id="main-content">
      <a className="skip-link" href="#join-room">تجاوز إلى الانضمام</a>
      <div className="spatial-home__stage-canvas">
      <header className="spatial-home__header" data-home-region="header">
        <Link className="wordmark" to="/">استوديو الحروف</Link>
        <nav aria-label="التنقل الرئيسي">
          <Link to="/" aria-current="page">الرئيسية</Link>
          <Link to="/how-to-play">كيف تلعب؟</Link>
        </nav>
        <div className="spatial-home__utilities">
          <AuthAccountControl />
          <a className="spatial-home__join-link" href="#join-room">انضمام</a>
          <details className="spatial-home__theme-details"><summary>المظهر</summary><ThemeToggle /></details>
        </div>
      </header>

      <section className="spatial-home__hero" data-home-region="spatial-stage" aria-labelledby="spatial-home-title">
        <div className="spatial-home__title">
          <p className="spatial-home__eyebrow">لعبة معرفة عربية لفريقين</p>
          <h1 id="spatial-home-title">حروف على مستوى آخر</h1>
          <p>خمسة وعشرون حرفاً، وفريقان يتسابقان بين طرفَي اللوح.</p>
        </div>
        <figure className="spatial-home__board">
          <SpatialBoardScene />
          <figcaption>الأحمر يمتد من اليسار إلى اليمين، والأخضر من الأعلى إلى الأسفل.</figcaption>
        </figure>
        <section className="spatial-home__dock" data-home-region="create-join-dock" id="join-room" aria-labelledby="join-room-title">
          <div className="spatial-home__create">
            <p className="spatial-home__eyebrow">ابدأ مباراة</p>
            <h2>اختر نمط اللعب</h2>
            <ul>
              {matchModeOptions.map((mode) => (
                <li key={mode.id}><Link to={`/host/new?mode=${mode.id}`}><strong>{mode.labelAr}</strong><span className="sr-only">{mode.descriptionAr}</span></Link></li>
              ))}
            </ul>
            <Link className="button button--primary" to="/host/new">أنشئ مباراة</Link>
          </div>
          <div className="spatial-home__join">
            <p className="spatial-home__eyebrow">لديك رمز؟</p>
            <h2 id="join-room-title">انضم إلى غرفة</h2>
            {joinForm}
            {joinMessage}
          </div>
        </section>
      </section>
      </div>

      <CategoryChooser />

      <footer className="spatial-home__footer" data-home-region="footer">
        <p><strong>استوديو الحروف</strong> لعبة معرفة عربية مباشرة لفريقين.</p>
        <nav aria-label="روابط المساعدة"><Link to="/how-to-play">قواعد اللعب</Link><Link to="/host/new">إعداد مباراة</Link></nav>
      </footer>
    </main>
  );
}
