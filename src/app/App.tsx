import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { DeferredFirebaseAuthProvider } from '../features/auth/auth-context';
import { EntryRoute } from '../routes/EntryRoute';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

const HostNewRoute = lazy(() => import('../routes/GameRoutes').then(({ HostNewRoute }) => ({ default: HostNewRoute })));
const NameJoinRoute = lazy(() => import('../routes/NameJoinRoute').then(({ NameJoinRoute }) => ({ default: NameJoinRoute })));
const HowToPlayRoute = lazy(() => import('../routes/GameRoutes').then(({ HowToPlayRoute }) => ({ default: HowToPlayRoute })));
const NotFoundRoute = lazy(() => import('../routes/GameRoutes').then(({ NotFoundRoute }) => ({ default: NotFoundRoute })));
const RoomRoute = lazy(() => import('../routes/GameRoutes').then(({ RoomRoute }) => ({ default: RoomRoute })));
const AccountRoute = lazy(() => import('../routes/AuthRoutes').then(({ AccountRoute }) => ({ default: AccountRoute })));
const LoginRoute = lazy(() => import('../routes/AuthRoutes').then(({ LoginRoute }) => ({ default: LoginRoute })));
const AdminOverviewRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminOverviewRoute }) => ({ default: AdminOverviewRoute })));
const AdminQuestionEditorRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminQuestionEditorRoute }) => ({ default: AdminQuestionEditorRoute })));
const AdminRecordRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminRecordRoute }) => ({ default: AdminRecordRoute })));
const AdminRootRedirect = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminRootRedirect }) => ({ default: AdminRootRedirect })));
const AdminSettingsRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminSettingsRoute }) => ({ default: AdminSettingsRoute })));
const AdminShell = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminShell }) => ({ default: AdminShell })));
const AdminUsersRoute = lazy(() => import('../features/admin/AdminRoutes').then(({ AdminUsersRoute }) => ({ default: AdminUsersRoute })));
const LegacyQuestionRedirect = lazy(() => import('../features/admin/AdminRoutes').then(({ LegacyQuestionRedirect }) => ({ default: LegacyQuestionRedirect })));
const LocalImportReviewRoute = lazy(() => import('../routes/LocalImportReviewRoute').then(({ LocalImportReviewRoute }) => ({ default: LocalImportReviewRoute })));

type RouteStatusSurfaceProps = {
  action?: ReactNode;
  busy?: boolean;
  message: ReactNode;
  messageRole?: "alert" | "status";
  title: string;
};

function RouteStatusSurface({
  action,
  busy = false,
  message,
  messageRole = "status",
  title,
}: RouteStatusSurfaceProps) {
  const titleId = `route-status-${messageRole}-title`;
  return (
    <main
      aria-busy={busy || undefined}
      aria-live={busy ? "polite" : undefined}
      className="app-page spatial-shell"
      id="main-content"
    >
      <section className="setup-page spatial-setup" aria-labelledby={titleId}>
        <div>
          <p className="eyebrow">تحدي الخلية</p>
          <h1 id={titleId}>{title}</h1>
          <p className="form-message" role={messageRole}>{message}</p>
          {action}
        </div>
      </section>
    </main>
  );
}

export function RouteLoading() {
  return <RouteStatusSurface busy message="يُرجى الانتظار بينما نجهّز الصفحة." title="جارٍ تحميل الصفحة…" />;
}

export function StaticPreviewUnavailableRoute() {
  return <RouteStatusSurface message={staticPreviewNotice} title="هذه الخدمة غير متاحة في المعاينة" />;
}

export class RouteChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <RouteStatusSurface
        action={<button className="button button--primary" onClick={() => window.location.reload()} type="button">إعادة المحاولة</button>}
        message="تحقق من الاتصال ثم أعد المحاولة."
        messageRole="alert"
        title="تعذر تحميل الصفحة"
      />
    );
  }
}

function RouteAuthRuntime({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <DeferredFirebaseAuthProvider enabled={!isStaticPreviewBuild() && (pathname === '/login' || pathname === '/account' || pathname.startsWith('/admin'))}>{children}</DeferredFirebaseAuthProvider>;
}

export function App() {
  const staticPreview = isStaticPreviewBuild();
  const unavailable = <StaticPreviewUnavailableRoute />;
  return (
    <ThemeProvider>
      <BrowserRouter>
        <RouteAuthRuntime>
          <RouteChunkBoundary><Suspense fallback={<RouteLoading />}><Routes>
            <Route path="/" element={<EntryRoute />} />
            <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
            <Route path="/how-to-play" element={<HowToPlayRoute />} />
            <Route path="/host/new" element={<HostNewRoute />} />
            <Route path="/room/:roomCode/lobby" element={staticPreview ? unavailable : <RoomRoute surface="lobby" />} />
            <Route path="/room/:roomCode/host" element={staticPreview ? unavailable : <RoomRoute surface="host" />} />
            <Route path="/room/:roomCode/play" element={staticPreview ? unavailable : <RoomRoute surface="play" />} />
            <Route path="/room/:roomCode/display" element={staticPreview ? unavailable : <RoomRoute surface="display" />} />
            <Route path="/room/:roomCode/results" element={staticPreview ? unavailable : <RoomRoute surface="results" />} />
            <Route path="/questions" element={staticPreview ? unavailable : <Navigate replace to="/admin/questions" />} />
            <Route path="/questions/new" element={staticPreview ? unavailable : <Navigate replace to="/admin/questions/new" />} />
            <Route path="/questions/:questionId" element={staticPreview ? unavailable : <LegacyQuestionRedirect />} />
            <Route path="/local-import-review" element={staticPreview ? unavailable : <LocalImportReviewRoute />} />
            <Route path="/admin" element={staticPreview ? unavailable : <AdminRootRedirect />} />
            <Route path="/admin" element={staticPreview ? unavailable : <AdminShell />}>
              <Route path="overview" element={<AdminOverviewRoute />} />
              <Route path="questions" element={<AdminRecordRoute section="questions" />} />
              <Route path="questions/new" element={<AdminQuestionEditorRoute />} />
              <Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} />
              <Route path="reviews" element={<AdminRecordRoute section="reviews" />} /><Route path="reviews/:id" element={<AdminRecordRoute section="reviews" />} />
              <Route path="categories" element={<AdminRecordRoute section="categories" />} /><Route path="categories/:id" element={<AdminRecordRoute section="categories" />} />
              <Route path="releases" element={<AdminRecordRoute section="releases" />} /><Route path="releases/:id" element={<AdminRecordRoute section="releases" />} />
              <Route path="rooms" element={<AdminRecordRoute section="rooms" />} /><Route path="rooms/:id" element={<AdminRecordRoute section="rooms" />} />
              <Route path="users" element={<AdminUsersRoute />} /><Route path="audit" element={<AdminRecordRoute section="audit" />} />
              <Route path="health" element={<AdminRecordRoute section="health" />} /><Route path="settings" element={<AdminSettingsRoute />} />
            </Route>
            <Route path="/login" element={staticPreview ? unavailable : <LoginRoute />} />
            <Route path="/account" element={staticPreview ? unavailable : <AccountRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes></Suspense></RouteChunkBoundary>
        </RouteAuthRuntime>
      </BrowserRouter>
    </ThemeProvider>
  );
}
