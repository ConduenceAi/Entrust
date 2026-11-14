import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { describeReason, formatUsdc, isX402, USDC_CONTRACT } from "@nearfirewall/sdk";
import { config, explorerTx, policyOf } from "../config.ts";
import { activityTransactions, type ActivityLookup } from "../activity-transactions.ts";
import { useWorkspaceRegistry } from "../workspace-registry.tsx";
import { near, timeText } from "../format.ts";
import { useAsync } from "../hooks.ts";
import { useWallet } from "../wallet.tsx";

type Kind = "paid" | "blocked" | "registry" | "failed" | "awaiting";

interface Entry {
  key: string;
  at: bigint;
  agent: string;
  recipient: string;
  amount: bigint;
  /** An x402 payment: the amount is USDC and the recipient is the seller. */
  x402?: boolean;
  kind: Kind;
  detail: string;
  connection?: string;
  lookup: ActivityLookup;
}

const FILTERS: { id: "all" | Kind; label: string; tone: "lime" | "sky" | "coral" }[] = [
  { id: "all", label: "All", tone: "lime" },
  { id: "paid", label: "Paid", tone: "lime" },
  { id: "blocked", label: "Blocked", tone: "coral" },
  { id: "registry", label: "Registry", tone: "coral" },
  { id: "failed", label: "Failed", tone: "sky" },
  { id: "awaiting", label: "Awaiting confirmation", tone: "sky" },
];

const DOT: Record<Kind, string> = { paid: "", blocked: "denied", registry: "denied", failed: "failed", awaiting: "failed" };

const POLICY_OUTCOMES = {
  settled: { kind: "paid", detail: "Paid" },
  denied: { kind: "blocked", detail: "Denied" },
  failed: { kind: "failed", detail: "Transfer failed. The reservation was released." },
  awaiting: { kind: "awaiting", detail: "Waiting for owner confirmation" },
  declined: { kind: "blocked", detail: "Declined by the owner" },
  expired: { kind: "blocked", detail: "Confirmation expired" },
} as const;

const POLICY_EVENTS = {
  settled: "payment_settled",
  denied: "payment_denied",
  failed: "payment_failed",
  awaiting: "payment_awaiting_confirmation",
  declined: "payment_declined",
  expired: "payment_declined",
} as const;

/**
 * Read activity from the contracts, then look up its transaction links separately.
 */
