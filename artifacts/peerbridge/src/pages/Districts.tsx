import { useState } from "react";
import { Link } from "wouter";
import {
  useListDistricts,
  getListDistrictsQueryKey,
  type District,
  type ListDistrictsParams,
} from "@workspace/api-client-react";
import { countyLabel, districtTypeLabel } from "@/lib/district-display";

export default function Districts() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<
    NonNullable<ListDistrictsParams["type"]> | "all"
  >("all");
  const trimmedSearch = search.trim();
  const hasFilters = !!trimmedSearch || type !== "all";
  const params = {
    ...(type !== "all" ? { type } : {}),
    ...(trimmedSearch ? { search: trimmedSearch } : {}),
  };
  const {
    data: districts,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useListDistricts(params, {
    query: { queryKey: getListDistrictsQueryKey(params) },
  });
  const groups = new Map<string, District[]>();
  for (const district of districts ?? []) {
    const county = countyLabel(district.county);
    const group = groups.get(county) ?? [];
    group.push(district);
    groups.set(county, group);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">
          School District Channels
        </h1>
        <p className="text-muted-foreground mt-1">
          Browse districts by county to connect with nearby students. Channels
          represent districts, not individual schools.
        </p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row mb-8">
        <div className="w-full sm:max-w-md">
          <label
            htmlFor="district-search"
            className="block text-sm font-medium mb-2"
          >
            Search districts
          </label>
          <input
            id="district-search"
            type="search"
            placeholder="Search districts by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label
            htmlFor="district-type"
            className="block text-sm font-medium mb-2"
          >
            District type
          </label>
          <select
            id="district-type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="w-full px-4 py-2.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All district types</option>
            <option value="high_school">High school</option>
            <option value="unified">Unified</option>
            <option value="elementary">TK–8</option>
          </select>
        </div>
      </div>
      {isLoading && (
        <div role="status">
          <p className="text-sm text-muted-foreground mb-4">
            Loading districts…
          </p>
          <div
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-hidden="true"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-32 bg-card border border-card-border rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      )}
      {isError && (
        <div
          role="alert"
          className="rounded-xl border border-card-border bg-card p-5"
        >
          <p>Couldn't load school districts. Please try again.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 text-primary underline disabled:opacity-50"
          >
            Retry districts
          </button>
        </div>
      )}
      {!isLoading && !isError && districts && (
        <>
          <p className="text-sm text-muted-foreground mb-4" role="status">
            {districts.length} district{districts.length !== 1 ? "s" : ""} found
          </p>
          {districts.length === 0 && (
            <div className="rounded-xl border border-card-border bg-card p-6 text-center">
              <p className="text-muted-foreground">
                {hasFilters
                  ? "No districts match your filters."
                  : "No school districts are available."}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  className="mt-3 text-primary underline"
                  onClick={() => {
                    setSearch("");
                    setType("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          {[...groups]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([county, rows]) => (
              <section key={county} className="mb-10">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  {county}
                </h2>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {rows.map((district) => (
                    <DistrictCard key={district.id} district={district} />
                  ))}
                </div>
              </section>
            ))}
        </>
      )}
    </div>
  );
}

function DistrictCard({ district: d }: { district: District }) {
  return (
    <Link
      href={`/districts/${d.id}`}
      className="block bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow group"
    >
      <div className="flex flex-wrap items-start gap-2 mb-2">
        <h3 className="min-w-0 flex-1 basis-36 font-semibold text-foreground group-hover:text-primary transition-colors text-sm leading-snug break-words">
          {d.name}
        </h3>
        <span className="shrink-0 text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
          {districtTypeLabel(d.type)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {countyLabel(d.county)}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {d.memberCount.toLocaleString()}
          </span>{" "}
          members
        </span>
        <span>
          <span className="font-semibold text-primary tabular-nums">
            {d.openRequestCount.toLocaleString()}
          </span>{" "}
          open
        </span>
      </div>
    </Link>
  );
}
