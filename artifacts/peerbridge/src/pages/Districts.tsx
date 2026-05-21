import { useState } from "react";
import { Link } from "wouter";
import { useListDistricts, getListDistrictsQueryKey } from "@workspace/api-client-react";

export default function Districts() {
  const [search, setSearch] = useState("");

  const params = {
    type: "high_school" as const,
    ...(search ? { search } : {}),
  };

  const { data: districts, isLoading } = useListDistricts(params, {
    query: { queryKey: getListDistrictsQueryKey(params) }
  });

  const santaClaraDistricts = districts?.filter(d => d.county === "Santa Clara") ?? [];
  const alamedaDistricts = districts?.filter(d => d.county === "Alameda") ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">High School District Channels</h1>
        <p className="text-muted-foreground mt-1">
          Bay Area school districts near Cupertino and Fremont — find yours to connect with nearby students.
        </p>
      </div>

      <input
        type="search"
        placeholder="Search districts by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md px-4 py-2.5 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition mb-8"
      />

      {isLoading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-24 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && districts && (
        <>
          {!search && (
            <>
              <DistrictGroup title="Santa Clara County" subtitle="Cupertino, Sunnyvale, San Jose, Palo Alto area" districts={santaClaraDistricts} />
              <DistrictGroup title="Alameda County" subtitle="Fremont, Newark, Hayward, Castro Valley area" districts={alamedaDistricts} />
            </>
          )}
          {search && (
            <>
              <p className="text-sm text-muted-foreground mb-4">{districts.length} district{districts.length !== 1 ? "s" : ""} found</p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {districts.map((d) => <DistrictCard key={d.id} district={d} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function DistrictGroup({ title, subtitle, districts }: {
  title: string;
  subtitle: string;
  districts: { id: number; name: string; county: string; type: string; memberCount: number; openRequestCount: number }[];
}) {
  if (districts.length === 0) return null;
  return (
    <div className="mb-10">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {districts.map((d) => <DistrictCard key={d.id} district={d} />)}
      </div>
    </div>
  );
}

function DistrictCard({ district: d }: { district: { id: number; name: string; county: string; type: string; memberCount: number; openRequestCount: number } }) {
  return (
    <Link href={`/districts/${d.id}`}>
      <div className="bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer group">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm leading-snug flex-1">
            {d.name}
          </h3>
          <span className="shrink-0 ml-2 text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
            HS
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{d.county} County</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{d.memberCount}</span> members
          </span>
          <span>
            <span className="font-semibold text-primary">{d.openRequestCount}</span> open
          </span>
        </div>
      </div>
    </Link>
  );
}
