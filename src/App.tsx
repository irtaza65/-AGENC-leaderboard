import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ExternalLink,
  RefreshCcw,
  Search,
} from "lucide-react";
import {
  fetchSnapshot,
  LeaderboardMode,
  LeaderboardRow,
  PROGRAM_ID,
  RPC_OPTIONS,
  Snapshot,
} from "./lib/agenc";
import { compactAddress, formatDate, formatNumber, formatScore } from "./lib/format";
import agentsIcon from "./assets/icons/agents.png";
import analyticsIcon from "./assets/icons/analytics-card.png";
import briefcaseIcon from "./assets/icons/briefcase.png";
import growthBarsIcon from "./assets/icons/growth-bars.png";
import skillKnightIcon from "./assets/icons/skill-knight.png";
import taskListIcon from "./assets/icons/task-list.png";
import trendLineIcon from "./assets/icons/trend-line.png";
import trophyIcon from "./assets/icons/trophy.png";

const modeLabels: Record<LeaderboardMode, string> = {
  skills: "Services",
  agents: "Agents",
  tasks: "Tasks",
  bids: "Bids",
};

const modeIcons: Record<LeaderboardMode, string> = {
  skills: skillKnightIcon,
  agents: agentsIcon,
  tasks: taskListIcon,
  bids: growthBarsIcon,
};

type SortKey = "score" | "name" | "activity" | "value" | "status";
const BOOTSTRAP_SNAPSHOT_URL = "/bootstrap-snapshot.json";

function hasDecodedRows(snapshot: Snapshot) {
  return Object.values(snapshot.rows).some((rows) => rows.length > 0);
}

function useLeaderboard(rpcUrl: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBootstrapSnapshot = async () => {
    const response = await fetch(BOOTSTRAP_SNAPSHOT_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Bootstrap snapshot unavailable: ${response.status}`);
    return (await response.json()) as Snapshot;
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    let hasFallbackSnapshot = Boolean(snapshot);

    if (!snapshot) {
      loadBootstrapSnapshot()
        .then((bootstrap) => {
          hasFallbackSnapshot = true;
          setSnapshot((current) => current ?? bootstrap);
        })
        .catch(() => {
          // Live RPC remains the source of truth; the bootstrap is only a resilience layer.
        });
    }

    try {
      const next = await fetchSnapshot(rpcUrl);
      setSnapshot((current) => (hasDecodedRows(next) || !current ? next : current));
      if (!hasDecodedRows(next) && !hasFallbackSnapshot) {
        setError("Live RPC refresh is temporarily unavailable; showing the bundled SDK/RPC snapshot.");
      }
    } catch (err) {
      setError(hasFallbackSnapshot ? null : err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [rpcUrl]);

  return { snapshot, loading, error, refresh };
}

function rankBuckets(rows: LeaderboardRow[]) {
  const max = Math.max(...rows.map((row) => row.score), 1);
  return rows.slice(0, 10).map((row) => ({
    id: row.id,
    label: `#${row.rank}`,
    pct: Math.max(8, (row.score / max) * 100),
    score: row.score,
  }));
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <img className="stat-icon" src={icon} alt="" />
    </div>
  );
}

