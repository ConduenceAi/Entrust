/**
 * Upgrades the payment policy on an owner's account to the local build through
 * its owner-only `upgrade_code`, then checks that the policy still reads the
 * same rules, connections, and blocklist. Signs with the owner's key from the
 * NEAR CLI keychain.
 *
 *   node scripts/upgrade-policy.ts <owner.testnet> [--rpc <url>]
 *
 * Build first: npm run contracts:build
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NETWORKS, NearRpc, PolicyClient, upgradePolicyCode } from "@nearfirewall/sdk";
import { POLICY_WASM, fail, networkOf, step } from "./lib/owner-setup.ts";

const [owner, ...rest] = process.argv.slice(2);
if (!owner) fail("Usage: node scripts/upgrade-policy.ts <owner account> [--rpc <url>]");
const rpcFlag = rest.indexOf("--rpc");
const rpc = new NearRpc((rpcFlag >= 0 ? rest[rpcFlag + 1] : undefined) ?? NETWORKS[networkOf(owner)]);
const policy = new PolicyClient(rpc, owner);

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

/** Everything the upgrade must leave unchanged. The available balance is left out: the upgrade pays gas and storage for the new code. */
async function snapshot() {
  const { available_balance: _, ...rules } = await policy.getPolicy();
  return JSON.stringify({
    revision: await policy.getRevision(),
    policy: rules,
    connections: await policy.getConnections(),
    blocklist: await policy.getBlocklist(),
    guardians: await policy.getGuardians(),
    pending: await policy.getPending(),
    x402: (await policy.x402Status()).config,
  }, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

const code = new Uint8Array(await readFile(POLICY_WASM));
const target = base58(createHash("sha256").update(code).digest());
const before = await rpc.viewAccount(owner);
console.log(`${owner}: ${before.codeHash} -> ${target}`);
if (before.codeHash === target) {
  console.log("  Already on this build.");
  process.exit(0);
}
if (!(await policy.features()).includes("upgrade_code")) fail(`${owner} predates upgrade_code; upgrade it from the app with a setup key.`);

const was = await snapshot();
await step(rpc.url, owner, "upgrade_code", upgradePolicyCode(owner, code));

const after = await rpc.viewAccount(owner);
if (after.codeHash !== target) fail(`  The code is still ${after.codeHash}; the upgrade was rolled back.`);
if ((await snapshot()) !== was) fail("  The policy reads differently after the upgrade. Compare get_policy and get_connections by hand.");
console.log(`  Upgraded. Rules, connections, blocklist and x402 settings are unchanged. Features: ${(await policy.features()).join(", ")}`);
