export const releaseFeatureDefinitions = {
  core: {
    label: "District and request workspace",
  },
  admin: {
    label: "Admin tools",
  },
  matching: {
    label: "Mentor matching",
  },
  practice: {
    label: "Practice lab",
  },
  connect: {
    label: "Connect",
  },
  chat: {
    label: "Chat",
  },
  analytics: {
    label: "Analytics",
  },
  scheduling: {
    label: "Scheduling",
  },
} as const;

export type ReleaseFeature = keyof typeof releaseFeatureDefinitions;

export const featureFlags: Readonly<Record<ReleaseFeature, boolean>> =
  Object.freeze({
    core: true,
    admin: true,
    matching: true,
    practice: true,
    connect: true,
    chat: true,
    analytics: true,
    scheduling: true,
  });

export function isFeatureEnabled(feature: ReleaseFeature): boolean {
  return featureFlags[feature];
}

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
