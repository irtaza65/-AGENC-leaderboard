import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  AGENC_COORDINATION_IDL,
  AGENC_COORDINATION_PROGRAM_ADDRESS,
} from "@tetsuo-ai/protocol";
import {
  asBase58,
  bytesToLabel,
  compactAddress,
  enumLabel,
  formatSol,
  toBigInt,
  toNumber,
} from "./format";

export const PROGRAM_ID = AGENC_COORDINATION_PROGRAM_ADDRESS;
const BPS_BASE = 10_000;
const SDK_WEIGHTED_SCORE_WEIGHTS = {
  priceWeightBps: 4_000,
  etaWeightBps: 3_000,
  confidenceWeightBps: 2_000,
  reliabilityWeightBps: 1_000,
};
const SDK_FEE_TIERS = [
  [0, 0],
  [50, 10],
  [200, 25],
  [1000, 40],
] as const;

export const RPC_OPTIONS = [
  "/api/solana-rpc",
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
];

export type LeaderboardMode = "skills" | "agents" | "tasks" | "bids";

export type LeaderboardRow = {
  id: string;
  rank: number;
  name: string;
  primary: string;
  secondary: string;
  rating: string;
  activity: string;
  value: string;
  score: number;
  status: string;
  kind: LeaderboardMode;
  detail: Record<string, string>;
};

export type Snapshot = {
  rows: Record<LeaderboardMode, LeaderboardRow[]>;
  stats: {
    agents: number;
    skills: number;
    tasks: number;
    bids: number;
    listings: number;
    purchases: number;
    rpcUrl: string;
    programId: string;
    refreshedAt: string;
    source: string;
    sdkWeights: string;
  };
  warnings: string[];
};

type AccountRecord<T = Record<string, unknown>> = {
  publicKey: PublicKey;
  account: T;
};

type AccountNamespace = {
  all: () => Promise<AccountRecord[]>;
};

type ProgramWithAccounts = Program & {
  account: Record<string, AccountNamespace | undefined>;
};

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 7_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} RPC request exceeded ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timer));
  });
}

function makeProvider(connection: Connection): AnchorProvider {
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };

  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function makeProgram(connection: Connection): ProgramWithAccounts {
  const idl = {
    ...(AGENC_COORDINATION_IDL as Idl),
    address: PROGRAM_ID,
  };
  return new Program(idl, makeProvider(connection)) as ProgramWithAccounts;
}

function discriminatorFor(idlName: string): string {
  const account = (AGENC_COORDINATION_IDL.accounts ?? []).find((entry) => entry.name === idlName);
  if (!account?.discriminator) {
    throw new Error(`IDL discriminator not found: ${idlName}`);
  }
  return Buffer.from(account.discriminator).toString("base64");
}

async function postRpc(rpcUrl: string, body: unknown): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    const message = payload.error?.message ?? response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload.result;
}

async function rawAccounts(
  program: ProgramWithAccounts,
  rpcUrl: string,
  accountName: string,
  idlName: string,
): Promise<AccountRecord[]> {
  const result = await postRpc(rpcUrl, {
    jsonrpc: "2.0",
    id: `${accountName}-${Date.now()}`,
    method: "getProgramAccounts",
    params: [
      PROGRAM_ID,
      {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: discriminatorFor(idlName),
              encoding: "base64",
            },
          },
        ],
      },
    ],
  });

  return (result as Array<{ pubkey: string; account: { data: [string, string] } }>).map((entry) => ({
    publicKey: new PublicKey(entry.pubkey),
    account: program.coder.accounts.decode(accountName, Buffer.from(entry.account.data[0], "base64")) as Record<string, unknown>,
  }));
}

function scoreSkill(account: Record<string, unknown>): number {
  const ratings = toNumber(account.ratingCount ?? account.rating_count);
  const avg = ratings
    ? toNumber(account.totalRating ?? account.total_rating) / ratings / 2_000
    : 0;
  const purchases = toNumber(account.downloadCount ?? account.download_count);
  const revenue = Number(toBigInt(account.price) * BigInt(Math.max(purchases, 1))) / 1_000_000_000;
  const activeBoost = Boolean(account.isActive ?? account.is_active) ? 12 : -10;
  return avg * 22 + Math.log10(purchases + 1) * 18 + Math.log10(revenue + 1) * 12 + activeBoost;
}

