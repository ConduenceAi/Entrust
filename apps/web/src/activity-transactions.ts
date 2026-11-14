import { config } from "./config.ts";

export interface ActivityLookup {
  key: string;
  contract: string;
  agentId: string;
  requestId: string;
  at: bigint;
  event: string;
  payment?: { account: string; recipient: string; amount: bigint; asset: string };
}

interface IndexedRow {
  transaction_hash: string;
  receiver_account_id?: string;
  block?: { block_timestamp: string };
  block_timestamp?: string;
  affected_account_id?: string;
  involved_account_id?: string;
  contract_account_id?: string;
  delta_amount?: string;
  receipt_id?: string;
}

interface Receipt {
  receipt_id: string;
  block?: { block_timestamp: string };
  outcome?: { executor_account_id: string; logs: string[] };
  receipts?: Receipt[];
}

const api = import.meta.env.VITE_TRANSACTION_INDEX_URL ||
  (config.network === "mainnet" ? "https://api.nearblocks.io/v3" : "https://api-testnet.nearblocks.io/v3");
const validHash = (hash: string) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash);

async function indexed<T>(path: string) {
  const response = await fetch(`${api.replace(/\/$/, "")}/${path}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Transaction index returned HTTP ${response.status}`);
  return await response.json() as { data: T[]; meta?: { next_page?: string } };
}

async function history(account: string, type: "receipts" | "ft-txns", oldest: bigint) {
  const rows: IndexedRow[] = [];
  let page: string | undefined;
  for (let i = 0; i < 4; i++) {
    const params = new URLSearchParams({ limit: "100" });
    if (page) params.set("next", page);
    const result = await indexed<IndexedRow>(
      `accounts/${encodeURIComponent(account)}/${type}?${params}`,
    ).catch(() => null);
    if (!result) break;
    rows.push(...result.data);
    const last = result.data.at(-1);
    const timestamp = last?.block_timestamp ?? last?.block?.block_timestamp;
    page = result.meta?.next_page;
    if (!page || !last || (timestamp && BigInt(timestamp) + 1024n < oldest)) break;
  }
  return rows;
}

function* flatten(receipts: Receipt[]): Generator<Receipt> {
  for (const receipt of receipts) {
    yield receipt;
    if (receipt.receipts) yield* flatten(receipt.receipts);
  }
}

function sameTime(timestamp: string | undefined, at: bigint) {
  if (!timestamp) return false;
  // The SDK receives the contract's JSON u64 as a number before converting to bigint.
  const difference = BigInt(timestamp) - at;
  return difference >= -1024n && difference <= 1024n;
}

function hasEvent(receipt: Receipt, row: ActivityLookup, payer: string) {
  if (receipt.outcome?.executor_account_id !== row.contract || !sameTime(receipt.block?.block_timestamp, row.at)) return false;
  return receipt.outcome.logs.some((log) => {
    if (!log.startsWith("EVENT_JSON:")) return false;
    try {
      const event = JSON.parse(log.slice("EVENT_JSON:".length));
      return event.standard === "nearfirewall" && event.event === row.event &&
        event.data?.request_id === row.requestId &&
        (event.data.leaf === row.agentId || (event.data.agent_id === row.agentId && event.data.payer === payer));
    } catch {
      return false;
    }
  });
}

export async function activityTransactions(payer: string, rows: ActivityLookup[]) {
  const oldest = (items: ActivityLookup[]) => items.reduce((at, row) => row.at < at ? row.at : at, items[0]!.at);
  const transactions = new Map<string, { transaction?: string; settlement?: string }>();
  const receipts = new Map<string, Promise<Receipt[]>>();
  const details = (hash: string) => {
    let result = receipts.get(hash);
    if (!result) {
      result = indexed<Receipt>(`txns/${hash}/receipts`).then(({ data }) => [...flatten(data)]).catch(() => []);
      receipts.set(hash, result);
    }
    return result;
  };
  const contracts = [...new Set(rows.map((row) => row.contract))];
  await Promise.allSettled(contracts.map(async (contract) => {
    const items = rows.filter((row) => row.contract === contract);
    const indexedRows = await history(contract, "receipts", oldest(items));
    const candidates = new Map<string, ActivityLookup[]>();
    for (const item of items) {
      for (const receipt of indexedRows) {
        if (receipt.receiver_account_id !== contract || !validHash(receipt.transaction_hash) ||
            !sameTime(receipt.block?.block_timestamp, item.at)) continue;
        const matches = candidates.get(receipt.transaction_hash) ?? [];
        if (!matches.includes(item)) matches.push(item);
        candidates.set(receipt.transaction_hash, matches);
      }
    }
    for (const [hash, items] of candidates) {
      const found = await details(hash);
      for (const item of items) {
        if (found.some((receipt) => hasEvent(receipt, item, payer))) {
          transactions.set(item.key, { transaction: hash });
        }
      }
    }
  }));

  const paid = rows.filter((row) => row.payment);
  await Promise.allSettled([...new Set(paid.map((row) => row.payment!.account))].map(async (account) => {
    const items = paid.filter((row) => row.payment!.account === account);
    const transfers = await history(account, "ft-txns", oldest(items));
    for (const item of items) {
      const payment = item.payment!;
      const candidates = transfers.filter((transfer) => {
        if (transfer.affected_account_id !== account || transfer.involved_account_id !== payment.recipient ||
            transfer.contract_account_id !== payment.asset || transfer.delta_amount !== (-payment.amount).toString() ||
            !transfer.block_timestamp || !validHash(transfer.transaction_hash)) return false;
        const at = BigInt(transfer.block_timestamp);
        return at >= item.at && at <= item.at + 120_000_000_000n;
      });
      const exact = new Set<string>();
      const legacy = new Set<string>();
      for (const transfer of candidates) {
        const found = await details(transfer.transaction_hash);
        const receipt = found.find((entry) => entry.receipt_id === transfer.receipt_id);
        for (const log of receipt?.outcome?.logs ?? []) {
          if (!log.startsWith("EVENT_JSON:")) continue;
          try {
            const event = JSON.parse(log.slice("EVENT_JSON:".length));
            if (event.standard !== "nep141" || event.event !== "ft_transfer" || !Array.isArray(event.data)) continue;
            for (const data of event.data) {
              if (data.old_owner_id !== account || data.new_owner_id !== payment.recipient ||
                  data.amount !== payment.amount.toString()) continue;
              if (data.memo === `x402:${item.requestId}`) exact.add(transfer.transaction_hash);
              else if (data.memo == null) legacy.add(transfer.transaction_hash);
            }
          } catch {
            // Ignore unrelated or malformed logs.
          }
        }
      }
      // Older transfers have no request ID. Link only when a single transfer and
      // a single eligible funding row agree on sender, seller, amount and time.
      const overlapping = items.some((other) => other !== item && other.payment!.recipient === payment.recipient &&
        other.payment!.amount === payment.amount && other.payment!.asset === payment.asset &&
        candidates.some((transfer) => legacy.has(transfer.transaction_hash) &&
          BigInt(transfer.block_timestamp!) >= other.at && BigInt(transfer.block_timestamp!) <= other.at + 120_000_000_000n));
      const matches = exact.size ? exact : overlapping ? new Set<string>() : legacy;
      if (matches.size === 1) {
        transactions.set(item.key, { ...transactions.get(item.key), settlement: [...matches][0] });
      }
    }
  }));
  return transactions;
}
