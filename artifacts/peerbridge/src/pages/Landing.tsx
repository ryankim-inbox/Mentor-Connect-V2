import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";

export default function Landing() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      navigate("/profile");
    }
  }, [isLoading, user, navigate]);

  if (user) return null;

  return (
    <div className="min-h-screen">
      <section className="bg-gradient-to-br from-primary/5 via-background to-primary/5 py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6 border border-primary/20">
            Verified school accounts only
          </div>
          <h1 className="text-5xl font-bold text-foreground mb-6 leading-tight">
            Students helping students
            <br />
            <span className="text-primary">across the Bay Area</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            This reduced release supports secure sign-in and self-profile
            management. District browsing, requests, matching, and messaging
            remain unavailable while their server controls are reviewed.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/login">
              <button className="px-8 py-3 border border-border bg-card text-foreground rounded-lg font-semibold text-lg hover:bg-accent transition-colors">
                Log in
              </button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            What is available now
          </h2>
          <p className="text-muted-foreground text-center mb-12">
            A deliberately small, reviewed surface
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                step: "01",
                title: "Sign in to an existing account",
                desc: "Authentication is routed through the reviewed API gateway allowlist.",
              },
              {
                step: "02",
                title: "Review or update your profile",
                desc: "Only the signed-in user's minimum self-profile can be read or updated.",
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-primary text-primary-foreground text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Already have an account?</h2>
          <p className="text-primary-foreground/80 mb-8 text-lg">
            Sign in to manage your own profile. Other product areas are
            intentionally closed in this release.
          </p>
          <Link href="/login">
            <button className="px-8 py-3 bg-white text-primary rounded-lg font-semibold text-lg hover:bg-white/90 transition-colors shadow-md">
              Log in
            </button>
          </Link>
        </div>
      </section>
    </div>
  );
}
