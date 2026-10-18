type DemoKind = "profile" | "post";
type DemoProps = { isDemo?: boolean; kind: DemoKind };

const explanation = {
  profile: "Fictional profile for exploring Mentor Connect.",
  post: "Fictional content for exploring Mentor Connect.",
};

// Trust only the API's approved-batch marker, never names or displayed prose.
export function DemoBadge({ isDemo, kind }: DemoProps) {
  if (isDemo !== true) return null;
  return (
    <span
      title={explanation[kind]}
      className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900"
    >
      Demo {kind}
    </span>
  );
}

export function DemoNotice({ isDemo, kind }: DemoProps) {
  if (isDemo !== true) return null;
  return (
    <p className="my-2 text-xs text-muted-foreground">{explanation[kind]}</p>
  );
}
