import React from "react";
import { Link } from "react-router-dom";
import { InternalHeader } from "../design-system/InternalHeader";

/** Public attribution surface for image assets whose release review permits use. */
export function MediaCreditsRoute() {
  return (
    <main className="app-page spatial-shell" id="main-content">
      <InternalHeader />
      <section className="setup-page spatial-setup" aria-labelledby="media-credits-title">
        <div>
          <p className="eyebrow">حقوق الوسائط</p>
          <h1 id="media-credits-title">اعتمادات الصور</h1>
          <p>تظهر هذه الصفحة لاعبي اللعبة اعتمادات الصور المستخدمة بعد اكتمال مراجعتها وإدراجها في إصدار معتمد.</p>
          <h2>OpenMoji</h2>
          <p>
            بعض رسوم الصور مشتقة من <a href="https://openmoji.org/" rel="noreferrer" target="_blank">OpenMoji</a> — HfG Schwäbisch Gmünd والمساهمون،
            بموجب <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer" target="_blank">CC BY-SA 4.0</a>.
          </p>
          <p>
            مصدر الرسوم هو <a href="https://github.com/hfg-gmuend/openmoji/tree/aeb8bb3a59e2de39c754ac79180c8131c906acea/color/svg" rel="noreferrer" target="_blank">مراجعة OpenMoji المثبتة</a>.
            حُوّلت الرسوم إلى PNG، وقد تُقص بعض الصور لتكون مناسبة للسؤال؛ هذه تعديلات على الأصل وتبقى خاضعة لشرط النسبة والمشاركة بالمثل.
          </p>
          <p>لكل علم أو صورة من Wikimedia Commons اعتماد وترخيص خاصان بالملف في سجل الإصدار المعتمد؛ لا يعني ظهور هذه الصفحة قبول أي ملف مرشح غير مراجع.</p>
          <p><Link className="button button--secondary" to="/">العودة إلى البداية</Link></p>
        </div>
      </section>
    </main>
  );
}
