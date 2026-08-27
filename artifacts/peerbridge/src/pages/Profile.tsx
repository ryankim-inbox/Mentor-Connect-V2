import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";

export default function Profile() {
  const { user } = useAuth();

  // RequireAuth has already resolved the session before this component mounts.
  // Retaining this guard keeps the component safe if it is reused elsewhere.
  if (!user) {
    return null;
  }

  const roleLabel =
    user.role === "mentor" ? "Mentor" : user.role === "mentee" ? "Mentee" : "Mentor & Mentee";
  const roleColor =
    user.role === "mentor"
      ? "text-blue-600 bg-blue-50 border-blue-100"
      : user.role === "mentee"
        ? "text-emerald-600 bg-emerald-50 border-emerald-100"
        : "text-violet-600 bg-violet-50 border-violet-100";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-card border border-card-border rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{user.name}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={"inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border " + roleColor}>
                  {roleLabel}
                </span>
                {user.isVerified && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border text-green-600 bg-green-50 border-green-100">
                    Verified student
                  </span>
                )}
              </div>
              {user.districtName && (
                <p className="text-sm text-muted-foreground mt-1">{user.districtName}</p>
              )}
            </div>
          </div>

          <Link href="/settings">
            <button className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent transition-colors">
              Edit profile
            </button>
          </Link>
        </div>

        {user.bio && <p className="mt-4 text-foreground leading-relaxed">{user.bio}</p>}

        {user.subjects.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">Subjects</p>
            <div className="flex flex-wrap gap-2">
              {user.subjects.map((subject) => (
                <span
                  key={subject}
                  className="px-2.5 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-medium"
                >
                  {subject}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-4">
          Joined {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}
