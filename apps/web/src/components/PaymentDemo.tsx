import { useState, type FormEvent } from "react";
import { ArrowRight, Code2, KeyRound, RotateCcw, ShieldAlert, Users } from "lucide-react";
import { href } from "../router.ts";
import { defaultPlatform, featuredPlatforms, localMcpConfig } from "../platforms.ts";

const DAY = 86_400_000;
const START = Date.UTC(2026, 5, 1);
const dateLabel = new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const ROLES = {
  Contractor: { amount: 40, cadence: "weekly" },
  Engineer: { amount: 180, cadence: "monthly" },
} as const;
const SAMPLE_HIRE = { name: "Jordan Lee", wallet: "jordan-lee.near", wrongWallet: "jordan-lee-pay.near" };
const ACCOUNT_ID = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

type Department = "engineering" | "hr";
type Cadence = "weekly" | "monthly";
type Role = keyof typeof ROLES;
type Payee = {
  id: number;
  department: Department;
  name: string;
  amount: number;
  cadence: Cadence;
  nextDue: number;
  status: "approved" | "pending" | "declined";
  role?: Role;
  wallet?: string;
};
type Payment = { payee: Payee; due: number };

const INITIAL_PAYEES: Payee[] = [
  { id: 1, department: "engineering", name: "Newsliquid", amount: 8, cadence: "monthly", nextDue: START, status: "approved" },
  { id: 2, department: "engineering", name: "Predixon", amount: 12, cadence: "monthly", nextDue: START, status: "approved" },
  { id: 3, department: "hr", name: "Maya Rao", wallet: "maya-rao.near", role: "Contractor", ...ROLES.Contractor, nextDue: START, status: "approved" },
  { id: 4, department: "hr", name: "Alex Chen", wallet: "alex-chen.near", role: "Engineer", ...ROLES.Engineer, nextDue: START, status: "approved" },
];

function walletConflict(payee: Payee, payees: Payee[]) {
  if (!payee.wallet) return "";
  const expected = payee.name.toLowerCase() === SAMPLE_HIRE.name.toLowerCase() ? SAMPLE_HIRE.wallet : undefined;
  if (expected && payee.wallet !== expected) return "Jordan’s sample onboarding record lists " + expected + ".";
  const existing = payees.find((item) => item.id !== payee.id && item.status === "approved" && item.wallet === payee.wallet);
  if (existing) return "This address is already assigned to " + existing.name + ".";
  return "";
}

function nextOccurrence(date: number, cadence: Cadence) {
  if (cadence === "weekly") return date + 7 * DAY;
  const current = new Date(date);
  return Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1);
}

