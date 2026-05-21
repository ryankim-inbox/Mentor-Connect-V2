import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister, useListDistricts } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";

export default function Register() {
  const [, navigate] = useLocation();
  const { refetch } = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "mentee" as "mentor" | "mentee" | "both",
    districtId: 0,
  });
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [districtSearch, setDistrictSearch] = useState("");

  const { data: districts } = useListDistricts({ type: "high_school", search: districtSearch || undefined }, {
    query: { queryKey: ["listDistricts", "high_school", districtSearch] }
  });

  const registerMutation = useRegister();

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setForm((f) => ({ ...f, email: val }));
    if (val && !val.toLowerCase().endsWith(".edu")) {
      setEmailError("Only .edu school email addresses are accepted");
    } else {
      setEmailError("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.email.toLowerCase().endsWith(".edu")) {
      setError("Only .edu school email addresses are accepted");
      return;
    }

    if (!form.districtId) {
      setError("Please select your school district");
      return;
    }

    registerMutation.mutate(
      { data: form },
      {
        onSuccess: () => {
          refetch();
          navigate("/dashboard");
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string } };
          setError(e?.data?.error ?? "Registration failed. Please try again.");
        },
      }
    );
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
          <p className="text-muted-foreground mt-1">Join PeerBridge with your school email</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Full name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Your name"
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                School email <span className="text-muted-foreground font-normal">(must be .edu)</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={handleEmailChange}
                placeholder="you@school.edu"
                required
                className={`w-full px-3 py-2.5 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition ${emailError ? "border-destructive" : "border-input"}`}
              />
              {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Create a password"
                required
                minLength={6}
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">I want to be a...</label>
              <div className="grid grid-cols-3 gap-2">
                {(["mentee", "mentor", "both"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, role: r }))}
                    className={`py-2.5 rounded-lg text-sm font-medium border transition-colors capitalize ${
                      form.role === r
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-input hover:bg-accent"
                    }`}
                  >
                    {r === "both" ? "Both" : r === "mentor" ? "Mentor" : "Mentee"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {form.role === "mentor" && "You'll offer guidance to other students"}
                {form.role === "mentee" && "You'll receive guidance from other students"}
                {form.role === "both" && "You'll both give and receive guidance"}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">School district</label>
              <input
                type="text"
                placeholder="Search districts..."
                value={districtSearch}
                onChange={(e) => setDistrictSearch(e.target.value)}
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition mb-2"
              />
              <select
                value={form.districtId || ""}
                onChange={(e) => setForm((f) => ({ ...f, districtId: Number(e.target.value) }))}
                required
                className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                size={4}
              >
                <option value="" disabled>Select your district</option>
                {districts?.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.county} County)</option>
                ))}
              </select>
              {form.districtId > 0 && (
                <p className="text-xs text-primary mt-1">
                  Selected: {districts?.find(d => d.id === form.districtId)?.name}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={registerMutation.isPending || !!emailError}
              className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {registerMutation.isPending ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{" "}
            <Link href="/login">
              <span className="text-primary font-medium hover:underline">Sign in</span>
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
