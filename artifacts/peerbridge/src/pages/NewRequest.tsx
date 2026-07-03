import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateRequest, useListDistricts, useListTags, getListRequestsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TagBadge } from "@/components/TagBadge";
import { PreferredTimesField } from "@/components/PreferredTimesField";
import { useAuth } from "@/lib/auth-context";

export default function NewRequest() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    title: "",
    description: "",
    districtId: user?.districtId ?? 0,
    role: "mentee" as "mentor" | "mentee",
    tagIds: [] as number[],
    preferredTimes: [] as string[],
  });
  const [error, setError] = useState("");
  const [districtSearch, setDistrictSearch] = useState("");

  const { data: districts } = useListDistricts({ search: districtSearch }, {
    query: { queryKey: ["districts", districtSearch] }
  });
  const { data: tags } = useListTags();
  const createRequest = useCreateRequest();

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-bold mb-4">Sign in to post a request</h2>
        <Link href="/login">
          <button className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold">Sign in</button>
        </Link>
      </div>
    );
  }

  const toggleTag = (id: number) => {
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.districtId) {
      setError("Please select a district");
      return;
    }

    if (form.tagIds.length === 0) {
      setError("Please select at least one subject tag");
      return;
    }

    createRequest.mutate(
      { data: form },
      {
        onSuccess: (req) => {
          queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey() });
          navigate(`/requests/${req.id}`);
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string } };
          setError(e?.data?.error ?? "Failed to create request. Please try again.");
        },
      }
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground mb-2">Post a mentorship request</h1>
      <p className="text-muted-foreground mb-8">Share what you're looking for and connect with the right student</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-card border border-card-border rounded-2xl p-6">
          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground mb-2">I am a...</label>
            <div className="grid grid-cols-2 gap-3">
              {(["mentee", "mentor"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: r }))}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    form.role === r
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-background border-input text-foreground hover:bg-accent"
                  }`}
                >
                  {r === "mentee" ? "Mentee — seeking a mentor" : "Mentor — offering help"}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground mb-1.5">Request title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Need help with AP Calculus BC"
              required
              maxLength={120}
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
            />
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Describe what you're looking for, your background, and your goals..."
              required
              rows={4}
              maxLength={800}
              className="w-full px-3 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">{form.description.length}/800</p>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-foreground mb-2">District</label>
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
              <option value="" disabled>Select a district</option>
              {districts?.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.county} County)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Subject tags <span className="text-muted-foreground font-normal">(select all that apply)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {tags?.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`transition-transform ${form.tagIds.includes(tag.id) ? "scale-105" : "hover:scale-105"}`}
                >
                  <TagBadge
                    name={tag.name}
                    color={form.tagIds.includes(tag.id) ? tag.color : "#94a3b8"}
                  />
                </button>
              ))}
            </div>
            {form.tagIds.length > 0 && (
              <p className="text-xs text-primary mt-2">{form.tagIds.length} tag{form.tagIds.length !== 1 ? "s" : ""} selected</p>
            )}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-6">
          <PreferredTimesField
            value={form.preferredTimes}
            onChange={(preferredTimes) => setForm((f) => ({ ...f, preferredTimes }))}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={createRequest.isPending}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createRequest.isPending ? "Posting..." : "Post request"}
          </button>
          <Link href="/requests">
            <button type="button" className="px-6 py-3 border border-border rounded-xl font-semibold hover:bg-accent transition-colors">
              Cancel
            </button>
          </Link>
        </div>
      </form>
    </div>
  );
}
