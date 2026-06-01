// AgentsPage — template baseline (MJOS-074).
//
// Lists agents from /api/agents. Simple structured page; tenants can rebuild
// this once they have a feel for what they want their agent stack to look like.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Users } from "lucide-react";
import { useApi } from "@/lib/api";

type AgentRow = {
  name: string;
  display_name: string;
  voice_kokoro: string;
  voice_mcp: string | null;
  color: string | null;
  current_ticket_id: string | null;
};

export function AgentsPage() {
  const api = useApi();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/agents");
        if (!res.ok) {
          setError(`Failed (${res.status})`);
          return;
        }
        // /api/agents returns a bare array; tolerate a legacy { agents } envelope too.
        const data = (await res.json()) as AgentRow[] | { agents?: AgentRow[] };
        if (!cancelled) setAgents(Array.isArray(data) ? data : (data.agents ?? []));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div className="w-full px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-500/15">
          <Users className="h-5 w-5 text-stone-600 dark:text-stone-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Personas wired into the dashboard. Each one is one row in the
            <code className="ml-1">agents</code> table.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!agents && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}

      {agents && agents.length === 0 && (
        <div className="rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground">
          No agents seeded yet.
        </div>
      )}

      {agents && agents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Link
              key={a.name}
              to={`/agents/${a.name}`}
              className="flex flex-col gap-2 rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: a.color ?? "#888" }}
                >
                  {a.display_name.charAt(0)}
                </div>
                <div>
                  <div className="text-base font-semibold text-foreground">
                    {a.display_name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    voice · {a.voice_kokoro}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
