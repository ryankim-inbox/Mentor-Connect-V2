import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetStatsOverview } from "@workspace/api-client-react";
import { TagBadge } from "@/components/TagBadge";
import { useAuth } from "@/lib/auth-context";

export default function Landing() {
  const { data: stats } = useGetStatsOverview();
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && user) {
      navigate("/dashboard");
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
            Students helping students<br />
            <span className="text-primary">across the Bay Area</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            PeerBridge connects Bay Area high school students as mentors and mentees — organized by school district,
            verified by school email. Real help from real students who get it.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/register">
              <button className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-semibold text-lg hover:bg-primary/90 transition-colors shadow-md">
                Get started with .edu email
              </button>
            </Link>
            <Link href="/login">
              <button className="px-8 py-3 border border-border bg-card text-foreground rounded-lg font-semibold text-lg hover:bg-accent transition-colors">
                Log in
              </button>
            </Link>
          </div>
        </div>
      </section>

      {stats && (
        <section className="py-16 bg-white border-y border-border">
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <div>
                <p className="text-4xl font-bold text-primary">{stats.totalUsers.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">Students registered</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-primary">{stats.totalDistricts.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">School districts</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-primary">{stats.openRequests.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">Open requests</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-primary">{stats.successfulMatches.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">Successful matches</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">How PeerBridge works</h2>
          <p className="text-muted-foreground text-center mb-12">Three steps to connect with the right person</p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Register with your school email",
                desc: "Sign up using your .edu email address. PeerBridge verifies you're a real student in a California school district.",
              },
              {
                step: "02",
                title: "Choose your role and district",
                desc: "Be a mentor, a mentee, or both. Browse channels for high school districts in the Cupertino and Fremont area.",
              },
              {
                step: "03",
                title: "Post or browse requests",
                desc: "Tag your request with subjects like Math, SAT, or CS. Find the right match and start learning together.",
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {step}
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {stats && stats.topTags && stats.topTags.length > 0 && (
        <section className="py-16 bg-white border-y border-border px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-2xl font-bold mb-3">Popular subjects</h2>
            <p className="text-muted-foreground mb-8">Find mentors and mentees in the areas that matter to you</p>
            <div className="flex flex-wrap justify-center gap-3">
              {stats.topTags.map((tag) => (
                <span key={tag.id} className="inline-block">
                  <TagBadge name={tag.name} color={tag.color} />
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="py-20 px-4 bg-primary text-primary-foreground text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to connect?</h2>
          <p className="text-primary-foreground/80 mb-8 text-lg">
            Join thousands of California students helping each other succeed.
          </p>
          <Link href="/register">
            <button className="px-8 py-3 bg-white text-primary rounded-lg font-semibold text-lg hover:bg-white/90 transition-colors shadow-md">
              Create your account
            </button>
          </Link>
        </div>
      </section>
    </div>
  );
}
