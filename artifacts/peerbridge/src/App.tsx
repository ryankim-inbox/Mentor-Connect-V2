import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, useSearch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { Navbar } from "@/components/Navbar";
import { ChatWidget } from "@/components/ChatWidget";
import { FeatureGate, FeatureUnavailable } from "@/components/FeatureUnavailable";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Districts from "@/pages/Districts";
import DistrictDetail from "@/pages/DistrictDetail";
import Requests from "@/pages/Requests";
import NewRequest from "@/pages/NewRequest";
import RequestDetail from "@/pages/RequestDetail";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import Analytics from "@/pages/Analytics";
import Scheduling from "@/pages/Scheduling";
import NotFound from "@/pages/not-found";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getFeatureForAppLocation,
  isFeatureEnabled,
  releaseSurface,
} from "@/lib/release-flags";

// These imports are folded out of production builds. Disabled matching and
// practice pages therefore cannot leave their API calls in an emitted chunk.
const DevelopmentRecommendations = import.meta.env.DEV
  ? lazy(() => import("@/pages/Recommendations"))
  : null;
const DevelopmentPracticeLab = import.meta.env.DEV
  ? lazy(() => import("@/pages/PracticeLab"))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function DevelopmentFeatureLoading() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-20 text-center text-muted-foreground" role="status">
      Loading feature…
    </div>
  );
}

function DashboardRoute({ initialTab }: { initialTab?: "overview" | "practice-lab" }) {
  return (
    <RequireAuth>
      <Suspense fallback={<DevelopmentFeatureLoading />}>
        <Dashboard
          initialTab={initialTab}
          PracticeLab={DevelopmentPracticeLab ?? undefined}
        />
      </Suspense>
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
          <Route path="/register" component={Register} />
          <Route path={releaseSurface.appRoutes.dashboardPractice}>
            {DevelopmentPracticeLab ? (
              <FeatureGate feature="practice">
                <DashboardRoute initialTab="practice-lab" />
              </FeatureGate>
            ) : <FeatureUnavailable feature="practice" />}
          </Route>
          <Route path="/dashboard">
            <DashboardRoute />
          </Route>
          <Route path="/districts">
            <RequireAuth><Districts /></RequireAuth>
          </Route>
          <Route path="/districts/:id">
            {(params) => <RequireAuth><DistrictDetail id={params.id ?? ""} /></RequireAuth>}
          </Route>
          <Route path="/requests/new">
            <RequireAuth><NewRequest /></RequireAuth>
          </Route>
          <Route path="/requests/:id">
            {(params) => <RequireAuth><RequestDetail id={params.id ?? ""} /></RequireAuth>}
          </Route>
          <Route path="/requests">
            <RequireAuth><Requests /></RequireAuth>
          </Route>
          <Route path="/profile">
            <RequireAuth><Profile /></RequireAuth>
          </Route>
          <Route path="/settings">
            <RequireAuth><Settings /></RequireAuth>
          </Route>
          <Route path={releaseSurface.appRoutes.matching}>
            {DevelopmentRecommendations ? (
              <FeatureGate feature="matching">
                <RequireAuth>
                  <Suspense fallback={<DevelopmentFeatureLoading />}>
                    <DevelopmentRecommendations />
                  </Suspense>
                </RequireAuth>
              </FeatureGate>
            ) : <FeatureUnavailable feature="matching" />}
          </Route>
          <Route path={releaseSurface.appRoutes.practice}>
            {DevelopmentPracticeLab ? (
              <FeatureGate feature="practice">
                <RequireAuth>
                  <Suspense fallback={<DevelopmentFeatureLoading />}>
                    <DevelopmentPracticeLab />
                  </Suspense>
                </RequireAuth>
              </FeatureGate>
            ) : <FeatureUnavailable feature="practice" />}
          </Route>
          <Route path={releaseSurface.appRoutes.analytics}>
            <FeatureGate feature="analytics">
              <RequireAuth><Analytics /></RequireAuth>
            </FeatureGate>
          </Route>
          <Route path={releaseSurface.appRoutes.scheduling}>
            <FeatureGate feature="scheduling">
              <RequireAuth><Scheduling /></RequireAuth>
            </FeatureGate>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function ReleaseAwareApp() {
  const [location] = useLocation();
  const search = useSearch();
  const feature = getFeatureForAppLocation(`${location}${search}`);

  // This must stay outside AuthProvider: an unavailable deep link must not
  // trigger the global auth query or mount a feature page before being closed.
  if (feature && !isFeatureEnabled(feature)) {
    return <FeatureUnavailable feature={feature} />;
  }

  return (
    <AuthProvider>
      <Router />
      {isFeatureEnabled("chat") && <ChatWidget />}
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