function Evidence({ snapshot, selected }: { snapshot: Snapshot | null; selected: LeaderboardRow | null }) {
  return (
    <aside className="evidence">
      <div className="panel-title">
        <img className="panel-icon" src={analyticsIcon} alt="" />
        <h2>Source Evidence</h2>
      </div>
      <dl className="evidence-list">
        <div>
          <dt>Program ID</dt>
          <dd title={PROGRAM_ID}>{compactAddress(PROGRAM_ID)}</dd>
        </div>
        <div>
          <dt>RPC Source</dt>
          <dd>{snapshot?.stats.rpcUrl ?? "pending"}</dd>
        </div>
        <div>
          <dt>Last Refreshed</dt>
          <dd>{snapshot ? formatDate(Date.parse(snapshot.stats.refreshedAt) / 1000) : "pending"}</dd>
        </div>
        <div>
          <dt>Data Path</dt>
          <dd>{snapshot?.stats.source ?? "SDK + Solana RPC only"}</dd>
        </div>
      </dl>

      <div className="source-note">
        <CheckCircle2 size={16} />
        <span>No pump.fun explorer endpoint and no public AgenC API calls are used.</span>
      </div>

      <div className="selected-detail">
        <h3>{selected ? selected.name : "Select a row"}</h3>
        {selected ? (
          <dl>
            {Object.entries(selected.detail).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd title={value}>{value.length > 34 ? compactAddress(value) : value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>Click any leaderboard entry to inspect the decoded account identifiers behind the score.</p>
        )}
      </div>

      {snapshot?.warnings.length ? (
        <div className="warnings">
          <AlertTriangle size={16} />
          <div>
            <strong>Partial fetch</strong>
            <p>{snapshot.warnings[0]}</p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function LeaderboardTable({
  rows,
  rowIcon,
  sortKey,
  onSort,
  selectedId,
  onSelect,
}: {
  rows: LeaderboardRow[];
  rowIcon: string;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (row: LeaderboardRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>
              <button onClick={() => onSort("name")}>
                Name / ID <ArrowDownUp size={13} />
              </button>
            </th>
            <th>Author / Wallet</th>
            <th>Rating</th>
            <th>
              <button onClick={() => onSort("activity")}>
                Activity <ArrowDownUp size={13} />
              </button>
            </th>
            <th>
              <button onClick={() => onSort("value")}>
                Value <ArrowDownUp size={13} />
              </button>
            </th>
            <th>
              <button className={sortKey === "score" ? "active-sort" : ""} onClick={() => onSort("score")}>
                Score <ArrowDownUp size={13} />
              </button>
            </th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={selectedId === row.id ? "selected" : ""}
              onClick={() => onSelect(row)}
            >
              <td>
                <span className="rank">#{row.rank}</span>
              </td>
              <td>
                <div className="name-cell">
                  <img className="row-icon" src={rowIcon} alt="" />
                  <div>
                    <strong>{row.name}</strong>
                    <span>{compactAddress(row.id)}</span>
                  </div>
                </div>
              </td>
              <td>
                <strong>{row.primary}</strong>
                <span>{row.secondary}</span>
              </td>
              <td>{row.rating}</td>
              <td>{row.activity}</td>
              <td>{row.value}</td>
              <td>
                <span className="score">{formatScore(row.score)}</span>
              </td>
              <td>
                <span className={`status ${row.status.toLowerCase().replace(/\s+/g, "-")}`}>{row.status}</span>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="empty">No decoded accounts found for this view yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [rpcUrl, setRpcUrl] = useState(RPC_OPTIONS[0]);
  const [customRpc, setCustomRpc] = useState("");
  const [mode, setMode] = useState<LeaderboardMode>("agents");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selected, setSelected] = useState<LeaderboardRow | null>(null);
  const { snapshot, loading, error, refresh } = useLeaderboard(rpcUrl);

  const activeRows = snapshot?.rows[mode] ?? [];
  const rows = useMemo(() => {
    const filtered = activeRows.filter((row) => {
      const haystack = `${row.name} ${row.primary} ${row.secondary} ${row.status} ${row.id}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === "score") return b.score - a.score;
      return String(a[sortKey]).localeCompare(String(b[sortKey]));
    });
  }, [activeRows, query, sortKey]);

  useEffect(() => {
    setSelected(null);
  }, [mode, rpcUrl]);

  const buckets = rankBuckets(rows);
  const stats = snapshot?.stats;
  const chartKey = `${mode}-${loading ? "loading" : "ready"}-${buckets
    .map((bucket) => `${bucket.id}:${bucket.score}`)
    .join("|")}`;
  const emptyChartText = loading && !snapshot ? "Loading decoded leaderboard rows" : "Awaiting decoded leaderboard rows";

  const applyCustomRpc = () => {
    const value = customRpc.trim();
    if (value) setRpcUrl(value);
  };

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <img className="brand-icon" src={trophyIcon} alt="" />
          <div>
            <h1>AgenC Marketplace Leaderboard</h1>
            <p>Live account rankings from the canary coordination program</p>
          </div>
        </div>
        <div className="actions">
          <select value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} aria-label="RPC endpoint">
            {[...new Set([rpcUrl, ...RPC_OPTIONS])].map((url) => (
              <option key={url} value={url}>
                {url}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={refresh} disabled={loading} title="Refresh leaderboard">
            <RefreshCcw size={17} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      <section className="status-strip">
        <Stat icon={agentsIcon} label="Agents" value={formatNumber(stats?.agents ?? 0)} />
        <Stat icon={skillKnightIcon} label="Services" value={formatNumber((stats?.skills ?? 0) + (stats?.listings ?? 0))} />
        <Stat icon={taskListIcon} label="Tasks" value={formatNumber(stats?.tasks ?? 0)} />
        <Stat icon={growthBarsIcon} label="Bids" value={formatNumber(stats?.bids ?? 0)} />
        <Stat icon={briefcaseIcon} label="Listings" value={formatNumber(stats?.listings ?? 0)} />
        <Stat icon={analyticsIcon} label="Purchases" value={formatNumber(stats?.purchases ?? 0)} />
      </section>

      <section className="workspace">
        <div className="leaderboard">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Leaderboard mode">
              {(Object.keys(modeLabels) as LeaderboardMode[]).map((key) => (
                <button key={key} className={mode === key ? "active" : ""} onClick={() => setMode(key)}>
                  <img className="tab-icon" src={modeIcons[key]} alt="" />
                  {modeLabels[key]}
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter wallet, PDA, status..."
              />
            </label>
          </div>

          <div className="custom-rpc">
            <input
              value={customRpc}
              onChange={(event) => setCustomRpc(event.target.value)}
              placeholder="Optional custom Solana RPC URL"
            />
            <button onClick={applyCustomRpc}>Use RPC</button>
            <a href={`https://explorer.solana.com/address/${PROGRAM_ID}`} target="_blank" rel="noreferrer">
              Program <ExternalLink size={13} />
            </a>
          </div>

          <div className="chart-panel">
            <div>
              <img className="section-icon" src={trendLineIcon} alt="" />
              <strong>Top score distribution</strong>
            </div>
            {buckets.length ? (
              <div key={chartKey} className="bars">
                {buckets.map((bucket, index) => (
                  <span
                    key={`${bucket.id}-${bucket.score}`}
                    style={
                      {
                        "--bar-height": `${bucket.pct}%`,
                        animationDelay: `${index * 70}ms`,
                      } as CSSProperties
                    }
                    title={`${bucket.label}: ${bucket.pct.toFixed(1)}%`}
                  >
                    <em>{bucket.label}</em>
                  </span>
                ))}
              </div>
            ) : (
              <div key={chartKey} className="chart-empty">
                <div className="ghost-bars" aria-hidden="true">
                  {[34, 58, 42, 74, 50, 66, 38].map((height, index) => (
                    <span
                      key={height}
                      style={
                        {
                          "--bar-height": `${height}%`,
                          animationDelay: `${index * 65}ms`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
                <span>{emptyChartText}</span>
              </div>
            )}
          </div>

          {error ? <div className="error">{error}</div> : null}
          {loading && !snapshot ? <div className="loading">Fetching decoded protocol accounts...</div> : null}
          <LeaderboardTable
            rows={rows}
            rowIcon={modeIcons[mode]}
            sortKey={sortKey}
            onSort={setSortKey}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
        </div>
        <Evidence snapshot={snapshot} selected={selected} />
      </section>

      <footer>
        <span>{stats?.sdkWeights ?? "SDK scoring constants pending"}</span>
      </footer>
    </main>
  );
}