function scoreAgent(account: Record<string, unknown>, market?: Record<string, unknown>): number {
  const reputation = toNumber(account.reputation) / 100;
  const completed = toNumber(account.tasksCompleted ?? account.tasks_completed);
  const earned = Number(toBigInt(account.totalEarned ?? account.total_earned)) / 1_000_000_000;
  const stake = Number(toBigInt(account.stake)) / 1_000_000_000;
  const accepted = toNumber(market?.totalBidsAccepted ?? market?.total_bids_accepted);
  const created = toNumber(market?.totalBidsCreated ?? market?.total_bids_created);
  return reputation * 0.45 + Math.log10(completed + 1) * 24 + Math.log10(earned + stake + 1) * 10 + accepted * 2 + created * 0.35;
}

function scoreTask(account: Record<string, unknown>, bidBook?: Record<string, unknown>): number {
  const reward = Number(toBigInt(account.rewardAmount ?? account.reward_amount)) / 1_000_000_000;
  const completions = toNumber(account.completions);
  const workers = toNumber(account.currentWorkers ?? account.current_workers);
  const totalBids = toNumber(bidBook?.totalBids ?? bidBook?.total_bids);
  const completedAt = toNumber(account.completedAt ?? account.completed_at);
  return Math.log10(reward + 1) * 25 + completions * 12 + workers * 5 + totalBids * 3 + (completedAt ? 20 : 0);
}

function scoreBid(account: Record<string, unknown>, task?: Record<string, unknown>): number {
  const budget = Number(toBigInt(task?.rewardAmount ?? task?.reward_amount)) || Number(toBigInt(account.requestedRewardLamports ?? account.requested_reward_lamports));
  const ask = Number(toBigInt(account.requestedRewardLamports ?? account.requested_reward_lamports));
  const eta = toNumber(account.etaSeconds ?? account.eta_seconds);
  const confidence = toNumber(account.confidenceBps ?? account.confidence_bps);
  const reliability = toNumber(account.reputationSnapshotBps ?? account.reputation_snapshot_bps);
  const priceScore = budget > 0 ? Math.max(0, (budget - ask) / budget) * BPS_BASE : 0;
  const etaScore = eta > 0 ? Math.max(0, 10_000 - Math.min(eta, 86_400) / 8.64) : 0;
  const weights = SDK_WEIGHTED_SCORE_WEIGHTS;
  return (
    priceScore * weights.priceWeightBps +
    etaScore * weights.etaWeightBps +
    confidence * weights.confidenceWeightBps +
    reliability * weights.reliabilityWeightBps
  ) / BPS_BASE / 100;
}

function sortAndRank(kind: LeaderboardMode, rows: Omit<LeaderboardRow, "rank" | "kind">[]): LeaderboardRow[] {
  return rows
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ...row, kind, rank: index + 1 }));
}

