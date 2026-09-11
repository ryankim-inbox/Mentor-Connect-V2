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
            Peer learning workspace
          </div>
          <h1 className="text-5xl font-bold text-foreground mb-6 leading-tight">
            Students helping students
            <br />
            <span className="text-primary">across the Bay Area</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Explore requests, matching, and chat in this learning app.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/login">
              <button className="px-8 py-3 border border-border bg-card text-foreground rounded-lg font-semibold text-lg hover:bg-accent transition-colors">
                Log in
              </button>
            </Link>
            <Link href="/register">
              <button className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-primary/90 transition-colors">
                Sign up
              </button>
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            What you can explore
          </h2>
          <p className="text-muted-foreground text-center mb-12">
            Learn by using the complete PeerBridge workspace
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                step: "01",
                title: "Browse and connect",
                desc: "Explore districts, mentorship requests, matches, and scheduling.",
              },
              {
                step: "02",
                title: "See learning states",
                desc: "Practice, analytics, reports, and chat show the current student module output.",
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
          <h2 className="text-3xl font-bold mb-4">Ready to learn together?</h2>
          <p className="text-primary-foreground/80 mb-8 text-lg">
            Sign in to explore the PeerBridge learning workspace.
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
