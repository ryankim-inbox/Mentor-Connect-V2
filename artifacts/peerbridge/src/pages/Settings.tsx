import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  useUpdateUser,
  useListBlocks,
  useUnblockUser,
  getListBlocksQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function Settings() {
  const { user, refetch } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: user?.name ?? "",
    bio: user?.bio ?? "",
    role: user?.role ?? "mentee",
    subjects: user?.subjects?.join(", ") ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const updateUser = useUpdateUser();
  const { data: blocks } = useListBlocks();
  const unblockMutation = useUnblockUser();

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name,
        bio: user.bio ?? "",
        role: user.role,
        subjects: user.subjects?.join(", ") ?? "",
      });
    }
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-bold mb-4">Sign in to access settings</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">Sign in</button>
        </Link>
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);

    const subjects = form.subjects
      ? form.subjects.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    updateUser.mutate(
      {
        id: user.id,
        data: {
          name: form.name,
          bio: form.bio || null,
          role: form.role as "mentor" | "mentee" | "both",
          subjects,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          refetch();
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string } };
          setError(e?.data?.error ?? "Failed to update profile.");
        },
      }
    );
  };

  const handleUnblock = (blockedUserId: number) => {
    unblockMutation.mutate({ blockedUserId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
      },
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">Settings</h1>

      <div className="bg-card border border-card-border rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-lg mb-5">Profile</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Full name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Role</label>
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
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Bio</label>
            <textarea
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="Tell others about yourself, your interests and goals..."
              rows={3}
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Subjects <span className="text-muted-foreground font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={form.subjects}
              onChange={(e) => setForm((f) => ({ ...f, subjects: e.target.value }))}
              placeholder="Math, Science, English, CS..."
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>

          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
          {saved && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">Profile saved successfully.</p>}

          <button
            type="submit"
            disabled={updateUser.isPending}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {updateUser.isPending ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>

      <div className="bg-card border border-card-border rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-4">Blocked users</h2>
        {(!blocks || blocks.length === 0) ? (
          <p className="text-muted-foreground text-sm">No blocked users.</p>
        ) : (
          <div className="space-y-3">
            {blocks.map((block) => (
              <div key={block.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="font-medium text-foreground">{block.blockedUserName}</span>
                <button
                  onClick={() => handleUnblock(block.blockedUserId)}
                  disabled={unblockMutation.isPending}
                  className="text-sm text-primary hover:underline"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
