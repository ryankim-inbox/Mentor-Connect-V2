/**
 * Client-side release controls for quarantined functionality.
 *
 * These flags are deliberately fail-closed. They can only be enabled from an
 * explicit Vite development environment opt-in; production builds always
 * resolve every quarantined feature to false. This is an exposure-control UX
 * boundary, not a substitute for the server-side gateway in Slice 02.
 */
export const releaseFeatureDefinitions = {
  admin: {
    label: "Admin tools",
    environmentVariable: "VITE_FEATURE_ADMIN",
  },
  matching: {
    label: "Mentor matching",
    environmentVariable: "VITE_FEATURE_MATCHING",
  },
  practice: {
    label: "Practice lab",
    environmentVariable: "VITE_FEATURE_PRACTICE",
  },
  connect: {
    label: "Connect",
    environmentVariable: "VITE_FEATURE_CONNECT",
  },
  chat: {
    label: "Chat",
    environmentVariable: "VITE_FEATURE_CHAT",
  },
  analytics: {
    label: "Analytics",
    environmentVariable: "VITE_FEATURE_ANALYTICS",
  },
  scheduling: {
    label: "Scheduling",
    environmentVariable: "VITE_FEATURE_SCHEDULING",
  },
} as const;

export type ReleaseFeature = keyof typeof releaseFeatureDefinitions;

function isDevelopmentOptIn(environmentVariable: string): boolean {
  return import.meta.env.DEV && import.meta.env[environmentVariable] === "true";
}

export const featureFlags: Readonly<Record<ReleaseFeature, boolean>> = Object.freeze({
  admin: isDevelopmentOptIn(releaseFeatureDefinitions.admin.environmentVariable),
  matching: isDevelopmentOptIn(releaseFeatureDefinitions.matching.environmentVariable),
  practice: isDevelopmentOptIn(releaseFeatureDefinitions.practice.environmentVariable),
  connect: isDevelopmentOptIn(releaseFeatureDefinitions.connect.environmentVariable),
  chat: isDevelopmentOptIn(releaseFeatureDefinitions.chat.environmentVariable),
  analytics: isDevelopmentOptIn(releaseFeatureDefinitions.analytics.environmentVariable),
  scheduling: isDevelopmentOptIn(releaseFeatureDefinitions.scheduling.environmentVariable),
});

export function isFeatureEnabled(feature: ReleaseFeature): boolean {
  return featureFlags[feature];
}

export function getFeatureLabel(feature: ReleaseFeature): string {
  return releaseFeatureDefinitions[feature].label;
}

/**
 * Declarative client release-surface inventory. API quarantine policy lives in
 * the gateway so sensitive endpoint names are not emitted in the production
 * browser bundle.
 */
export const releaseSurface = Object.freeze({
  safeReturnPath: "/",
  appRoutes: {
    admin: "/admin/reports",
    matching: "/recommendations",
    practice: "/practice-lab",
    dashboardPractice: "/dashboard/practice-lab",
    analytics: "/analytics",
    scheduling: "/scheduling",
  },
});

const featureRouteMap: ReadonlyArray<{ path: string; feature: ReleaseFeature }> = [
  { path: releaseSurface.appRoutes.admin, feature: "admin" },
  { path: releaseSurface.appRoutes.matching, feature: "matching" },
  { path: releaseSurface.appRoutes.practice, feature: "practice" },
  { path: releaseSurface.appRoutes.dashboardPractice, feature: "practice" },
  { path: releaseSurface.appRoutes.analytics, feature: "analytics" },
  { path: releaseSurface.appRoutes.scheduling, feature: "scheduling" },
];

/**
 * Identifies quarantined deep links before AuthProvider mounts. That ordering
 * keeps a direct visit to a disabled feature from even making the global
 * /api/auth/me request.
 */
export function getFeatureForAppLocation(location: string): ReleaseFeature | undefined {
  const [pathWithOptionalHash, query = ""] = location.split("?");
  const pathWithoutHash = pathWithOptionalHash.split("#", 1)[0] || "/";
  const pathname = pathWithoutHash.length > 1 && pathWithoutHash.endsWith("/")
    ? pathWithoutHash.slice(0, -1)
    : pathWithoutHash;

  if (pathname === "/dashboard" && new URLSearchParams(query).get("tab") === "practice-lab") {
    return "practice";
  }

  return featureRouteMap.find((route) => route.path === pathname)?.feature;
}
