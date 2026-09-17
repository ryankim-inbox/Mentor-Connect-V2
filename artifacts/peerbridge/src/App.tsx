import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { Navbar } from "@/components/Navbar";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";
import { RequireAuth } from "@/components/RequireAuth";
import { releaseSurface } from "@/lib/release-flags";

const Register = lazy(() => import("@/pages/Register"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Districts = lazy(() => import("@/pages/Districts"));
const DistrictDetail = lazy(() => import("@/pages/DistrictDetail"));
const Requests = lazy(() => import("@/pages/Requests"));
const NewRequest = lazy(() => import("@/pages/NewRequest"));
const RequestDetail = lazy(() => import("@/pages/RequestDetail"));
const Recommendations = lazy(() => import("@/pages/Recommendations"));
const PracticeLab = lazy(() => import("@/pages/PracticeLab"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Scheduling = lazy(() => import("@/pages/Scheduling"));
const AdminReports = lazy(() => import("@/pages/AdminReports"));
const MemberProfile = lazy(() => import("@/pages/MemberProfile"));
const ChatWidget = lazy(() =>
  import("@/components/ChatWidget").then((module) => ({
    default: module.ChatWidget,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function FeatureLoading() {
  return (
    <div
      className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground"
      role="status"
    >
      Loading feature…
    </div>
  );
}

function DashboardRoute({
  initialTab,
}: {
  initialTab?: "overview" | "practice-lab";
}) {
  return (
    <RequireAuth>
      <Dashboard initialTab={initialTab} PracticeLab={PracticeLab} />
    </RequireAuth>
  );
}

function Router() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={Login} />
          <Route path={releaseSurface.appRoutes.register} component={Register} />
          <Route path={releaseSurface.appRoutes.dashboardPractice}>
            <DashboardRoute initialTab="practice-lab" />
          </Route>
          <Route path={releaseSurface.appRoutes.dashboard}>
            <DashboardRoute />
          </Route>
          <Route path="/districts/:id">
            {(params) => (
              <RequireAuth>
                <DistrictDetail id={params.id ?? ""} />
              </RequireAuth>
            )}
          </Route>
          <Route path={releaseSurface.appRoutes.districts}>
            <RequireAuth>
              <Districts />
            </RequireAuth>
          </Route>
          <Route path="/requests/new">
            <RequireAuth>
              <NewRequest />
            </RequireAuth>
          </Route>
          <Route path="/requests/:id">
            {(params) => (
              <RequireAuth>
                <RequestDetail id={params.id ?? ""} />
              </RequireAuth>
            )}
          </Route>
          <Route path={releaseSurface.appRoutes.requests}>
            <RequireAuth>
              <Requests />
            </RequireAuth>
          </Route>
          <Route path="/profile/:id">
            {(params) => (
              <RequireAuth>
                <MemberProfile id={params.id ?? ""} />
              </RequireAuth>
            )}
          </Route>
          <Route path="/profile">
            <RequireAuth>
              <Profile />
            </RequireAuth>
          </Route>
          <Route path="/settings">
            <RequireAuth>
              <Settings />
            </RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.matching}>
            <RequireAuth>
              <Recommendations />
            </RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.practice}>
            <RequireAuth>
              <PracticeLab />
            </RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.analytics}>
            <RequireAuth>
              <Analytics />
            </RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.scheduling}>
            <RequireAuth>
              <Scheduling />
            </RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.admin}>
            <RequireAuth>
              <AdminReports />
            </RequireAuth>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function ReleaseAwareApp() {
  return (
    <AuthProvider>
      <Suspense fallback={<FeatureLoading />}>
        <Router />
        <ChatWidget />
      </Suspense>
    </AuthProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ReleaseAwareApp />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
