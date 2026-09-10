import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  getFeatureLabel,
  isFeatureEnabled,
  releaseSurface,
  type ReleaseFeature,
} from "@/lib/release-flags";

export function FeatureUnavailable({ feature }: { feature: ReleaseFeature }) {
  const label = getFeatureLabel(feature);

  return (
    <section className="max-w-2xl mx-auto px-4 py-20 text-center" aria-live="polite">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Feature unavailable</p>
      <h1 className="mt-3 text-2xl font-bold text-foreground">{label} is being prepared</h1>
      <p className="mt-3 text-muted-foreground">
        This feature is not available in the current release. You can safely return to the home page.
      </p>
      <Link href={releaseSurface.safeReturnPath}>
        <button className="mt-6 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors">
          Return to home
        </button>
      </Link>
    </section>
  );
}

export function FeatureGate({
  feature,
  children,
}: {
  feature: ReleaseFeature;
  children: ReactNode;
}) {
  return isFeatureEnabled(feature) ? <>{children}</> : <FeatureUnavailable feature={feature} />;
}