export async function fetchSnapshot(rpcUrl: string): Promise<Snapshot> {
  const resolvedRpcUrl = new URL(rpcUrl, window.location.origin).toString();
  const connection = new Connection(resolvedRpcUrl, "confirmed");
  const program = makeProgram(connection);
  const warnings: string[] = [];

  const safeAll = async (accountName: string, idlName: string) => {
    try {
      return await withTimeout(rawAccounts(program, resolvedRpcUrl, accountName, idlName), accountName, 12_000);
    } catch (error) {
      warnings.push(`${accountName}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  const [agents, tasks, listings, skills, purchases, bidBooks, bids, bidderMarkets] = await Promise.all([
    safeAll("agentRegistration", "AgentRegistration"),
    safeAll("task", "Task"),
    safeAll("serviceListing", "ServiceListing"),
    safeAll("skillRegistration", "SkillRegistration"),
    safeAll("purchaseRecord", "PurchaseRecord"),
    safeAll("taskBidBook", "TaskBidBook"),
    safeAll("taskBid", "TaskBid"),
    safeAll("bidderMarketState", "BidderMarketState"),
  ]);

  const agentsByPda = new Map(agents.map((entry) => [entry.publicKey.toBase58(), entry]));
  const tasksByPda = new Map(tasks.map((entry) => [entry.publicKey.toBase58(), entry]));
  const bidBooksByTask = new Map(
    bidBooks.map((entry) => [asBase58(entry.account.task), entry]),
  );
  const marketsByBidder = new Map(
    bidderMarkets.map((entry) => [asBase58(entry.account.bidder), entry.account]),
  );

  const legacySkillRows = skills.map(({ publicKey, account }) => {
    const author = agentsByPda.get(asBase58(account.author));
    const ratings = toNumber(account.ratingCount ?? account.rating_count);
    const avg = ratings
      ? toNumber(account.totalRating ?? account.total_rating) / ratings / 2_000
      : 0;
    const purchasesCount = toNumber(account.downloadCount ?? account.download_count);
    return {
      id: publicKey.toBase58(),
      name: bytesToLabel(account.name, `Skill ${compactAddress(publicKey)}`),
      primary: compactAddress(asBase58(account.author)),
      secondary: author ? compactAddress(asBase58(author.account.authority)) : "author agent",
      rating: ratings ? `${avg.toFixed(2)} / 5` : "unrated",
      activity: `${purchasesCount.toLocaleString()} purchases`,
      value: formatSol(toBigInt(account.price) * BigInt(Math.max(purchasesCount, 1))),
      score: scoreSkill(account),
      status: Boolean(account.isActive ?? account.is_active) ? "active" : "inactive",
      detail: {
        "Skill PDA": publicKey.toBase58(),
        "Author Agent": asBase58(account.author),
        "Content Hash": [...((account.contentHash ?? account.content_hash ?? []) as number[])].slice(0, 8).join(" "),
        "Version": String(toNumber(account.version)),
      },
    };
  });

  const listingRows = listings.map(({ publicKey, account }) => {
    const provider = agentsByPda.get(asBase58(account.providerAgent ?? account.provider_agent));
    const ratings = toNumber(account.ratingCount ?? account.rating_count);
    const avg = ratings ? toNumber(account.totalRating ?? account.total_rating) / ratings / 2_000 : 0;
    const hires = toNumber(account.totalHires ?? account.total_hires);
    const score =
      avg * 22 +
      Math.log10(hires + 1) * 22 +
      Math.log10(Number(toBigInt(account.price)) / 1_000_000_000 + 1) * 12 +
      (enumLabel(account.state).toLowerCase().includes("active") ? 14 : 0);
    return {
      id: publicKey.toBase58(),
      name: bytesToLabel(account.name, `Listing ${compactAddress(publicKey)}`),
      primary: compactAddress(asBase58(account.providerAgent ?? account.provider_agent)),
      secondary: provider ? compactAddress(asBase58(provider.account.authority)) : compactAddress(asBase58(account.authority)),
      rating: ratings ? `${avg.toFixed(2)} / 5` : "unrated",
      activity: `${hires.toLocaleString()} hires`,
      value: formatSol(account.price),
      score,
      status: enumLabel(account.state),
      detail: {
        "Listing PDA": publicKey.toBase58(),
        "Provider Agent": asBase58(account.providerAgent ?? account.provider_agent),
        Authority: asBase58(account.authority),
        "Open Jobs": `${toNumber(account.openJobs ?? account.open_jobs)}/${toNumber(account.maxOpenJobs ?? account.max_open_jobs) || "unlimited"}`,
      },
    };
  });

  const skillRows = sortAndRank(
    "skills",
    [...legacySkillRows, ...listingRows],
  );

  const agentRows = sortAndRank(
    "agents",
    agents.map(({ publicKey, account }) => {
      const market = marketsByBidder.get(publicKey.toBase58());
      return {
        id: publicKey.toBase58(),
        name: `Agent ${compactAddress(publicKey)}`,
        primary: compactAddress(publicKey),
        secondary: compactAddress(asBase58(account.authority)),
        rating: `${(toNumber(account.reputation) / 100).toFixed(1)} rep`,
        activity: `${toNumber(account.tasksCompleted ?? account.tasks_completed).toLocaleString()} tasks`,
        value: `${formatSol(account.totalEarned ?? account.total_earned)} earned`,
        score: scoreAgent(account, market),
        status: enumLabel(account.status),
        detail: {
          "Agent PDA": publicKey.toBase58(),
          Authority: asBase58(account.authority),
          Stake: formatSol(account.stake),
          "Bids Accepted": String(toNumber(market?.totalBidsAccepted ?? market?.total_bids_accepted)),
        },
      };
    }),
  );

  const taskRows = sortAndRank(
    "tasks",
    tasks.map(({ publicKey, account }) => {
      const bidBook = bidBooksByTask.get(publicKey.toBase58())?.account;
      return {
        id: publicKey.toBase58(),
        name: `Task ${compactAddress(publicKey)}`,
        primary: compactAddress(asBase58(account.creator)),
        secondary: `${toNumber(account.currentWorkers ?? account.current_workers)}/${toNumber(account.maxWorkers ?? account.max_workers)} workers`,
        rating: enumLabel(account.status),
        activity: `${toNumber(bidBook?.totalBids ?? bidBook?.total_bids)} bids`,
        value: formatSol(account.rewardAmount ?? account.reward_amount),
        score: scoreTask(account, bidBook),
        status: enumLabel(account.taskType ?? account.task_type),
        detail: {
          "Task PDA": publicKey.toBase58(),
          Creator: asBase58(account.creator),
          "Min Reputation": String(toNumber(account.minReputation ?? account.min_reputation)),
          "Operator Fee": `${toNumber(account.operatorFeeBps ?? account.operator_fee_bps)} bps`,
        },
      };
    }),
  );

  const bidRows = sortAndRank(
    "bids",
    bids.map(({ publicKey, account }) => {
      const task = tasksByPda.get(asBase58(account.task))?.account;
      return {
        id: publicKey.toBase58(),
        name: `Bid ${compactAddress(publicKey)}`,
        primary: compactAddress(asBase58(account.bidder)),
        secondary: compactAddress(asBase58(account.task)),
        rating: `${(toNumber(account.confidenceBps ?? account.confidence_bps) / 100).toFixed(1)}% conf`,
        activity: `${Math.round(toNumber(account.etaSeconds ?? account.eta_seconds) / 60).toLocaleString()} min ETA`,
        value: formatSol(account.requestedRewardLamports ?? account.requested_reward_lamports),
        score: scoreBid(account, task),
        status: enumLabel(account.state),
        detail: {
          "Bid PDA": publicKey.toBase58(),
          Task: asBase58(account.task),
          Bidder: asBase58(account.bidder),
          Bond: formatSol(account.bondLamports ?? account.bond_lamports),
        },
      };
    }),
  );

  return {
    rows: {
      skills: skillRows,
      agents: agentRows,
      tasks: taskRows,
      bids: bidRows,
    },
    stats: {
      agents: agents.length,
      skills: skills.length,
      tasks: tasks.length,
      bids: bids.length,
      listings: listings.length,
      purchases: purchases.length,
      rpcUrl: rpcUrl === "/api/solana-rpc" ? "same-origin /api/solana-rpc -> Solana mainnet RPC" : rpcUrl,
      programId: PROGRAM_ID,
      refreshedAt: new Date().toISOString(),
      source: "SDK + Solana RPC only",
      sdkWeights: `SDK weighted bid weights ${SDK_WEIGHTED_SCORE_WEIGHTS.priceWeightBps}/${SDK_WEIGHTED_SCORE_WEIGHTS.etaWeightBps}/${SDK_WEIGHTED_SCORE_WEIGHTS.confidenceWeightBps}/${SDK_WEIGHTED_SCORE_WEIGHTS.reliabilityWeightBps}; fee tiers ${SDK_FEE_TIERS.length}`,
    },
    warnings,
  };
}