export function PaymentDemo() {
  const [department, setDepartment] = useState<Department>("engineering");
  const [date, setDate] = useState(START);
  const [payees, setPayees] = useState(INITIAL_PAYEES);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("");
  const [walletError, setWalletError] = useState("");
  const [role, setRole] = useState<Role>("Contractor");
  const [message, setMessage] = useState("");
  const [client, setClient] = useState(defaultPlatform);
  const [connection, setConnection] = useState<"setup" | "authorize" | "connected">("setup");
  const isHR = department === "hr";
  const agent = department + ".company.near";
  const visible = payees.filter((payee) => payee.department === department);
  const due = visible.some((payee) => payee.status === "approved" && payee.nextDue <= date);
  const activity = payments.filter((payment) => payment.payee.department === department);

  function requestApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipient = name.trim();
    if (!recipient) return;
    const address = wallet.trim();
    if (isHR && !ACCOUNT_ID.test(address)) {
      setWalletError("Enter a valid NEAR account ID, such as jordan-lee.near.");
      return;
    }
    if (visible.some((payee) => payee.status !== "declined" && payee.name.toLowerCase() === recipient.toLowerCase())) {
      setMessage(recipient + " already has a rule or a pending request.");
      return;
    }
    const rule = isHR ? ROLES[role] : { amount: 10, cadence: "monthly" as const };
    setPayees([...payees, {
      id: Math.max(...payees.map((payee) => payee.id)) + 1, department, name: recipient, ...rule, role: isHR ? role : undefined, wallet: isHR ? address : undefined,
      nextDue: date, status: "pending",
    }]);
    setName("");
    setWallet("");
    setWalletError("");
    setMessage("Owner approval requested for " + recipient + ".");
  }

  function review(payee: Payee, approve: boolean) {
    if (approve && walletConflict(payee, payees)) return;
    const cadence = payee.cadence;
    const today = new Date(date);
    const nextDue = cadence === "weekly" ? date + 7 * DAY : Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    setPayees(payees.map((item) => item.id === payee.id ? { ...item, nextDue, status: approve ? "approved" : "declined" } : item));
    setMessage(approve ? payee.name + " approved. First payment is due " + dateLabel.format(nextDue) + "." : "The owner declined " + payee.name + ".");
  }

  function runPayments() {
    const settled: Payment[] = [];
    const updated = payees.map((payee) => {
      if (payee.department !== department || payee.status !== "approved" || payee.nextDue > date) return payee;
      let nextDue = payee.nextDue;
      while (nextDue <= date) {
        settled.push({ payee, due: nextDue });
        nextDue = nextOccurrence(nextDue, payee.cadence);
      }
      return { ...payee, nextDue };
    });
    if (settled.length === 0) return;
    setPayees(updated);
    setPayments([...payments, ...settled.sort((a, b) => a.due - b.due)]);
    setMessage(settled.length + (settled.length === 1 ? " payment settled" : " payments settled") + " under approved rules.");
  }

  function selectDepartment(next: Department) {
    setDepartment(next);
    setName("");
    setWallet("");
    setWalletError("");
    setMessage("");
  }

  function loadSample(address: string) {
    setName(SAMPLE_HIRE.name);
    setWallet(address);
    setRole("Contractor");
    setWalletError("");
    setMessage("");
  }

  function reset() {
    selectDepartment("engineering");
    setDate(START);
    setPayees(INITIAL_PAYEES);
    setPayments([]);
    setRole("Contractor");
    setConnection("setup");
    setClient(defaultPlatform);
  }

  return (
    <section className="landing-section walkthrough company-demo" id="payment-walkthrough" aria-labelledby="walkthrough-title">
      <div className="walkthrough-copy">
        <span className="demo-kicker">Try it here</span>
        <div aria-live="polite">
          <div className="demo-scenario-copy" key={department}>
            <h2 id="walkthrough-title">{isHR ? "Run payroll with HR" : "Renew subscriptions with Engineering"}</h2>
            <p className="lead">{isHR ? "Pay on schedule and send new employee wallets to the owner for review." : "Let your agent renew approved tools within the company’s spending rules."}</p>
          </div>
        </div>
        <div className="demo-clients" role="group" aria-label="Choose an MCP client">
          {featuredPlatforms.map((platform) => (
            <button key={platform.id} type="button" aria-pressed={client.id === platform.id} onClick={() => {
              if (client.id !== platform.id) { setClient(platform); setConnection("setup"); }
            }}>
              {platform.icon && <img className="integration-icon" data-client={platform.id} src={"/integrations/" + platform.icon} alt="" width={21} height={21} />}
              {platform.name}
            </button>
          ))}
        </div>
        <div className="payment-scenarios" role="group" aria-label="Department">
          <button type="button" aria-pressed={!isHR} onClick={() => { if (isHR) { selectDepartment("engineering"); setConnection("setup"); } }}>
            <span className="scenario-icon" data-tone="engineering"><Code2 size={18} aria-hidden="true" /></span>
            <span><strong>Engineering</strong><small>Renew subscriptions and request a new vendor.</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-pressed={isHR} onClick={() => { if (!isHR) { selectDepartment("hr"); setConnection("setup"); } }}>
            <span className="scenario-icon" data-tone="hr"><Users size={18} aria-hidden="true" /></span>
            <span><strong>HR</strong><small>Run payroll and request approval for a new hire.</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <a className="text-link demo-setup-link" href={href("/docs/connect-agent")}>Connect a real agent <ArrowRight size={15} aria-hidden="true" /></a>
      </div>

      <div className="walkthrough-panel demo-scenario-panel" key={department + ":" + client.id}>
        <header className="demo-panel-header">
          <span className="demo-agent-icon"><KeyRound size={19} aria-hidden="true" /></span>
          <div><h3>{client.name} · {isHR ? "Payroll" : "Subscriptions"}</h3><p><code>{agent}</code></p></div>
          <span className="demo-mode">Simulation</span>
          <button className="icon-btn" type="button" aria-label="Restart demo" title="Restart demo" onClick={reset}><RotateCcw size={16} aria-hidden="true" /></button>
        </header>

        {connection !== "connected" ? (
          <div className="demo-connect demo-client-setup">
            {connection === "setup" ? <>
              <h4>Connect {agent}</h4>
              <p>Give {client.name} a restricted key to request payments under the {isHR ? "payroll" : "subscription"} rules.</p>
              <button type="button" className="primary" onClick={() => setConnection("authorize")}>Connect demo agent <ArrowRight size={16} aria-hidden="true" /></button>
            </> : <>
              <h4>Authorize the demo key</h4>
              <p>{client.setup}</p>
              <details><summary>Preview MCP configuration</summary><pre>{localMcpConfig(client, {
                NEARFIREWALL_ACCOUNT: "company.near",
                NEARFIREWALL_NETWORK: "testnet",
                NEARFIREWALL_AGENT_KEY: "<restricted-key>",
              })}</pre></details>
              <button type="button" className="primary" onClick={() => setConnection("connected")}>Authorize and open {client.name}</button>
            </>}
          </div>
        ) : <>
        <div className="demo-agent-chat">
          <div className="demo-bubble">{isHR ? "Run payroll for everyone who’s due." : "Renew our approved subscriptions."}</div>
          <div className="demo-reply" aria-live="polite">
            <strong>{client.name}</strong>
            <p>{message || (due
              ? "I found approved payments due. I’ll use the saved rules for each recipient."
              : "There are no approved payments due on this date.")}</p>
          </div>
        </div>
        <div className="demo-wallet-strip">
          <strong>{dateLabel.format(date)}</strong>
          <button type="button" onClick={() => { setDate(date + 7 * DAY); setMessage(""); }}>Advance one week</button>
        </div>

        <div className="company-demo-body">
          <ul className="company-payee-list" aria-label={isHR ? "Payroll rules" : "Subscription rules"}>
            {visible.map((payee) => {
              const conflict = payee.status === "pending" ? walletConflict(payee, payees) : "";
              return (
              <li key={payee.id}>
                <div><strong>{payee.name}</strong><small>{payee.role ? payee.role + " · " : ""}{payee.amount} NEAR {payee.cadence}</small>{payee.wallet && <code>{payee.wallet}</code>}</div>
                <div className="payee-state" data-state={payee.status}>
                  {payee.status === "approved" ? (payee.nextDue <= date ? "Due now" : "Next " + dateLabel.format(payee.nextDue))
                    : payee.status === "pending" ? "Needs owner approval" : "Declined"}
                </div>
                {payee.status === "pending" && (
                  <div className="company-review" role="group" aria-label={"Owner review for " + payee.name}>
                    <strong>Owner review</strong>
                    {conflict ? <p className="company-wallet-warning"><ShieldAlert size={17} aria-hidden="true" /> {conflict} Payroll skips this request.</p>
                      : payee.wallet && <p>Confirm this address against the employee’s onboarding record.</p>}
                    <div className="demo-approval">
                      {conflict && payee.wallet && <button type="button" onClick={() => {
                        setPayees(payees.filter((item) => item.id !== payee.id));
                        setName(payee.name);
                        setWallet(payee.wallet ?? "");
                        if (payee.role) setRole(payee.role);
                        setWalletError("");
                        setMessage("Update the wallet address and request approval again.");
                      }}>Return to HR to edit</button>}
                      <button type="button" onClick={() => review(payee, false)}>Decline</button>
                      <button type="button" className="primary" disabled={Boolean(conflict)} onClick={() => review(payee, true)}>Approve rule</button>
                    </div>
                  </div>
                )}
              </li>
            ); })}
          </ul>
          <button type="button" className="primary" disabled={!due} onClick={runPayments}>{isHR ? "Run due payroll" : "Pay due subscriptions"}</button>

          <form className="company-demo-form" onSubmit={requestApproval}>
            <h4>{isHR ? "Add a new employee" : "Add a subscription vendor"}</h4>
            {isHR && <div className="company-demo-samples" role="group" aria-label="Load a sample hire">
              <button type="button" onClick={() => loadSample(SAMPLE_HIRE.wallet)}>Use sample hire</button>
              <button type="button" onClick={() => loadSample(SAMPLE_HIRE.wrongWallet)}>Try a wrong wallet</button>
            </div>}
            <label>{isHR ? "Employee name" : "Vendor name"}<input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
            {isHR && <label>NEAR wallet address<input required maxLength={64} value={wallet} placeholder="employee.near" autoComplete="off" autoCapitalize="none" spellCheck={false}
              aria-invalid={Boolean(walletError)} aria-describedby={walletError ? "demo-wallet-error" : undefined}
              onChange={(event) => { setWallet(event.target.value); setWalletError(""); }} /></label>}
            {walletError && <p className="company-wallet-warning" id="demo-wallet-error" role="alert">{walletError}</p>}
            {isHR ? <label>Role and pay schedule<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              {Object.entries(ROLES).map(([key, rule]) => <option key={key} value={key}>{key} · {rule.amount} NEAR {rule.cadence}</option>)}
            </select></label> : <small>Sample subscription rule · 10 NEAR monthly</small>}
            <button type="submit">Request owner approval</button>
          </form>

          <div className="company-demo-log">
            <h4>Payment activity</h4>
            {activity.length === 0 ? <p>Run a due payment to see its record here.</p> : <ol aria-label="Simulated payment records">
              {activity.toReversed().map(({ payee, due: paymentDate }) => (
                <li key={payee.id + "-" + paymentDate}><span>{agent} → <strong>{payee.name}</strong></span>{payee.wallet && <small><code>{payee.wallet}</code></small>}<small>{payee.amount} NEAR · Due {dateLabel.format(paymentDate)} · Settled</small></li>
              ))}
            </ol>}
          </div>
        </div>
        </>}
        <footer className="demo-footer">Sample schedules and amounts · No wallet or real funds required</footer>
      </div>
    </section>
  );
}
