import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  useUpdateUser,
  getGetMeQueryKey,
  getGetUserQueryKey,
  type User,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function Settings() {
  const { user, refetch } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: user?.name ?? "",
    bio: user?.bio ?? "",
    subjects: user?.subjects?.join(", ") ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const updateUser = useUpdateUser();
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name,
        bio: user.bio ?? "",
        subjects: user.subjects?.join(", ") ?? "",
      });
    }
  }, [user?.id]);

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-bold mb-4">Sign in to access settings</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">
            Sign in
          </button>
        </Link>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    setError("");
    setSaved(false);

    const subjects = form.subjects
      ? form.subjects
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const bytes = (value: string) => new TextEncoder().encode(value).length;
    if (
      !form.name.trim() ||
      bytes(form.name) > 120 ||
      bytes(form.bio) > 2000 ||
      subjects.length > 20 ||
      subjects.some((subject) => bytes(subject) > 80)
    ) {
      setError(
        "Use a name up to 120 UTF-8 bytes, a bio up to 2,000 bytes, and at most 20 subjects of 80 bytes each.",
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const submitted = form;
    try {
      const profile = await updateUser.mutateAsync({
        id: user.id,
        data: { name: form.name, bio: form.bio, subjects },
      });
      // A save from a former account must never repopulate its cache after logout.
      if (!mounted.current) return;
      await queryClient.cancelQueries({ queryKey: getGetMeQueryKey() });
      const current = queryClient.getQueryData<User | null>(getGetMeQueryKey());
      if (!mounted.current || current?.id !== user.id) return;
      queryClient.setQueryData(getGetMeQueryKey(), {
        ...current,
        ...profile,
        bio: submitted.bio,
      });
      setForm((draft) =>
        draft === submitted
          ? {
              name: profile.name,
              bio: submitted.bio,
              subjects: profile.subjects.join(", "),
            }
          : draft,
      );
      setSaved(true);
      await queryClient.invalidateQueries({
        queryKey: getGetUserQueryKey(user.id),
      });
      try {
        await refetch();
      } catch {
        setError(
          "Your profile was saved, but the session couldn't be refreshed. Retry session to confirm.",
        );
      }
    } catch (error) {
      const failure = error as { data?: { error?: string } };
      setError(failure.data?.error ?? "Failed to update profile.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-8">Settings</h1>

      <div className="bg-card border border-card-border rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-lg mb-5">Profile</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Name: 120 UTF-8 bytes. Bio: 2,000 bytes. Up to 20 subjects, 80 bytes
          each. Non-English characters may use several bytes.
        </p>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Full name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Bio
            </label>
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
              Subjects{" "}
              <span className="text-muted-foreground font-normal">
                (comma-separated)
              </span>
            </label>
            <input
              type="text"
              value={form.subjects}
              onChange={(e) =>
                setForm((f) => ({ ...f, subjects: e.target.value }))
              }
              placeholder="Math, Science, English, CS..."
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {saved && (
            <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">
              Profile saved successfully.
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