export function ActivityPanel() {
  const { accountId } = useWallet();
  const { registry, policyCodeHash } = useWorkspaceRegistry();
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const data = useAsync(async () => {
    if (!accountId) return [] as Entry[];
    const policy = policyOf(accountId);
    const state = await policy.state(policyCodeHash);
    const view = state.kind === "enabled" ? await policy.getPolicy() : null;
    const payments = view?.registry === registry.registryId ? await policy.getActivity(64) : [];
    const agents = await registry.agentsOf(accountId);
    const handles = new Map(agents.map((a) => [a.agent_id, a.handle]));
    const routed = await Promise.all(
      agents.map(async (a) => (await registry.getActivity(a.agent_id)).map((entry) => ({ agent: a.handle, ...entry }))),
    );

    const entries: Entry[] = payments.map((p) => ({
      key: `p-${p.seq}`,
      at: p.at,
      agent: handles.get(p.leaf) ?? `#${p.leaf}`,
      recipient: p.recipient,
      amount: p.amount,
      x402: isX402(p.via),
      ...POLICY_OUTCOMES[p.outcome],
      detail: p.outcome === "denied" && p.reason ? describeReason(p.reason) : POLICY_OUTCOMES[p.outcome].detail,
      connection: p.via && p.via.kind !== "executor" ? [p.via.label, p.client].filter(Boolean).join(" · ") : undefined,
      lookup: {
        key: `p-${p.seq}`, contract: accountId, agentId: p.leaf, requestId: p.request_id,
        at: p.at, event: POLICY_EVENTS[p.outcome],
        ...(p.outcome === "settled" && p.via?.kind === "x402"
          ? { payment: { account: p.via.payment_account, recipient: p.recipient, amount: p.amount, asset: USDC_CONTRACT[config.network] } }
          : {}),
      },
    }));
    for (const e of routed.flat()) {
      if (e.outcome !== "denied") continue;
      const x402 = e.action.type === "X402Pay";
      entries.push({
        key: `r-${e.agent_id}-${e.seq}`,
        at: e.at,
        agent: e.agent,
        recipient: e.action.type === "X402Pay" ? e.action.pay_to : e.action.recipient,
        amount: e.action.amount,
        x402,
        kind: "registry",
        detail: e.reason ? describeReason(e.reason) : "Blocked before reaching your account",
        lookup: {
          key: `r-${e.agent_id}-${e.seq}`, contract: registry.registryId, agentId: e.agent_id,
          requestId: e.request_id, at: e.at, event: "execution_denied",
        },
      });
    }
    return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [accountId, registry, policyCodeHash]);

  const hashes = useAsync(async () => ({
    rows: data.data,
    transactions: accountId && data.data ? await activityTransactions(accountId, data.data.map((e) => e.lookup)) : null,
  }), [accountId, data.data]);
  const all = data.data ?? [];
  const agentNames = useMemo(() => [...new Set(all.map((e) => e.agent))].sort(), [all]);
  const byAgent = all.filter((e) => agentFilter === "all" || e.agent === agentFilter);
  const shown = byAgent.filter((e) => filter === "all" || e.kind === filter);
  const count = (id: "all" | Kind) => (id === "all" ? byAgent.length : byAgent.filter((e) => e.kind === id).length);

  if (!accountId) return <p className="muted">Connect a wallet to see activity.</p>;

  return (
    <section className="activity-panel" aria-labelledby="activity-heading">
      <h1 id="activity-heading" className="visually-hidden">Activity</h1>
      <div className="toolbar">
        <div className="pills" role="group" aria-label="Filter by outcome">
          {FILTERS.map((f) => (
            <button key={f.id} className={`pill ${f.tone === "lime" ? "" : f.tone}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="count">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={data.reload} disabled={data.loading} aria-label="Refresh" title="Refresh">
          <RefreshCw size={18} className={data.loading ? "spin" : ""} />
        </button>
      </div>

      {agentNames.length > 1 && (
        <>
          <div className="pill-group-label">Agent</div>
          <div className="pills" role="group" aria-label="Filter by agent">
            {["all", ...agentNames].map((name) => (
              <button key={name} className="pill sky" aria-pressed={agentFilter === name} onClick={() => setAgentFilter(name)}>
                {name === "all" ? "Every agent" : name}
              </button>
            ))}
          </div>
        </>
      )}

      {data.error && <p className="notice error">{data.error}</p>}

      {shown.length === 0 ? (
        <p className="empty">{data.loading ? "Loading…" : all.length === 0 ? "Nothing has been attempted yet." : "No entries match these filters."}</p>
      ) : (
        <ul className="feed">
          {shown.map((e) => {
            const links = hashes.data?.rows === data.data ? hashes.data?.transactions?.get(e.key) : undefined;
            const hash = links?.settlement ?? links?.transaction;
            const label = links?.settlement ? "Settlement hash" : e.x402 && e.kind === "paid" ? "Funding hash" : "Transaction hash";
            return (
            <li key={e.key}>
              <span className={`dot ${DOT[e.kind]}`} aria-hidden="true" />
              <span className="title">
                {e.agent} → {e.recipient}
              </span>
              <span className="amount">{e.x402 ? `${formatUsdc(e.amount)} USDC (x402)` : near(e.amount)}</span>
              <span className="sub">{e.kind === "registry" ? `Blocked by the registry: ${e.detail}` : e.detail}{e.connection && ` · ${e.connection}`}</span>
              <span className="when">{timeText(e.at)}</span>
              <span className="sub">
                {hash ? <a href={explorerTx(hash)} target="_blank" rel="noreferrer">{label}: <code>{hash}</code></a>
                  : hashes.loading || hashes.data?.rows !== data.data ? "Looking up transaction…"
                    : "Transaction hash unavailable"}
                {links?.settlement && links.transaction && (
                  <> · <a href={explorerTx(links.transaction)} target="_blank" rel="noreferrer">Funding hash: <code>{links.transaction}</code></a></>
                )}
              </span>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
