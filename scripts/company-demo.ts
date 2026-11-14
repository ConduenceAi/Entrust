#!/usr/bin/env node
/**
 * Prepares the company demo on Testnet, so the live demo only talks to the
 * agent. One company wallet (--owner) with three department agents, named
 * under its registry:
 *
 *   engineering.agents.<owner>   renews Newsliquid and Predexon
 *   trading.agents.<owner>       renews Newsliquid and Predexon (its market tools)
 *   hr.agents.<owner>            pays Maya Rao (weekly) and Alex Chen (monthly)
 *
 * Subscription renewals are paid to --vendor (default coldarena9661.testnet),
 * and each subscription is recorded on the agent's token with its price and
 * renewal schedule, so the agent can say exactly when each one renews: by
 * default Newsliquid tomorrow and Predexon a week after that. Employees and
 * the unapproved payees are sub-accounts of --payees: quickdata (a new tool
 * no one approved yet) and jordan-lee (a new hire), for the live "owner
 * approves once" moment.
 *
 *   node scripts/company-demo.ts setup     --owner <company>.testnet --payees <account>.testnet [--vendor <account>]
 *   node scripts/company-demo.ts renewals  --owner <company>.testnet [--first 1] [--second 8] [--vendor <account>]
 *   node scripts/company-demo.ts connect   --owner <company>.testnet [--agent trading] [--platform claude-desktop|claude-code]
 *   node scripts/company-demo.ts status    --owner <company>.testnet
 *
 * `setup` is safe to run again. Run `renewals` on the morning of the demo so
 * "tomorrow" is right. `connect` adds a key and writes a ready Claude Desktop
 * configuration and Claude Code command next to the owner's keychain entry; it
 * never prints the key. Keys come from the NEAR CLI keychain (~/.near-credentials).
 * Build the contracts first: npm run contracts:build
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { KeyPair } from "near-api-js";
import {
  LOCKS,
  NearRpc,
  RegistryClient,
  PolicyClient,
  anchorFor,
  connectAgentKey,
  describeReason,
  describeSubscription,
  formatNear,
  formatUsdc,
  isX402,
  parseNear,
  parseSubscriptions,
  registerAgent,
  registryAccountFor,
  setMandate,
  setRecord,
  subscriptionRecord,
  transferCapability,
} from "@nearfirewall/sdk";
import { ensurePolicy, ensureRegistry, ensureSubAccount, fail, networkOf, step } from "./lib/owner-setup.ts";

const DEFAULT_VENDOR = "coldarena9661.testnet";

/** The tools engineering and trading subscribe to. Prices are NEAR per month on Testnet. */
const SUBSCRIPTIONS = [
  { id: "newsliquid", name: "Newsliquid", url: "https://app.newsliquid.com/", price: "0.5", renewsIn: "first" },
  { id: "predexon", name: "Predexon", url: "https://dashboard.predexon.com/", price: "0.8", renewsIn: "second" },
] as const;

/** Employees HR pays (sub-accounts of --payees), amounts in NEAR. */
const EMPLOYEES = [
  { label: "maya-rao", note: "Maya Rao, contractor, weekly", perPayment: "0.4", daily: "0.4" },
  { label: "alex-chen", note: "Alex Chen, engineer, monthly", perPayment: "1.5", daily: "1.5" },
];

/** Exist but are not approved: the owner approves them live. */
const NOT_APPROVED = [
  { label: "quickdata", note: "a new tool no one approved yet" },
  { label: "jordan-lee", note: "a new hire HR wants to pay" },
];

