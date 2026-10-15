/** Declarative client route inventory. API access policy remains in the gateway. */
export const releaseSurface = Object.freeze({
  safeReturnPath: "/",
  appRoutes: {
    register: "/register",
    dashboard: "/dashboard",
    districts: "/districts",
    requests: "/requests",
    admin: "/admin/reports",
    matching: "/recommendations",
    practice: "/practice-lab",
    dashboardPractice: "/dashboard/practice-lab",
    analytics: "/analytics",
    scheduling: "/scheduling",
  },
});
