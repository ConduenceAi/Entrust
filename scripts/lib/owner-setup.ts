/**
 * Owner-side setup steps shared by the demo scripts. Each step is skipped when
 * it is already done, so scripts can be run again. Signing uses the NEAR CLI
 * keychain (see ./sign.ts); keys are never printed.
 */
import { readFile } from "node:fs/promises";
import {
  PolicyClient,
  RegistryClient,
  checkRegistry,
  createRegistry,
  enablePayments,
  parseNear,
  registryAccountFor,
  type NearRpc,
  type WalletTransaction,
} from "@nearfirewall/sdk";
import { ownerAccount, send } from "./sign.ts";

export const REGISTRY_WASM = "target/near/nearfirewall_registry/nearfirewall_registry.wasm";
export const POLICY_WASM = "target/near/nearfirewall_account_policy/nearfirewall_account_policy.wasm";

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function networkOf(account: string) {
  return account.endsWith(".near") ? "mainnet" : "testnet";
}

/** Signs and sends one transaction as `signer`, printing its hash. Stops the script on failure. */
export async function step(rpcUrl: string, signer: string, label: string, tx: WalletTransaction) {
  const result = await send(await ownerAccount(signer, rpcUrl, networkOf(signer)), tx);
  if (result.failure) fail(`${label}: failed ${JSON.stringify(result.failure)}`);
  console.log(`  ${label}: ok  tx ${result.hash}`);
  return result;
}

/** The owner's registry on agents.<owner>, created from the local build if missing. */
export async function ensureRegistry(rpc: NearRpc, owner: string): Promise<RegistryClient> {
  const registryId = registryAccountFor(owner);
  const state = await checkRegistry(rpc, registryId, owner);
  if (state.kind === "untrusted") fail(state.reason);
  if (state.kind === "missing") {
    const code = new Uint8Array(await readFile(REGISTRY_WASM));
    await step(rpc.url, owner, `create ${registryId}`, createRegistry(owner, registryId, { code }));
  } else {
    console.log(`  ${registryId}: ready`);
  }
  return new RegistryClient(rpc, registryId);
}

/** The payment policy on the owner's own account, installed from the local build if missing. */
export async function ensurePolicy(rpc: NearRpc, owner: string, registryId: string): Promise<PolicyClient> {
  const policy = new PolicyClient(rpc, owner);
  const state = await policy.state();
  if (state.kind === "other") fail(`${owner} runs another contract (${state.codeHash}).`);
  if (state.kind === "none") {
    const code = new Uint8Array(await readFile(POLICY_WASM));
    await step(rpc.url, owner, `enable payments on ${owner}`, enablePayments(owner, registryId, { code }));
  } else {
    const view = await policy.getPolicy();
    if (view.registry !== registryId) fail(`${owner}'s policy trusts ${view.registry}, not ${registryId}.`);
    console.log(`  ${owner}: payments enabled`);
  }
  return policy;
}

/** Creates `<label>.<parent>` with a little NEAR, unless it exists. */
export async function ensureSubAccount(rpc: NearRpc, parent: string, label: string, deposit = parseNear("0.02")): Promise<string> {
  const account = `${label}.${parent}`;
  if (!(await rpc.accountExists(account))) {
    await step(rpc.url, parent, `create ${account}`, {
      receiverId: account,
      actions: [{ type: "CreateAccount" }, { type: "Transfer", params: { deposit: deposit.toString() } }],
    });
  }
  return account;
}
