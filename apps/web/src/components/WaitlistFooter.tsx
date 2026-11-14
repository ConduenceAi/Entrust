import { useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { parseNear } from "@nearfirewall/sdk";
import { config, explorerAccount, explorerTx, rpc } from "../config.ts";
import { href } from "../router.ts";
import { useWallet } from "../wallet.tsx";
import { Brand } from "./Brand.tsx";

const PAGE_SIZE = 20;
const contract = config.waitlistContractId;

export function WaitlistFooter() {
  const { accountId, connect, connecting, send } = useWallet();
  const dialog = useRef<HTMLDialogElement>(null);
  const signup = useRef<HTMLDialogElement>(null);
  const joining = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<{ account: string; number: number }>();
  const [hash, setHash] = useState("");
  const [notice, setNotice] = useState("");
  const [listError, setListError] = useState("");
  const [page, setPage] = useState({ from: 0, count: 0, accounts: [] as string[] });
  const ownPosition = position?.account === accountId ? position?.number : undefined;

  async function load(from: number) {
    if (!contract) return;
    setLoading(true);
    setListError("");
    try {
      const [count, accounts] = await Promise.all([
        rpc.view(contract, "count"),
        rpc.view(contract, "entries", { from, limit: PAGE_SIZE }),
      ]);
      if (typeof count !== "number" || !Array.isArray(accounts) || !accounts.every((id) => typeof id === "string")) {
        throw new Error("Unexpected waitlist response");
      }
      setPage({ from, count: Math.max(count, from + accounts.length), accounts });
    } catch {
      setListError("Couldn’t read the waitlist. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function openList() {
    dialog.current?.showModal();
    void load(0);
  }

  async function join() {
    if (!contract || joining.current) return;
    joining.current = true;
    setBusy(true);
    setNotice("");
    setHash("");
    try {
      if (!accountId) {
        await connect();
        return;
      }
      const existing = await rpc.view(contract, "position", { account_id: accountId });
      if (typeof existing === "number") {
        setPosition({ account: accountId, number: existing });
        return;
      }
      if (existing !== null) throw new Error("Unexpected waitlist response");
      const result = await send({
        receiverId: contract,
        actions: [{
          type: "FunctionCall",
          params: { methodName: "join", args: {}, gas: "30000000000000", deposit: parseNear("0.01").toString() },
        }],
      });
      if (result.failure) throw new Error("Join transaction failed");
      setHash(result.txHash ?? "");
      const confirmed = typeof result.value === "number" ? result.value
        : await rpc.view(contract, "position", { account_id: accountId });
      if (typeof confirmed === "number") setPosition({ account: accountId, number: confirmed });
      else setNotice("Your place is awaiting confirmation. Check the waitlist or try again.");
    } catch {
      setNotice("Couldn’t confirm your place. Try again or check the waitlist.");
    } finally {
      joining.current = false;
      setBusy(false);
    }
  }

  return (
    <footer className="landing-footer" id="waitlist">
      <div className="waitlist-callout">
        <h2>Get early access.</h2>
        <div className="waitlist-actions">
          <button type="button" className="primary" aria-haspopup="dialog" onClick={() => signup.current?.showModal()}>
            Join waitlist <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="waitlist-footer-bar">
        <Brand />
        <div><span>© 2026 NEARFirewall</span><a href={href("/docs")}>Docs</a><button type="button" className="text-link footer-waitlist-link" aria-haspopup="dialog" onClick={openList}>View waitlist</button></div>
      </div>
      <dialog ref={signup} className="waitlist-dialog waitlist-drawer" aria-labelledby="waitlist-join-title">
        <header>
          <h2 id="waitlist-join-title">Join the waitlist</h2>
          <form method="dialog"><button type="submit">Close</button></form>
        </header>
        <p>Your wallet ID and place in line are public on {config.network}. Joining costs 0.01 NEAR for storage, plus gas.</p>
        {!contract && <p>Waitlist opens once the contract is deployed.</p>}
        {accountId && contract && <p><code>{accountId}</code></p>}
        <div className="waitlist-signup-actions">
          <button type="button" className="primary" disabled={!contract || busy || connecting || ownPosition !== undefined} onClick={join}>
            {ownPosition !== undefined ? "Joined · #" + ownPosition : busy || connecting ? "Please wait…" : accountId ? "Sign to join" : "Connect wallet"} <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
        <p role="status">{notice}</p>
        {hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} aria-hidden="true" /></a>}
      </dialog>
      <dialog ref={dialog} className="waitlist-dialog" aria-labelledby="waitlist-title">
        <header>
          <h2 id="waitlist-title">Public waitlist</h2>
          <form method="dialog"><button type="submit">Close</button></form>
        </header>
        {!contract ? <p>Waitlist opens once the contract is deployed.</p> : <>
          {loading ? <p role="status">Reading the waitlist…</p> : listError ? (
            <p role="alert">{listError} <button type="button" onClick={() => load(page.from)}>Retry</button></p>
          ) : <>
            <p>{page.count} {page.count === 1 ? "wallet" : "wallets"} joined on {config.network}.</p>
            {page.accounts.length === 0 ? <p>No entries yet.</p> : <ol start={page.from + 1}>
              {page.accounts.map((account) => <li key={account}><a href={explorerAccount(account)} target="_blank" rel="noreferrer"><code>{account}</code></a></li>)}
            </ol>}
            <div className="waitlist-pagination">
              {page.from > 0 && <button type="button" onClick={() => load(page.from - PAGE_SIZE)}>Previous</button>}
              {page.from + PAGE_SIZE < page.count && <button type="button" onClick={() => load(page.from + PAGE_SIZE)}>Next</button>}
            </div>
          </>}
          <a href={explorerAccount(contract)} target="_blank" rel="noreferrer">View contract on NearBlocks</a>
        </>}
      </dialog>
    </footer>
  );
}
