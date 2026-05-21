import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth-context";
import { Navbar } from "@/components/Navbar";
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
import Recommendations from "@/pages/Recommendations";
import Analytics from "@/pages/Analytics";
import AdminReports from "@/pages/AdminReports";
import NotFound from "@/pages/not-found";
import { RequireAuth } from "@/components/RequireAuth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
});

function Router() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/login" component={Login} />
          <Route path="/register" component={Register} />
          <Route path="/dashboard">
            <RequireAuth><Dashboard /></RequireAuth>
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
          <Route path="/profile/:id">
            {(params) => <RequireAuth><Profile id={params.id ?? ""} /></RequireAuth>}
          </Route>
          <Route path="/settings">
            <RequireAuth><Settings /></RequireAuth>
          </Route>
          <Route path="/recommendations">
            <RequireAuth><Recommendations /></RequireAuth>
          </Route>
          <Route path="/analytics">
            <RequireAuth><Analytics /></RequireAuth>
          </Route>
          <Route path="/admin/reports">
            <RequireAuth><AdminReports /></RequireAuth>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
