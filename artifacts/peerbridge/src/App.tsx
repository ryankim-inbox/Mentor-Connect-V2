import { lazy, Suspense } from "react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  useLocation,
  useSearch,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { Navbar } from "@/components/Navbar";
import {
  FeatureGate,
  FeatureUnavailable,
} from "@/components/FeatureUnavailable";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
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
const DevelopmentChatWidget = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/ChatWidget").then((module) => ({
        default: module.ChatWidget,
      })),
    )
  : null;
const DevelopmentRegister = import.meta.env.DEV
  ? lazy(() => import("@/pages/Register"))
  : null;
const DevelopmentDashboard = import.meta.env.DEV
  ? lazy(() => import("@/pages/Dashboard"))
  : null;
const DevelopmentDistricts = import.meta.env.DEV
  ? lazy(() => import("@/pages/Districts"))
  : null;
const DevelopmentDistrictDetail = import.meta.env.DEV
  ? lazy(() => import("@/pages/DistrictDetail"))
  : null;
const DevelopmentRequests = import.meta.env.DEV
  ? lazy(() => import("@/pages/Requests"))
  : null;
const DevelopmentNewRequest = import.meta.env.DEV
  ? lazy(() => import("@/pages/NewRequest"))
  : null;
const DevelopmentRequestDetail = import.meta.env.DEV
  ? lazy(() => import("@/pages/RequestDetail"))
  : null;
const DevelopmentAnalytics = import.meta.env.DEV
  ? lazy(() => import("@/pages/Analytics"))
  : null;
const DevelopmentScheduling = import.meta.env.DEV
  ? lazy(() => import("@/pages/Scheduling"))
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
  if (!DevelopmentDashboard) return <FeatureUnavailable feature="core" />;
  return (
    <RequireAuth>
      <Suspense fallback={<DevelopmentFeatureLoading />}>
        <DevelopmentDashboard
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
          <Route path={releaseSurface.appRoutes.register}>
            {DevelopmentRegister ? (
              <FeatureGate feature="core">
                <Suspense fallback={<DevelopmentFeatureLoading />}>
                  <DevelopmentRegister />
                </Suspense>
              </FeatureGate>
            ) : (
              <FeatureUnavailable feature="core" />
            )}
          </Route>
          <Route path={releaseSurface.appRoutes.dashboardPractice}>
            {DevelopmentPracticeLab ? (
              <FeatureGate feature="practice">
                <DashboardRoute initialTab="practice-lab" />
              </FeatureGate>
            ) : (
              <FeatureUnavailable feature="practice" />
            )}
          </Route>
          <Route path="/dashboard">
            <DashboardRoute />
          </Route>
          <Route path="/districts">
            {DevelopmentDistricts ? (
              <RequireAuth>
                <DevelopmentDistricts />
              </RequireAuth>
            ) : (
              <FeatureUnavailable feature="core" />
            )}
          </Route>
          <Route path="/districts/:id">
            {(params) =>
              DevelopmentDistrictDetail ? (
                <RequireAuth>
                  <DevelopmentDistrictDetail id={params.id ?? ""} />
                </RequireAuth>
              ) : (
                <FeatureUnavailable feature="core" />
              )
            }
          </Route>
          <Route path="/requests/new">
            {DevelopmentNewRequest ? (
              <RequireAuth>
                <DevelopmentNewRequest />
              </RequireAuth>
            ) : (
              <FeatureUnavailable feature="core" />
            )}
          </Route>
          <Route path="/requests/:id">
            {(params) =>
              DevelopmentRequestDetail ? (
                <RequireAuth>
                  <DevelopmentRequestDetail id={params.id ?? ""} />
                </RequireAuth>
              ) : (
                <FeatureUnavailable feature="core" />
              )
            }
          </Route>
          <Route path="/requests">
            {DevelopmentRequests ? (
              <RequireAuth>
                <DevelopmentRequests />
              </RequireAuth>
            ) : (
              <FeatureUnavailable feature="core" />
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
            {DevelopmentRecommendations ? (
              <FeatureGate feature="matching">
                <RequireAuth>
                  <Suspense fallback={<DevelopmentFeatureLoading />}>
                    <DevelopmentRecommendations />
                  </Suspense>
                </RequireAuth>
              </FeatureGate>
            ) : (
              <FeatureUnavailable feature="matching" />
            )}
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
            ) : (
              <FeatureUnavailable feature="practice" />
            )}
          </Route>
          <Route path={releaseSurface.appRoutes.analytics}>
            {DevelopmentAnalytics ? (
              <FeatureGate feature="analytics">
                <RequireAuth>
                  <DevelopmentAnalytics />
                </RequireAuth>
              </FeatureGate>
            ) : (
              <FeatureUnavailable feature="analytics" />
            )}
          </Route>
          <Route path={releaseSurface.appRoutes.scheduling}>
            {DevelopmentScheduling ? (
              <FeatureGate feature="scheduling">
                <RequireAuth>
                  <DevelopmentScheduling />
                </RequireAuth>
              </FeatureGate>
            ) : (
              <FeatureUnavailable feature="scheduling" />
            )}
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
      {DevelopmentChatWidget && isFeatureEnabled("chat") && (
        <Suspense fallback={null}>
          <DevelopmentChatWidget />
        </Suspense>
      )}
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