const DEPARTMENTS = {
  engineering: { description: "Engineering: renews the tools the owner approved", maxPerPayment: "1", dailyBudget: "2", subscriptions: true },
  trading: { description: "Trading: renews its market data and news tools", maxPerPayment: "1", dailyBudget: "2", subscriptions: true },
  hr: { description: "HR: runs payroll for the employees the owner approved", maxPerPayment: "2", dailyBudget: "3", subscriptions: false },
} as const;
type Department = keyof typeof DEPARTMENTS;

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1]! : fallback;
};
const owner = flag("owner") ?? fail("Give --owner <company account>.");
const vendor = flag("vendor", DEFAULT_VENDOR)!;
const network = networkOf(owner);
const rpc = new NearRpc(process.env.NEAR_RPC_URL ?? (network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com"));
const registryId = registryAccountFor(owner);
const keyDir = join(homedir(), ".near-credentials", network, owner);
const fullName = (handle: string) => `${handle}.${registryId}`;

/** Writes each subscription record so it renews `first` and `second` days from today. */
async function writeRenewals(registry: RegistryClient, agentId: string, handle: string) {
  const days = { first: Number(flag("first", "1")), second: Number(flag("second", "8")) };
  for (const s of SUBSCRIPTIONS) {
    const record = subscriptionRecord(s.id, {
      name: s.name,
      url: s.url,
      price_near: s.price,
      period: "monthly",
      anchor: anchorFor(days[s.renewsIn], "monthly"),
      pay_to: vendor,
    });
    await step(rpc.url, owner, `${s.name} on ${handle}: renews in ${days[s.renewsIn]} day(s)`, setRecord(registry.registryId, agentId, record.key, record.value));
  }
}

async function setup() {
  const payees = flag("payees") ?? fail("Give --payees <account> to hold the employee and unapproved accounts.");
  if (!(await rpc.accountExists(vendor))) fail(`${vendor} does not exist; subscription renewals would fail.`);
  console.log(`Payees under ${payees}`);
  const accounts = new Map<string, string>();
  for (const label of [...EMPLOYEES.map((e) => e.label), ...NOT_APPROVED.map((p) => p.label)]) {
    accounts.set(label, await ensureSubAccount(rpc, payees, label));
  }

  console.log(`Company ${owner}`);
  const registry = await ensureRegistry(rpc, owner);
  await ensurePolicy(rpc, owner, registry.registryId);

  // One rule for the vendor account covers both tools: the dearer renewal per payment, both on the same day at most.
  const prices = SUBSCRIPTIONS.map((s) => parseNear(s.price));
  const vendorRule = { recipient: vendor, perPaymentCap: prices.reduce((a, b) => (b > a ? b : a)), dailyCap: prices.reduce((a, b) => a + b) };

  for (const [handle, dept] of Object.entries(DEPARTMENTS) as [Department, (typeof DEPARTMENTS)[Department]][]) {
    let agent = await registry.resolve(handle);
    if (!agent) {
      await step(rpc.url, owner, `register ${fullName(handle)}`, registerAgent(registry.registryId, handle, {
        executor: null,
        capabilities: transferCapability(parseNear(dept.maxPerPayment)),
        locks: LOCKS.NO_TRANSFER,
        description: dept.description,
      }));
      agent = (await registry.resolve(handle)) ?? fail(`${handle} was not registered.`);
    }
    const recipients = dept.subscriptions
      ? [vendorRule]
      : EMPLOYEES.map((e) => ({ recipient: accounts.get(e.label)!, perPaymentCap: parseNear(e.perPayment), dailyCap: parseNear(e.daily) }));
    await step(rpc.url, owner, `rules for ${fullName(handle)}`, setMandate(owner, {
      agentId: agent.agent_id,
      path: await registry.getPath(agent.agent_id),
      dailyCap: parseNear(dept.dailyBudget),
      recipients,
    }));
    if (dept.subscriptions) await writeRenewals(registry, agent.agent_id, handle);
  }

  console.log(`
Ready. ${owner} has three department agents:
  ${fullName("engineering")} and ${fullName("trading")}: up to 1 NEAR per payment, 2 NEAR a day
    subscriptions paid to ${vendor} (up to ${formatNear(vendorRule.perPaymentCap)} NEAR each, ${formatNear(vendorRule.dailyCap)} a day):
${SUBSCRIPTIONS.map((s) => `      ${s.name} (${s.url}): ${s.price} NEAR monthly`).join("\n")}
  ${fullName("hr")}: up to 2 NEAR per payment, 3 NEAR a day
${EMPLOYEES.map((e) => `    ${accounts.get(e.label)} (${e.note}): ${e.perPayment} NEAR each`).join("\n")}
Not approved yet, for the live demo:
${NOT_APPROVED.map((p) => `  ${accounts.get(p.label)} (${p.note})`).join("\n")}

Next: node scripts/company-demo.ts connect --owner ${owner} --agent trading
On the demo morning: node scripts/company-demo.ts renewals --owner ${owner}`);
}

async function renewals() {
  const registry = new RegistryClient(rpc, registryId);
  for (const [handle, dept] of Object.entries(DEPARTMENTS)) {
    if (!dept.subscriptions) continue;
    const agent = (await registry.resolve(handle)) ?? fail(`No agent ${handle}. Run setup first.`);
    await writeRenewals(registry, agent.agent_id, handle);
  }
}

async function connect() {
  const handle = flag("agent", "trading")!;
  const platform = flag("platform", "claude-desktop")!;
  if (platform !== "claude-desktop" && platform !== "claude-code") fail("--platform is claude-desktop or claude-code.");
  const registry = new RegistryClient(rpc, registryId);
  const agent = (await registry.resolve(handle)) ?? fail(`No agent ${handle}. Run setup first.`);
  const pair = KeyPair.fromRandom("ed25519");
  const publicKey = pair.getPublicKey().toString();
  await step(rpc.url, owner, `connect a key to ${fullName(handle)}`, connectAgentKey(owner, {
    agentId: agent.agent_id,
    publicKey,
    platform,
    label: flag("label", platform === "claude-desktop" ? "Claude Desktop" : "Claude Code")!,
    allowance: parseNear("0.5"),
  }));
  await mkdir(keyDir, { recursive: true });
  const keyFile = join(keyDir, `connection-${handle}.json`);
  await writeFile(keyFile, JSON.stringify({ account_id: owner, public_key: publicKey, private_key: pair.toString() }, null, 2), { mode: 0o600 });
  const server = resolve("packages/mcp/src/main.ts").replaceAll("\\", "/");
  const env = { NEARFIREWALL_ACCOUNT: owner, NEARFIREWALL_NETWORK: network, NEARFIREWALL_AGENT_KEY: pair.toString() };
  const desktopFile = join(keyDir, `claude-desktop-${handle}.json`);
  // Claude Desktop does not always see the shell's PATH, so name this Node.js by its full path.
  const node = process.execPath.replaceAll("\\", "/");
  await writeFile(desktopFile, JSON.stringify({ mcpServers: { nearfirewall: { command: node, args: [server], env } } }, null, 2) + "\n", { mode: 0o600 });
  const codeFile = join(keyDir, `claude-code-${handle}.txt`);
  await writeFile(
    codeFile,
    `claude mcp add nearfirewall --scope user ${Object.entries(env).map(([k, v]) => `-e ${k}=${v}`).join(" ")} -- node "${server}"\n`,
    { mode: 0o600 },
  );
  console.log(`  key saved to ${keyFile}
  Claude Desktop: merge ${desktopFile} into Settings > Developer > Edit Config (claude_desktop_config.json), then fully quit and reopen Claude.
  Claude Code: run the command in ${codeFile} once.
  Both files hold the key: keep them private and delete them once used.`);
}

async function status() {
  const registry = new RegistryClient(rpc, registryId);
  const policy = new PolicyClient(rpc, owner);
  const view = await policy.getPolicy();
  console.log(`${owner}: payments ${view.paused ? "PAUSED" : "on"}, ${formatNear(view.available_balance)} NEAR available, ${view.connections ?? 0} connection(s)`);
  for (const handle of Object.keys(DEPARTMENTS)) {
    const agent = await registry.resolve(handle);
    const mandate = agent && (await policy.getMandate(agent.agent_id));
    if (!agent || !mandate) {
      console.log(`  ${fullName(handle)}: not set up`);
      continue;
    }
    const usage = await policy.getUsage(agent.agent_id);
    console.log(`  ${fullName(handle)}: ${formatNear(usage.mandate_used_today)} of ${formatNear(mandate.daily_cap)} NEAR used today; approved: ${Object.keys(mandate.recipients).join(", ")}`);
    for (const s of parseSubscriptions(await registry.getRecords(agent.agent_id))) console.log(`    ${describeSubscription(s)}`);
  }
  for (const c of await policy.getConnections()) console.log(`  key "${c.label}" → agent #${c.agent_id}, used ${c.uses}×`);
  for (const a of await policy.getActivity(8)) {
    const amount = isX402(a.via) ? `${formatUsdc(a.amount)} USDC` : `${formatNear(a.amount)} NEAR`;
    console.log(`  #${a.leaf}: ${amount} → ${a.recipient}: ${a.outcome}${a.reason ? ` ${a.reason} (${describeReason(a.reason)})` : ""}`);
  }
}

switch (command) {
  case "setup":
    await setup();
    break;
  case "renewals":
    await renewals();
    break;
  case "connect":
    await connect();
    break;
  case "status":
    await status();
    break;
  default:
    fail("Usage: node scripts/company-demo.ts setup|renewals|connect|status --owner <account> [--payees <account>]");
}
