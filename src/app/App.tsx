import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { DeferredFirebaseAuthProvider } from '../features/auth/auth-context';
import { EntryRoute } from '../routes/EntryRoute';

const HostNewRoute = lazy(() => import('../routes/GameRoutes').then(({ HostNewRoute }) => ({ default: HostNewRoute })));
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

function RouteLoading() {
  return <main aria-busy="true" aria-live="polite" id="main-content"><p>جارٍ تحميل الصفحة…</p></main>;
}

class RouteChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main id="main-content" role="alert"><h1>تعذر تحميل الصفحة</h1><p>تحقق من الاتصال ثم أعد المحاولة.</p><button onClick={() => window.location.reload()} type="button">إعادة المحاولة</button></main>;
  }
}

function RouteAuthRuntime({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <DeferredFirebaseAuthProvider enabled={pathname === '/login' || pathname === '/account' || pathname.startsWith('/admin')}>{children}</DeferredFirebaseAuthProvider>;
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <RouteAuthRuntime>
          <RouteChunkBoundary><Suspense fallback={<RouteLoading />}><Routes>
            <Route path="/" element={<EntryRoute />} />
            <Route path="/how-to-play" element={<HowToPlayRoute />} />
            <Route path="/host/new" element={<HostNewRoute />} />
            <Route path="/room/:roomCode/lobby" element={<RoomRoute surface="lobby" />} />
            <Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} />
            <Route path="/room/:roomCode/play" element={<RoomRoute surface="play" />} />
            <Route path="/room/:roomCode/display" element={<RoomRoute surface="display" />} />
            <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
            <Route path="/questions" element={<Navigate replace to="/admin/questions" />} />
            <Route path="/questions/new" element={<Navigate replace to="/admin/questions/new" />} />
            <Route path="/questions/:questionId" element={<LegacyQuestionRedirect />} />
            <Route path="/admin" element={<AdminRootRedirect />} />
            <Route path="/admin" element={<AdminShell />}>
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
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/account" element={<AccountRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes></Suspense></RouteChunkBoundary>
        </RouteAuthRuntime>
      </BrowserRouter>
    </ThemeProvider>
  );
}
