import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"ZeroAddress"},
  4: {message:"EmptyQuestion"},
  5: {message:"BadDeadline"},
  6: {message:"FeeCapExceeded"},
  7: {message:"MarketNotFound"},
  8: {message:"MarketClosed"},
  9: {message:"BadSide"},
  10: {message:"ZeroAmount"},
  11: {message:"SideFull"},
  12: {message:"Locked"},
  13: {message:"BadAmount"},
  14: {message:"NotOracle"},
  15: {message:"NotResolvable"},
  16: {message:"BadResult"},
  17: {message:"EmptyWinner"},
  18: {message:"NotClaimable"},
  19: {message:"NotWinner"},
  20: {message:"AlreadyClaimed"},
  21: {message:"NotFeeRecipient"},
  22: {message:"NoFees"},
  23: {message:"UnsupportedToken"},
  24: {message:"Overflow"},
  25: {message:"UnsupportedDecimals"},
  26: {message:"ConservationViolation"},
  /**
   * The market question exceeded `MAX_QUESTION_BYTES`. Refused rather than
   * truncated.
   */
  27: {message:"QuestionTooLong"},
  /**
   * All [`MAX_SQUAD_MEMBERS`] slots across both sides have been filled.
   * Distinct from [`Error::SideFull`], which fires when a single side reaches
   * [`MAX_PARTICIPANTS_PER_SIDE`].  A new depositor is rejected once
   * `participants_a + participants_b == MAX_SQUAD_MEMBERS` even if the target
   * side still has room.
   */
  28: {message:"SquadFull"},
  /**
   * A payout could not be delivered because the token transfer trapped
   * (frozen or deauthorized trustline). The amount is parked, not lost:
   * `claim` succeeds and holds it, `claim_parked_payout` retries it.
   */
  29: {message:"PayoutParked"},
  /**
   * `cancel_market` was called on a market that is already resolved or
   * cancelled.
   */
  30: {message:"AlreadyResolved"},
  /**
   * `cancel_oracle` / `execute_oracle` found no queued oracle rotation.
   */
  31: {message:"NothingQueued"},
  /**
   * `execute_oracle` was called before the rotation's timelock elapsed.
   */
  32: {message:"Timelocked"},
  /**
   * `get_markets_batch` was called with more than `MAX_BATCH_SIZE` ids. Refused before reading storage.
   */
  33: {message:"BatchTooLarge"},
  /**
   * `cancel_fee_recipient` / `execute_fee_recipient` found no queued
   * fee-recipient rotation.
   */
  34: {message:"NoFeeRecipientQueued"},
  /**
   * The settlement manifest version is not supported by this contract.
   */
  35: {message:"UnsupportedManifestVersion"},
  /**
   * The settlement manifest digest does not match the bound market state.
   */
  36: {message:"ManifestDigestMismatch"},
  /**
   * `get_entitlements_page` was called with a `limit` above
   * [`MAX_ENTITLEMENT_PAGE`]. Refused before reading any entitlement.
   */
  37: {message:"PageTooLarge"},
  /**
   * The pool is paused: new deposits and market creation are refused while
   * withdrawals, claims and parked-payout retries stay available.
   */
  38: {message:"Paused"}
}


export interface Market {
  captain: string;
  deadline: u64;
  fee_bps: u32;
  participants_a: u32;
  participants_b: u32;
  pool_a: i128;
  pool_b: i128;
  remaining_escrow: i128;
  resolved: boolean;
  /**
 * `0` until resolved, then SIDE_A / SIDE_B / RESULT_CANCELLED.
 */
result: u32;
  winner_claims: u32;
}


export interface ClaimResult {
  fee: i128;
  gross: i128;
  net: i128;
}

/**
 * Explicit claim state for a wallet's position in a squad market.
 * 
 * Distinguishes the states that were previously collapsed into a zero amount:
 * a wallet with no position, a wallet whose share is claimable right now, and
 * a wallet whose payout has already been claimed.
 */
export type ClaimStatus = {tag: "NoPosition", values: void} | {tag: "Claimable", values: readonly [i128]} | {tag: "AlreadyClaimed", values: void};


/**
 * The policy limits `create_market` enforces, so clients can read them
 * instead of probing live calls for failures.
 */
export interface SquadLimits {
  max_duration: u64;
  max_fee_bps: u32;
  max_question_bytes: u32;
  min_duration: u64;
}


/**
 * Refundable liabilities a cancellation of `market_id` would create.
 */
export interface CancelPreview {
  refund_a: i128;
  refund_b: i128;
}


/**
 * A queued oracle rotation, executable once `executable_at` has passed.
 */
export interface PendingOracle {
  executable_at: u64;
  next: string;
}


/**
 * A paginated window into a squad market's participant entitlements.
 * 
 * `items` holds up to `limit` records starting at `offset`, ordered by side
 * (`SIDE_A` entries first, then `SIDE_B`), each side in deposit order.
 * `total` is the full roster length so a caller can detect the last page
 * without fetching an extra empty one.
 */
export interface EntitlementPage {
  items: Array<ParticipantEntitlement>;
  /**
 * Roster position of the first item returned, clamped to `total`.
 */
offset: u32;
  /**
 * Total number of participants across both sides, not just this page.
 */
total: u32;
}


/**
 * Versioned, digest-bound settlement manifest. Binds the winning side, fee
 * policy and pool totals so that every claim order can be checked against a
 * single commitment, and so integer conservation (`pool_a + pool_b ==
 * winners_payout_gross + fee_total + residual`) is verifiable exactly.
 */
export interface SettlementManifest {
  digest: Buffer;
  fee_bps: u32;
  liability_total: i128;
  pool_a: i128;
  pool_b: i128;
  result: u32;
  version: u32;
}


/**
 * A queued fee-recipient rotation, executable once `executable_at` has passed.
 */
export interface PendingFeeRecipient {
  executable_at: u64;
  next: string;
}


/**
 * Read-only settlement readiness for one market. Reported independently of
 * `resolved` so a caller can tell whether pre-deadline withdrawals are still
 * open, and whether the oracle may resolve yet.
 */
export interface SettlementReadiness {
  oracle_ready: boolean;
  remaining_escrow: i128;
  resolved: boolean;
  withdrawal_open: boolean;
}


/**
 * One participant's read-only entitlement in a squad market.
 * 
 * Amounts are exact integer USDC atomic units, computed by the same helpers
 * `claim` uses, so a record never disagrees with the payout it previews.
 */
export interface ParticipantEntitlement {
  /**
 * Whether the participant has already pulled this position.
 */
claimed: boolean;
  /**
 * Fee charged on profit only.
 */
fee: i128;
  /**
 * Gross payout the participant would receive, before fees.
 */
gross: i128;
  /**
 * Amount the participant would receive: `gross - fee`.
 */
net: i128;
  participant: string;
  /**
 * Deposited amount on this side, before any payout.
 */
principal: i128;
  side: u32;
}

/**
 * Bounded compatibility descriptor exposed for indexers. `schema_version`
 * identifies the storage layout; `min_supported` and `max_supported` bound
 * the schema interpretations this contract build can serve. Indexers must
 * reject any required schema outside this range.
 */
export interface SchemaDescriptor {
  max_supported: u32;
  min_supported: u32;
  schema_version: u32;
}

















export type DataKey = {tag: "Init", values: void} | {tag: "Usdc", values: void} | {tag: "Oracle", values: void} | {tag: "FeeRecipient", values: void} | {tag: "PendingOracle", values: void} | {tag: "PendingFeeRecipient", values: void} | {tag: "MarketCount", values: void} | {tag: "AccruedFees", values: void} | {tag: "Market", values: readonly [u64]} | {tag: "Paused", values: void} | {tag: "Deposit", values: readonly [u64, u32, string]} | {tag: "Claimed", values: readonly [u64, u32, string]} | {tag: "Payout", values: readonly [u64, u32, string]} | {tag: "Participants", values: readonly [u64, u32]};

export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pull-based payout. Solidity used `msg.sender`; Soroban has no equivalent
   * for a top-level call, so the claimant is an explicit argument that must
   * authorize. Returns the net amount transferred.
   */
  claim: ({participant, market_id, side}: {participant: string, market_id: u64, side: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deposit: ({participant, market_id, side, amount}: {participant: string, market_id: u64, side: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve: ({market_id, result}: {market_id: u64, result: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_usdc transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_usdc: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a claim_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_fees: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only view exposing the protocol limits enforced in `create_market`.
   */
  get_limits: (options?: MethodOptions) => Promise<AssembledTransaction<SquadLimits>>

  /**
   * Construct and simulate a get_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_market: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Market>>>

  /**
   * Construct and simulate a get_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Constructor equivalent, callable once.
   */
  initialize: ({usdc, oracle, fee_recipient}: {usdc: string, oracle: string, fee_recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pause or unpause the contract. Pausing must never block withdrawals,
   * claims, or parked-payout retries; only new deposits and market creation
   * are gated by the pause flag.
   */
  set_paused: ({paused}: {paused: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_deposit: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a has_claimed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_claimed: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a queue_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Queue an oracle rotation; the current oracle must authorize.
   */
  queue_oracle: ({new_oracle}: {new_oracle: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Captain-initiated market cancellation, only before the deadline. Sets the
   * market as resolved with result=RESULT_CANCELLED, allowing all depositors
   * to claim full refunds via claim(). No fees are charged on cancellation.
   */
  cancel_market: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Drop a queued oracle rotation; the current oracle must authorize.
   */
  cancel_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_market: ({captain, question, deadline, fee_bps}: {captain: string, question: string, deadline: u64, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a parked_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Payout settled in the ledger but not delivered to one winner, because
   * the token transfer trapped. `claim_parked_payout` moves it.
   */
  parked_payout: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a preview_claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  preview_claim: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ClaimResult>>>

  /**
   * Construct and simulate a execute_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a queued oracle rotation once its timelock has elapsed.
   */
  execute_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_paused_flag transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_paused_flag: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_accrued_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_accrued_fees: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_claim_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Distinct claim status for a wallet on one side of a market.
   * 
   * Returns `(claimable, already_claimed)` as separate fields so callers
   * never have to infer state from a zero amount. A wallet with no position
   * returns `(0, false)` through this read-only path without erroring.
   */
  get_claim_status: ({market_id, side, who}: {market_id: u64, side: u32, who: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [i128, boolean]>>>

  /**
   * Construct and simulate a get_market_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_market_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_pause_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pause_status: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fee_recipient: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_markets_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_markets_batch: ({ids}: {ids: Array<u64>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Array<Option<Market>>>>>

  /**
   * Construct and simulate a get_escrow_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_escrow_balance: (options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_pending_oracle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pending_oracle: (options?: MethodOptions) => Promise<AssembledTransaction<Option<PendingOracle>>>

  /**
   * Construct and simulate a claim_parked_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Retry a payout that [`Self::claim`] parked because the transfer trapped
   * (frozen or deauthorized trustline). Returns the amount moved, or `0`
   * when nothing is parked.
   */
  claim_parked_payout: ({participant, market_id, side}: {participant: string, market_id: u64, side: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a queue_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Queue a fee recipient rotation; the current fee recipient must authorize.
   */
  queue_fee_recipient: ({new_recipient}: {new_recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transition_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  transition_deadline: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Drop a queued fee recipient rotation; the current fee recipient must authorize.
   */
  cancel_fee_recipient: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Apply a queued fee recipient rotation once its timelock has elapsed.
   */
  execute_fee_recipient: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_entitlements_page transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A paginated, read-only window into a market's participant entitlements.
   * 
   * Returns up to `limit` records starting at `offset` (0-based); `limit = 0`
   * returns every remaining record. `limit` above `MAX_ENTITLEMENT_PAGE` is
   * refused, so one page is always bounded. The roster is ordered `SIDE_A`
   * entries first, then `SIDE_B`, each in deposit order, and `total` reports
   * the full roster length so a caller can detect the last page.
   * 
   * Read-only: no auth, no token transfer, no state mutation. Amounts are
   * exact integer USDC atomic units and match what `claim` would pay now.
   */
  get_entitlements_page: ({market_id, offset, limit}: {market_id: u64, offset: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<EntitlementPage>>>

  /**
   * Construct and simulate a preview_cancel_market transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only preview of the refundable liabilities that `cancel_market`
   * would create for `market_id`. Performs no value movement or authority
   * changes.
   */
  preview_cancel_market: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<CancelPreview>>>

  /**
   * Construct and simulate a get_settlement_manifest transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Versioned squad settlement manifest. Returns the digest binding the
   * winning side, fee policy and pool totals for `market_id`, together with
   * the manifest version. Liability totals are exact integer USDC.
   */
  get_settlement_manifest: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<readonly [u32, Buffer]>>>

  /**
   * Construct and simulate a get_settlement_readiness transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read-only settlement readiness for a market. Never mutates state.
   * `withdrawal_open` is reported independently of `resolved`, so callers can
   * see whether pre-deadline withdrawals remain available. Unknown markets
   * return `MarketNotFound` rather than a partial view.
   */
  get_settlement_readiness: ({market_id}: {market_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SettlementReadiness>>>

  /**
   * Construct and simulate a withdraw_before_deadline transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_before_deadline: ({participant, market_id, side, amount}: {participant: string, market_id: u64, side: u32, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_pending_fee_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pending_fee_recipient: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAJgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAALWmVyb0FkZHJlc3MAAAAAAwAAAAAAAAANRW1wdHlRdWVzdGlvbgAAAAAAAAQAAAAAAAAAC0JhZERlYWRsaW5lAAAAAAUAAAAAAAAADkZlZUNhcEV4Y2VlZGVkAAAAAAAGAAAAAAAAAA5NYXJrZXROb3RGb3VuZAAAAAAABwAAAAAAAAAMTWFya2V0Q2xvc2VkAAAACAAAAAAAAAAHQmFkU2lkZQAAAAAJAAAAAAAAAApaZXJvQW1vdW50AAAAAAAKAAAAAAAAAAhTaWRlRnVsbAAAAAsAAAAAAAAABkxvY2tlZAAAAAAADAAAAAAAAAAJQmFkQW1vdW50AAAAAAAADQAAAAAAAAAJTm90T3JhY2xlAAAAAAAADgAAAAAAAAANTm90UmVzb2x2YWJsZQAAAAAAAA8AAAAAAAAACUJhZFJlc3VsdAAAAAAAABAAAAAAAAAAC0VtcHR5V2lubmVyAAAAABEAAAAAAAAADE5vdENsYWltYWJsZQAAABIAAAAAAAAACU5vdFdpbm5lcgAAAAAAABMAAAAAAAAADkFscmVhZHlDbGFpbWVkAAAAAAAUAAAAAAAAAA9Ob3RGZWVSZWNpcGllbnQAAAAAFQAAAAAAAAAGTm9GZWVzAAAAAAAWAAAAAAAAABBVbnN1cHBvcnRlZFRva2VuAAAAFwAAAAAAAAAIT3ZlcmZsb3cAAAAYAAAAAAAAABNVbnN1cHBvcnRlZERlY2ltYWxzAAAAABkAAAAAAAAAFUNvbnNlcnZhdGlvblZpb2xhdGlvbgAAAAAAABoAAABRVGhlIG1hcmtldCBxdWVzdGlvbiBleGNlZWRlZCBgTUFYX1FVRVNUSU9OX0JZVEVTYC4gUmVmdXNlZCByYXRoZXIgdGhhbgp0cnVuY2F0ZWQuAAAAAAAAD1F1ZXN0aW9uVG9vTG9uZwAAAAAbAAABLUFsbCBbYE1BWF9TUVVBRF9NRU1CRVJTYF0gc2xvdHMgYWNyb3NzIGJvdGggc2lkZXMgaGF2ZSBiZWVuIGZpbGxlZC4KRGlzdGluY3QgZnJvbSBbYEVycm9yOjpTaWRlRnVsbGBdLCB3aGljaCBmaXJlcyB3aGVuIGEgc2luZ2xlIHNpZGUgcmVhY2hlcwpbYE1BWF9QQVJUSUNJUEFOVFNfUEVSX1NJREVgXS4gIEEgbmV3IGRlcG9zaXRvciBpcyByZWplY3RlZCBvbmNlCmBwYXJ0aWNpcGFudHNfYSArIHBhcnRpY2lwYW50c19iID09IE1BWF9TUVVBRF9NRU1CRVJTYCBldmVuIGlmIHRoZSB0YXJnZXQKc2lkZSBzdGlsbCBoYXMgcm9vbS4AAAAAAAAJU3F1YWRGdWxsAAAAAAAAHAAAAMdBIHBheW91dCBjb3VsZCBub3QgYmUgZGVsaXZlcmVkIGJlY2F1c2UgdGhlIHRva2VuIHRyYW5zZmVyIHRyYXBwZWQKKGZyb3plbiBvciBkZWF1dGhvcml6ZWQgdHJ1c3RsaW5lKS4gVGhlIGFtb3VudCBpcyBwYXJrZWQsIG5vdCBsb3N0OgpgY2xhaW1gIHN1Y2NlZWRzIGFuZCBob2xkcyBpdCwgYGNsYWltX3BhcmtlZF9wYXlvdXRgIHJldHJpZXMgaXQuAAAAAAxQYXlvdXRQYXJrZWQAAAAdAAAATWBjYW5jZWxfbWFya2V0YCB3YXMgY2FsbGVkIG9uIGEgbWFya2V0IHRoYXQgaXMgYWxyZWFkeSByZXNvbHZlZCBvcgpjYW5jZWxsZWQuAAAAAAAAD0FscmVhZHlSZXNvbHZlZAAAAAAeAAAAQ2BjYW5jZWxfb3JhY2xlYCAvIGBleGVjdXRlX29yYWNsZWAgZm91bmQgbm8gcXVldWVkIG9yYWNsZSByb3RhdGlvbi4AAAAADU5vdGhpbmdRdWV1ZWQAAAAAAAAfAAAAQ2BleGVjdXRlX29yYWNsZWAgd2FzIGNhbGxlZCBiZWZvcmUgdGhlIHJvdGF0aW9uJ3MgdGltZWxvY2sgZWxhcHNlZC4AAAAAClRpbWVsb2NrZWQAAAAAACAAAABjYGdldF9tYXJrZXRzX2JhdGNoYCB3YXMgY2FsbGVkIHdpdGggbW9yZSB0aGFuIGBNQVhfQkFUQ0hfU0laRWAgaWRzLiBSZWZ1c2VkIGJlZm9yZSByZWFkaW5nIHN0b3JhZ2UuAAAAAA1CYXRjaFRvb0xhcmdlAAAAAAAAIQAAAFhgY2FuY2VsX2ZlZV9yZWNpcGllbnRgIC8gYGV4ZWN1dGVfZmVlX3JlY2lwaWVudGAgZm91bmQgbm8gcXVldWVkCmZlZS1yZWNpcGllbnQgcm90YXRpb24uAAAAFE5vRmVlUmVjaXBpZW50UXVldWVkAAAAIgAAAEJUaGUgc2V0dGxlbWVudCBtYW5pZmVzdCB2ZXJzaW9uIGlzIG5vdCBzdXBwb3J0ZWQgYnkgdGhpcyBjb250cmFjdC4AAAAAABpVbnN1cHBvcnRlZE1hbmlmZXN0VmVyc2lvbgAAAAAAIwAAAEVUaGUgc2V0dGxlbWVudCBtYW5pZmVzdCBkaWdlc3QgZG9lcyBub3QgbWF0Y2ggdGhlIGJvdW5kIG1hcmtldCBzdGF0ZS4AAAAAAAAWTWFuaWZlc3REaWdlc3RNaXNtYXRjaAAAAAAAJAAAAHlgZ2V0X2VudGl0bGVtZW50c19wYWdlYCB3YXMgY2FsbGVkIHdpdGggYSBgbGltaXRgIGFib3ZlCltgTUFYX0VOVElUTEVNRU5UX1BBR0VgXS4gUmVmdXNlZCBiZWZvcmUgcmVhZGluZyBhbnkgZW50aXRsZW1lbnQuAAAAAAAADFBhZ2VUb29MYXJnZQAAACUAAACEVGhlIHBvb2wgaXMgcGF1c2VkOiBuZXcgZGVwb3NpdHMgYW5kIG1hcmtldCBjcmVhdGlvbiBhcmUgcmVmdXNlZCB3aGlsZQp3aXRoZHJhd2FscywgY2xhaW1zIGFuZCBwYXJrZWQtcGF5b3V0IHJldHJpZXMgc3RheSBhdmFpbGFibGUuAAAABlBhdXNlZAAAAAAAJg==",
        "AAAAAQAAAAAAAAAAAAAABk1hcmtldAAAAAAACwAAAAAAAAAHY2FwdGFpbgAAAAATAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAOcGFydGljaXBhbnRzX2EAAAAAAAQAAAAAAAAADnBhcnRpY2lwYW50c19iAAAAAAAEAAAAAAAAAAZwb29sX2EAAAAAAAsAAAAAAAAABnBvb2xfYgAAAAAACwAAAAAAAAAQcmVtYWluaW5nX2VzY3JvdwAAAAsAAAAAAAAACHJlc29sdmVkAAAAAQAAADxgMGAgdW50aWwgcmVzb2x2ZWQsIHRoZW4gU0lERV9BIC8gU0lERV9CIC8gUkVTVUxUX0NBTkNFTExFRC4AAAAGcmVzdWx0AAAAAAAEAAAAAAAAAA13aW5uZXJfY2xhaW1zAAAAAAAABA==",
        "AAAAAQAAAAAAAAAAAAAAC0NsYWltUmVzdWx0AAAAAAMAAAAAAAAAA2ZlZQAAAAALAAAAAAAAAAVncm9zcwAAAAAAAAsAAAAAAAAAA25ldAAAAAAL",
        "AAAAAgAAAQhFeHBsaWNpdCBjbGFpbSBzdGF0ZSBmb3IgYSB3YWxsZXQncyBwb3NpdGlvbiBpbiBhIHNxdWFkIG1hcmtldC4KCkRpc3Rpbmd1aXNoZXMgdGhlIHN0YXRlcyB0aGF0IHdlcmUgcHJldmlvdXNseSBjb2xsYXBzZWQgaW50byBhIHplcm8gYW1vdW50OgphIHdhbGxldCB3aXRoIG5vIHBvc2l0aW9uLCBhIHdhbGxldCB3aG9zZSBzaGFyZSBpcyBjbGFpbWFibGUgcmlnaHQgbm93LCBhbmQKYSB3YWxsZXQgd2hvc2UgcGF5b3V0IGhhcyBhbHJlYWR5IGJlZW4gY2xhaW1lZC4AAAAAAAAAC0NsYWltU3RhdHVzAAAAAAMAAAAAAAAARFRoZSB3YWxsZXQgaGFzIG5vIHBvc2l0aW9uIGluIHRoZSBtYXJrZXQgKHJlYWQtb25seSBwYXRoLCBubyBlcnJvcikuAAAACk5vUG9zaXRpb24AAAAAAAEAAAA4VGhlIHdhbGxldCBoYXMgYSBjbGFpbWFibGUgcGF5b3V0IG9mIGBuZXRgIGF0b21pYyB1bml0cy4AAAAJQ2xhaW1hYmxlAAAAAAAAAQAAAAsAAAAAAAAALVRoZSB3YWxsZXQncyBwYXlvdXQgaGFzIGFscmVhZHkgYmVlbiBjbGFpbWVkLgAAAAAAAA5BbHJlYWR5Q2xhaW1lZAAA",
        "AAAAAQAAAHBUaGUgcG9saWN5IGxpbWl0cyBgY3JlYXRlX21hcmtldGAgZW5mb3JjZXMsIHNvIGNsaWVudHMgY2FuIHJlYWQgdGhlbQppbnN0ZWFkIG9mIHByb2JpbmcgbGl2ZSBjYWxscyBmb3IgZmFpbHVyZXMuAAAAAAAAAAtTcXVhZExpbWl0cwAAAAAEAAAAAAAAAAxtYXhfZHVyYXRpb24AAAAGAAAAAAAAAAttYXhfZmVlX2JwcwAAAAAEAAAAAAAAABJtYXhfcXVlc3Rpb25fYnl0ZXMAAAAAAAQAAAAAAAAADG1pbl9kdXJhdGlvbgAAAAY=",
        "AAAAAQAAAEJSZWZ1bmRhYmxlIGxpYWJpbGl0aWVzIGEgY2FuY2VsbGF0aW9uIG9mIGBtYXJrZXRfaWRgIHdvdWxkIGNyZWF0ZS4AAAAAAAAAAAANQ2FuY2VsUHJldmlldwAAAAAAAAIAAAAAAAAACHJlZnVuZF9hAAAACwAAAAAAAAAIcmVmdW5kX2IAAAAL",
        "AAAAAQAAAEVBIHF1ZXVlZCBvcmFjbGUgcm90YXRpb24sIGV4ZWN1dGFibGUgb25jZSBgZXhlY3V0YWJsZV9hdGAgaGFzIHBhc3NlZC4AAAAAAAAAAAAADVBlbmRpbmdPcmFjbGUAAAAAAAACAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAEbmV4dAAAABM=",
        "AAAAAQAAAT5BIHBhZ2luYXRlZCB3aW5kb3cgaW50byBhIHNxdWFkIG1hcmtldCdzIHBhcnRpY2lwYW50IGVudGl0bGVtZW50cy4KCmBpdGVtc2AgaG9sZHMgdXAgdG8gYGxpbWl0YCByZWNvcmRzIHN0YXJ0aW5nIGF0IGBvZmZzZXRgLCBvcmRlcmVkIGJ5IHNpZGUKKGBTSURFX0FgIGVudHJpZXMgZmlyc3QsIHRoZW4gYFNJREVfQmApLCBlYWNoIHNpZGUgaW4gZGVwb3NpdCBvcmRlci4KYHRvdGFsYCBpcyB0aGUgZnVsbCByb3N0ZXIgbGVuZ3RoIHNvIGEgY2FsbGVyIGNhbiBkZXRlY3QgdGhlIGxhc3QgcGFnZQp3aXRob3V0IGZldGNoaW5nIGFuIGV4dHJhIGVtcHR5IG9uZS4AAAAAAAAAAAAPRW50aXRsZW1lbnRQYWdlAAAAAAMAAAAAAAAABWl0ZW1zAAAAAAAD6gAAB9AAAAAWUGFydGljaXBhbnRFbnRpdGxlbWVudAAAAAAAP1Jvc3RlciBwb3NpdGlvbiBvZiB0aGUgZmlyc3QgaXRlbSByZXR1cm5lZCwgY2xhbXBlZCB0byBgdG90YWxgLgAAAAAGb2Zmc2V0AAAAAAAEAAAAQ1RvdGFsIG51bWJlciBvZiBwYXJ0aWNpcGFudHMgYWNyb3NzIGJvdGggc2lkZXMsIG5vdCBqdXN0IHRoaXMgcGFnZS4AAAAABXRvdGFsAAAAAAAABA==",
        "AAAAAQAAARtWZXJzaW9uZWQsIGRpZ2VzdC1ib3VuZCBzZXR0bGVtZW50IG1hbmlmZXN0LiBCaW5kcyB0aGUgd2lubmluZyBzaWRlLCBmZWUKcG9saWN5IGFuZCBwb29sIHRvdGFscyBzbyB0aGF0IGV2ZXJ5IGNsYWltIG9yZGVyIGNhbiBiZSBjaGVja2VkIGFnYWluc3QgYQpzaW5nbGUgY29tbWl0bWVudCwgYW5kIHNvIGludGVnZXIgY29uc2VydmF0aW9uIChgcG9vbF9hICsgcG9vbF9iID09Cndpbm5lcnNfcGF5b3V0X2dyb3NzICsgZmVlX3RvdGFsICsgcmVzaWR1YWxgKSBpcyB2ZXJpZmlhYmxlIGV4YWN0bHkuAAAAAAAAAAASU2V0dGxlbWVudE1hbmlmZXN0AAAAAAAHAAAAAAAAAAZkaWdlc3QAAAAAA+4AAAAgAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAAD2xpYWJpbGl0eV90b3RhbAAAAAALAAAAAAAAAAZwb29sX2EAAAAAAAsAAAAAAAAABnBvb2xfYgAAAAAACwAAAAAAAAAGcmVzdWx0AAAAAAAEAAAAAAAAAAd2ZXJzaW9uAAAAAAQ=",
        "AAAAAQAAAExBIHF1ZXVlZCBmZWUtcmVjaXBpZW50IHJvdGF0aW9uLCBleGVjdXRhYmxlIG9uY2UgYGV4ZWN1dGFibGVfYXRgIGhhcyBwYXNzZWQuAAAAAAAAABNQZW5kaW5nRmVlUmVjaXBpZW50AAAAAAIAAAAAAAAADWV4ZWN1dGFibGVfYXQAAAAAAAAGAAAAAAAAAARuZXh0AAAAEw==",
        "AAAAAQAAAMFSZWFkLW9ubHkgc2V0dGxlbWVudCByZWFkaW5lc3MgZm9yIG9uZSBtYXJrZXQuIFJlcG9ydGVkIGluZGVwZW5kZW50bHkgb2YKYHJlc29sdmVkYCBzbyBhIGNhbGxlciBjYW4gdGVsbCB3aGV0aGVyIHByZS1kZWFkbGluZSB3aXRoZHJhd2FscyBhcmUgc3RpbGwKb3BlbiwgYW5kIHdoZXRoZXIgdGhlIG9yYWNsZSBtYXkgcmVzb2x2ZSB5ZXQuAAAAAAAAAAAAABNTZXR0bGVtZW50UmVhZGluZXNzAAAAAAQAAAAAAAAADG9yYWNsZV9yZWFkeQAAAAEAAAAAAAAAEHJlbWFpbmluZ19lc2Nyb3cAAAALAAAAAAAAAAhyZXNvbHZlZAAAAAEAAAAAAAAAD3dpdGhkcmF3YWxfb3BlbgAAAAAB",
        "AAAAAQAAAMxPbmUgcGFydGljaXBhbnQncyByZWFkLW9ubHkgZW50aXRsZW1lbnQgaW4gYSBzcXVhZCBtYXJrZXQuCgpBbW91bnRzIGFyZSBleGFjdCBpbnRlZ2VyIFVTREMgYXRvbWljIHVuaXRzLCBjb21wdXRlZCBieSB0aGUgc2FtZSBoZWxwZXJzCmBjbGFpbWAgdXNlcywgc28gYSByZWNvcmQgbmV2ZXIgZGlzYWdyZWVzIHdpdGggdGhlIHBheW91dCBpdCBwcmV2aWV3cy4AAAAAAAAAFlBhcnRpY2lwYW50RW50aXRsZW1lbnQAAAAAAAcAAAA5V2hldGhlciB0aGUgcGFydGljaXBhbnQgaGFzIGFscmVhZHkgcHVsbGVkIHRoaXMgcG9zaXRpb24uAAAAAAAAB2NsYWltZWQAAAAAAQAAABtGZWUgY2hhcmdlZCBvbiBwcm9maXQgb25seS4AAAAAA2ZlZQAAAAALAAAAOEdyb3NzIHBheW91dCB0aGUgcGFydGljaXBhbnQgd291bGQgcmVjZWl2ZSwgYmVmb3JlIGZlZXMuAAAABWdyb3NzAAAAAAAACwAAADRBbW91bnQgdGhlIHBhcnRpY2lwYW50IHdvdWxkIHJlY2VpdmU6IGBncm9zcyAtIGZlZWAuAAAAA25ldAAAAAALAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAMURlcG9zaXRlZCBhbW91bnQgb24gdGhpcyBzaWRlLCBiZWZvcmUgYW55IHBheW91dC4AAAAAAAAJcHJpbmNpcGFsAAAAAAAACwAAAAAAAAAEc2lkZQAAAAQ=",
        "AAAABQAAAAAAAAAAAAAAB0NsYWltZWQAAAAAAQAAAAdjbGFpbWVkAAAAAAUAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAAQAAAAAAAAAFZ3Jvc3MAAAAAAAALAAAAAAAAAAAAAAADZmVlAAAAAAsAAAAAAAAAAAAAAANuZXQAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFJlc29sdmVkAAAAAQAAAAhyZXNvbHZlZAAAAAQAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAAZyZXN1bHQAAAAAAAQAAAAAAAAAAAAAAAZwb29sX2EAAAAAAAsAAAAAAAAAAAAAAAZwb29sX2IAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAACURlcG9zaXRlZAAAAAAAAAEAAAAJZGVwb3NpdGVkAAAAAAAABQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAABHNpZGUAAAAEAAAAAQAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAABnNoYXJlcwAAAAAACwAAAAAAAAAC",
        "AAAABQAAAb5FbWl0dGVkIG9uIHRoZSBkZXBvc2l0IHRoYXQgZmlsbHMgdGhlIHNxdWFkIHRvIFtgY3JhdGU6OnR5cGVzOjpNQVhfU1FVQURfTUVNQkVSU2BdCnRvdGFsIHBhcnRpY2lwYW50cy4gU3Vic2VxdWVudCBkZXBvc2l0cyBmcm9tIG5ldyBhZGRyZXNzZXMgYXJlIHJlamVjdGVkCndpdGggW2BjcmF0ZTo6dHlwZXM6OkVycm9yOjpTcXVhZEZ1bGxgXSB1bnRpbCBleGlzdGluZyBtZW1iZXJzIHdpdGhkcmF3LgoKVGhpcyBldmVudCBmaXJlcyBvbiB0aGUgKmxhc3QgYWNjZXB0ZWQqIGRlcG9zaXQgcmF0aGVyIHRoYW4gb24gdGhlIHJlamVjdGVkCmF0dGVtcHQ6IFNvcm9iYW4gZGlzY2FyZHMgYWxsIGV2ZW50cyBlbWl0dGVkIGJ5IGEgZmFpbGVkIGludm9jYXRpb24sIHNvIGEKImNhcCBoaXQiIGV2ZW50IGNhbiBvbmx5IGJlIHJlbGlhYmx5IGluZGV4ZWQgZnJvbSBhIHN1Y2Nlc3NmdWwgb25lLgAAAAAAAAAAAAlTcXVhZEZ1bGwAAAAAAAABAAAACnNxdWFkX2Z1bGwAAAAAAAIAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAA10b3RhbF9tZW1iZXJzAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACVdpdGhkcmF3bgAAAAAAAAEAAAAJd2l0aGRyYXduAAAAAAAABAAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAABHNpZGUAAAAEAAAAAQAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAC0ZlZXNDbGFpbWVkAAAAAAEAAAAMZmVlc19jbGFpbWVkAAAAAgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAGhBbiBvcmFjbGUgcm90YXRpb24gd2FzIHF1ZXVlZCBieSB0aGUgY3VycmVudCBvcmFjbGUuClRoZSByb3RhdGlvbiBiZWNvbWVzIGV4ZWN1dGFibGUgYXQgYGV4ZWN1dGFibGVfYXRgLgAAAAAAAAAMT3JhY2xlUXVldWVkAAAAAQAAAA1vcmFjbGVfcXVldWVkAAAAAAAAAgAAAAAAAAAEbmV4dAAAABMAAAABAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAHRBIHBheW91dCBjb3VsZCBub3QgYmUgZGVsaXZlcmVkIChmcm96ZW4gb3IgZGVhdXRob3JpemVkIHRydXN0bGluZSkgYW5kIHdhcwpwYXJrZWQgZm9yIGEgbGF0ZXIgYGNsYWltX3BhcmtlZF9wYXlvdXRgLgAAAAAAAAAMUGF5b3V0UGFya2VkAAAAAQAAAA1wYXlvdXRfcGFya2VkAAAAAAAABAAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAABHNpZGUAAAAEAAAAAQAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADU1hcmtldENyZWF0ZWQAAAAAAAABAAAADm1hcmtldF9jcmVhdGVkAAAAAAAFAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAHY2FwdGFpbgAAAAATAAAAAQAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAAAAAAAIcXVlc3Rpb24AAAAQAAAAAAAAAAI=",
        "AAAABQAAAEFBIHF1ZXVlZCBvcmFjbGUgcm90YXRpb24gd2FzIGV4ZWN1dGVkIGFmdGVyIHRoZSB0aW1lbG9jayBlbGFwc2VkLgAAAAAAAAAAAAANT3JhY2xlQ2hhbmdlZAAAAAAAAAEAAAAOb3JhY2xlX2NoYW5nZWQAAAAAAAIAAAAAAAAABG5leHQAAAATAAAAAQAAAAAAAAAIcHJldmlvdXMAAAATAAAAAAAAAAI=",
        "AAAABQAAAG5FbWl0dGVkIHdoZW4gbGlxdWlkaXR5IGlzIGFkZGVkIHRvIGEgcG9vbCBtYXJrZXQuClRyYWNrcyBwb29sIGRlcHRoIGNoYW5nZXMgZm9yIGFuYWx5dGljcyBhbmQgcmlzayBtYW5hZ2VtZW50LgAAAAAAAAAAAA5MaXF1aWRpdHlBZGRlZAAAAAAAAQAAAA9saXF1aWRpdHlfYWRkZWQAAAAABQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAABHNpZGUAAAAEAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAObmV3X3Bvb2xfdG90YWwAAAAAAAsAAAAAAAAAAAAAAA1zaGFyZXNfaXNzdWVkAAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAI9BIGNhcHRhaW4gY2FuY2VsbGVkIGEgbWFya2V0IGJlZm9yZSBpdHMgZGVhZGxpbmUuIEV2ZXJ5IGRlcG9zaXRvciBjYW4gcHVsbAphIGZ1bGwgcmVmdW5kIHRocm91Z2ggYGNsYWltYDsgdGhlIHBvb2xzIGFyZSBrZXB0IGFzIGFuIGF1ZGl0IHRyYWlsLgAAAAAAAAAAD01hcmtldENhbmNlbGxlZAAAAAABAAAAEG1hcmtldF9jYW5jZWxsZWQAAAAEAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAHY2FwdGFpbgAAAAATAAAAAQAAAAAAAAAGcG9vbF9hAAAAAAALAAAAAAAAAAAAAAAGcG9vbF9iAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAD1BIHF1ZXVlZCBvcmFjbGUgcm90YXRpb24gd2FzIGNhbmNlbGxlZCBieSB0aGUgY3VycmVudCBvcmFjbGUuAAAAAAAAAAAAAA9PcmFjbGVDYW5jZWxsZWQAAAAAAQAAABBvcmFjbGVfY2FuY2VsbGVkAAAAAQAAAAAAAAAJY2FuY2VsbGVkAAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAJJFbWl0dGVkIHdoZW4gbGlxdWlkaXR5IGlzIHJlbW92ZWQgZnJvbSBhIHBvb2wgbWFya2V0IGJlZm9yZSByZXNvbHV0aW9uLgpEaXN0aW5ndWlzaGVzIGJldHdlZW4gcHJlLWRlYWRsaW5lIHdpdGhkcmF3YWxzIGFuZCBwb3N0LXJlc29sdXRpb24gY2xhaW1zLgAAAAAAAAAAABBMaXF1aWRpdHlSZW1vdmVkAAAAAQAAABFsaXF1aWRpdHlfcmVtb3ZlZAAAAAAAAAUAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAARzaWRlAAAABAAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAADm5ld19wb29sX3RvdGFsAAAAAAALAAAAAAAAAAAAAAANc2hhcmVzX2J1cm5lZAAAAAAAAAsAAAAAAAAAAg==",
        "AAAABQAAAIxFbWl0dGVkIHdoZW4gdGhlIGN1cnJlbnQgZmVlIHJlY2lwaWVudCBxdWV1ZXMgYSByb3RhdGlvbiB0byBhIG5ldyBhZGRyZXNzLgpUaGUgcm90YXRpb24gYmVjb21lcyBleGVjdXRhYmxlIG9ubHkgYXQgb3IgYWZ0ZXIgYGV4ZWN1dGFibGVfYXRgLgAAAAAAAAASRmVlUmVjaXBpZW50UXVldWVkAAAAAAABAAAAFGZlZV9yZWNpcGllbnRfcXVldWVkAAAAAgAAAAAAAAAEbmV4dAAAABMAAAABAAAAAAAAAA1leGVjdXRhYmxlX2F0AAAAAAAABgAAAAAAAAAC",
        "AAAABQAAAJZFbWl0dGVkIHdoZW4gYSBxdWV1ZWQgZmVlIHJlY2lwaWVudCByb3RhdGlvbiBpcyBleGVjdXRlZCBhZnRlciB0aGUgdGltZWxvY2suCkFueSBmZWVzIGFjY3J1ZWQgYnV0IHVuY2xhaW1lZCBhdCBleGVjdXRpb24gdGltZSBhcmUgcGF5YWJsZSB0byBgYG5leHRgYC4AAAAAAAAAAAATRmVlUmVjaXBpZW50Q2hhbmdlZAAAAAABAAAAFWZlZV9yZWNpcGllbnRfY2hhbmdlZAAAAAAAAAIAAAAAAAAABG5leHQAAAATAAAAAQAAAAAAAAAIcHJldmlvdXMAAAATAAAAAAAAAAI=",
        "AAAABQAAAFNFbWl0dGVkIHdoZW4gYSBxdWV1ZWQgZmVlIHJlY2lwaWVudCByb3RhdGlvbiBpcyBjYW5jZWxsZWQgYnkgdGhlIGN1cnJlbnQgcmVjaXBpZW50LgAAAAAAAAAAFUZlZVJlY2lwaWVudENhbmNlbGxlZAAAAAAAAAEAAAAXZmVlX3JlY2lwaWVudF9jYW5jZWxsZWQAAAAAAQAAAAAAAAAJY2FuY2VsbGVkAAAAAAAAAQAAAAAAAAAC",
        "AAAABQAAAFRFbWl0dGVkIHdoZW4gYSBwb29sIG1hcmtldCdzIGRlYWRsaW5lIHBhc3NlcyBhbmQgaXQgYmVjb21lcyBlbGlnaWJsZSBmb3IgcmVzb2x1dGlvbi4AAAAAAAAAFU1hcmtldERlYWRsaW5lUmVhY2hlZAAAAAAAAAEAAAAXbWFya2V0X2RlYWRsaW5lX3JlYWNoZWQAAAAABAAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAAAAAADHBvb2xfYV90b3RhbAAAAAsAAAAAAAAAAAAAAAxwb29sX2JfdG90YWwAAAALAAAAAAAAAAI=",
        "AAAABQAAAHZQb29sIG1hcmtldCBzdGF0ZSB0cmFuc2l0aW9uIGV2ZW50IGZvciBsaWZlY3ljbGUgYXVkaXRpbmcuCkVtaXR0ZWQgb24gZXZlcnkgc3RhdGUgY2hhbmdlIHdpdGggcHJldmlvdXMgYW5kIG5ldyBzdGF0ZXMuAAAAAAAAAAAAF01hcmtldFN0YXRlVHJhbnNpdGlvbmVkAAAAAAEAAAAZbWFya2V0X3N0YXRlX3RyYW5zaXRpb25lZAAAAAAAAAQAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAAAAAAAApmcm9tX3N0YXRlAAAAAAAEAAAAAAAAAAAAAAAIdG9fc3RhdGUAAAAEAAAAAAAAAAAAAAAJdGltZXN0YW1wAAAAAAAABgAAAAAAAAAC",
        "AAAABQAAANRFbWl0dGVkIHdoZW4gYSBzcXVhZCBzZXR0bGVtZW50IG1hbmlmZXN0IGlzIGNvbW1pdHRlZCBmb3IgYSByZXNvbHZlZCBtYXJrZXQuCmBkaWdlc3RgIGJpbmRzIHRoZSB3aW5uaW5nIHNpZGUsIGZlZSBwb2xpY3kgYW5kIHBvb2wgdG90YWxzOyBgdmVyc2lvbmAKaWRlbnRpZmllcyB0aGUgbWFuaWZlc3Qgc2NoZW1hIHNvIGluZGV4ZXJzIGNhbiBkZWNvZGUgaXQgc2FmZWx5LgAAAAAAAAAbU2V0dGxlbWVudE1hbmlmZXN0Q29tbWl0dGVkAAAAAAEAAAAdc2V0dGxlbWVudF9tYW5pZmVzdF9jb21taXR0ZWQAAAAAAAAHAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAAAAAAAAHdmVyc2lvbgAAAAAEAAAAAAAAAAAAAAAMd2lubmluZ19zaWRlAAAABAAAAAAAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAAAAAABnBvb2xfYQAAAAAACwAAAAAAAAAAAAAABnBvb2xfYgAAAAAACwAAAAAAAAAAAAAABmRpZ2VzdAAAAAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADgAAAAAAAAAAAAAABEluaXQAAAAAAAAAAAAAAARVc2RjAAAAAAAAAAAAAAAGT3JhY2xlAAAAAAAAAAAAAAAAAAxGZWVSZWNpcGllbnQAAAAAAAAAAAAAAA1QZW5kaW5nT3JhY2xlAAAAAAAAAAAAAAAAAAATUGVuZGluZ0ZlZVJlY2lwaWVudAAAAAAAAAAAAAAAAAtNYXJrZXRDb3VudAAAAAAAAAAAAAAAAAtBY2NydWVkRmVlcwAAAAABAAAAAAAAAAZNYXJrZXQAAAAAAAEAAAAGAAAAAAAAAKxHbG9iYWwgcGF1c2UgZmxhZy4gV2hlbiBzZXQsIHN0YXRlLW11dGF0aW5nIGVudHJ5IHBvaW50cyB0aGF0IGFyZSBub3QKd2l0aGRyYXdhbHMgYXJlIHJlamVjdGVkLiBXaXRoZHJhd2FscyAoY2xhaW0sIGNsYWltX3BhcmtlZF9wYXlvdXQpCk1VU1QgcmVtYWluIGF2YWlsYWJsZSB3aGlsZSBwYXVzZWQuAAAABlBhdXNlZAAAAAAAAQAAAEMobWFya2V0LCBzaWRlLCBwYXJ0aWNpcGFudCkgLT4gZGVwb3NpdGVkIHVuaXRzLiBTaGFyZXMgZXF1YWwgdW5pdHMuAAAAAAdEZXBvc2l0AAAAAAMAAAAGAAAABAAAABMAAAABAAAALyhtYXJrZXQsIHNpZGUsIHBhcnRpY2lwYW50KSAtPiBhbHJlYWR5IGNsYWltZWQuAAAAAAdDbGFpbWVkAAAAAAMAAAAGAAAABAAAABMAAAABAAAAxShtYXJrZXQsIHNpZGUsIHBhcnRpY2lwYW50KSAtPiBwYXlvdXQgc2V0dGxlZCBpbiB0aGUgbGVkZ2VyIGJ1dCBub3QKZGVsaXZlcmVkLCBiZWNhdXNlIHRoZSB0b2tlbiB0cmFuc2ZlciB0cmFwcGVkIChmcm96ZW4gb3IgZGVhdXRob3JpemVkCnRydXN0bGluZSkuIFBhcmtlZCB1bnRpbCBgY2xhaW1fcGFya2VkX3BheW91dGAgY2FuIG1vdmUgaXQuAAAAAAAABlBheW91dAAAAAAAAwAAAAYAAAAEAAAAEwAAAAEAAADTKG1hcmtldCwgc2lkZSkgLT4gb3BlbiBwYXJ0aWNpcGFudHMgaW4gZGVwb3NpdCBvcmRlci4gTWVtYmVyc2hpcCBmb2xsb3dzCnRoZSBkZXBvc2l0IGVudHJpZXM6IGEgbmV3IGRlcG9zaXRvciBpcyBhcHBlbmRlZCBhbmQgYSBmdWxsIHdpdGhkcmF3YWwKaXMgcmVtb3ZlZCwgc28gdGhlIHJvc3RlciBpcyBleGFjdGx5IHRoZSBzZXQgb2Ygbm9uLXplcm8gcG9zaXRpb25zLgAAAAAMUGFydGljaXBhbnRzAAAAAgAAAAYAAAAE",
        "AAAAAAAAAL9QdWxsLWJhc2VkIHBheW91dC4gU29saWRpdHkgdXNlZCBgbXNnLnNlbmRlcmA7IFNvcm9iYW4gaGFzIG5vIGVxdWl2YWxlbnQKZm9yIGEgdG9wLWxldmVsIGNhbGwsIHNvIHRoZSBjbGFpbWFudCBpcyBhbiBleHBsaWNpdCBhcmd1bWVudCB0aGF0IG11c3QKYXV0aG9yaXplLiBSZXR1cm5zIHRoZSBuZXQgYW1vdW50IHRyYW5zZmVycmVkLgAAAAAFY2xhaW0AAAAAAAADAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAARzaWRlAAAABAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAtwYXJ0aWNpcGFudAAAAAATAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAARzaWRlAAAABAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVzb2x2ZQAAAAACAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAAZyZXN1bHQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAIZ2V0X3VzZGMAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAKY2xhaW1fZmVlcwAAAAAAAAAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAEhSZWFkLW9ubHkgdmlldyBleHBvc2luZyB0aGUgcHJvdG9jb2wgbGltaXRzIGVuZm9yY2VkIGluIGBjcmVhdGVfbWFya2V0YC4AAAAKZ2V0X2xpbWl0cwAAAAAAAAAAAAEAAAfQAAAAC1NxdWFkTGltaXRzAA==",
        "AAAAAAAAAAAAAAAKZ2V0X21hcmtldAAAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAZNYXJrZXQAAAAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X29yYWNsZQAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X3BhdXNlZAAAAAAAAAAAAAEAAAAB",
        "AAAAAAAAACZDb25zdHJ1Y3RvciBlcXVpdmFsZW50LCBjYWxsYWJsZSBvbmNlLgAAAAAACmluaXRpYWxpemUAAAAAAAMAAAAAAAAABHVzZGMAAAATAAAAAAAAAAZvcmFjbGUAAAAAABMAAAAAAAAADWZlZV9yZWNpcGllbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAKlQYXVzZSBvciB1bnBhdXNlIHRoZSBjb250cmFjdC4gUGF1c2luZyBtdXN0IG5ldmVyIGJsb2NrIHdpdGhkcmF3YWxzLApjbGFpbXMsIG9yIHBhcmtlZC1wYXlvdXQgcmV0cmllczsgb25seSBuZXcgZGVwb3NpdHMgYW5kIG1hcmtldCBjcmVhdGlvbgphcmUgZ2F0ZWQgYnkgdGhlIHBhdXNlIGZsYWcuAAAAAAAACnNldF9wYXVzZWQAAAAAAAEAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAALZ2V0X2RlcG9zaXQAAAAAAwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAAA3dobwAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAALaGFzX2NsYWltZWQAAAAAAwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAAA3dobwAAAAATAAAAAQAAAAE=",
        "AAAAAAAAADxRdWV1ZSBhbiBvcmFjbGUgcm90YXRpb247IHRoZSBjdXJyZW50IG9yYWNsZSBtdXN0IGF1dGhvcml6ZS4AAAAMcXVldWVfb3JhY2xlAAAAAQAAAAAAAAAKbmV3X29yYWNsZQAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANpDYXB0YWluLWluaXRpYXRlZCBtYXJrZXQgY2FuY2VsbGF0aW9uLCBvbmx5IGJlZm9yZSB0aGUgZGVhZGxpbmUuIFNldHMgdGhlCm1hcmtldCBhcyByZXNvbHZlZCB3aXRoIHJlc3VsdD1SRVNVTFRfQ0FOQ0VMTEVELCBhbGxvd2luZyBhbGwgZGVwb3NpdG9ycwp0byBjbGFpbSBmdWxsIHJlZnVuZHMgdmlhIGNsYWltKCkuIE5vIGZlZXMgYXJlIGNoYXJnZWQgb24gY2FuY2VsbGF0aW9uLgAAAAAADWNhbmNlbF9tYXJrZXQAAAAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEFEcm9wIGEgcXVldWVkIG9yYWNsZSByb3RhdGlvbjsgdGhlIGN1cnJlbnQgb3JhY2xlIG11c3QgYXV0aG9yaXplLgAAAAAAAA1jYW5jZWxfb3JhY2xlAAAAAAAAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANY3JlYXRlX21hcmtldAAAAAAAAAQAAAAAAAAAB2NhcHRhaW4AAAAAEwAAAAAAAAAIcXVlc3Rpb24AAAAQAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAIFQYXlvdXQgc2V0dGxlZCBpbiB0aGUgbGVkZ2VyIGJ1dCBub3QgZGVsaXZlcmVkIHRvIG9uZSB3aW5uZXIsIGJlY2F1c2UKdGhlIHRva2VuIHRyYW5zZmVyIHRyYXBwZWQuIGBjbGFpbV9wYXJrZWRfcGF5b3V0YCBtb3ZlcyBpdC4AAAAAAAANcGFya2VkX3BheW91dAAAAAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAABHNpZGUAAAAEAAAAAAAAAAN3aG8AAAAAEwAAAAEAAAAL",
        "AAAAAAAAAAAAAAANcHJldmlld19jbGFpbQAAAAAAAAMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAABHNpZGUAAAAEAAAAAAAAAAN3aG8AAAAAEwAAAAEAAAPpAAAH0AAAAAtDbGFpbVJlc3VsdAAAAAAD",
        "AAAAAAAAAD1BcHBseSBhIHF1ZXVlZCBvcmFjbGUgcm90YXRpb24gb25jZSBpdHMgdGltZWxvY2sgaGFzIGVsYXBzZWQuAAAAAAAADmV4ZWN1dGVfb3JhY2xlAAAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAPZ2V0X3BhdXNlZF9mbGFnAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAQZ2V0X2FjY3J1ZWRfZmVlcwAAAAAAAAABAAAACw==",
        "AAAAAAAAAQxEaXN0aW5jdCBjbGFpbSBzdGF0dXMgZm9yIGEgd2FsbGV0IG9uIG9uZSBzaWRlIG9mIGEgbWFya2V0LgoKUmV0dXJucyBgKGNsYWltYWJsZSwgYWxyZWFkeV9jbGFpbWVkKWAgYXMgc2VwYXJhdGUgZmllbGRzIHNvIGNhbGxlcnMKbmV2ZXIgaGF2ZSB0byBpbmZlciBzdGF0ZSBmcm9tIGEgemVybyBhbW91bnQuIEEgd2FsbGV0IHdpdGggbm8gcG9zaXRpb24KcmV0dXJucyBgKDAsIGZhbHNlKWAgdGhyb3VnaCB0aGlzIHJlYWQtb25seSBwYXRoIHdpdGhvdXQgZXJyb3JpbmcuAAAAEGdldF9jbGFpbV9zdGF0dXMAAAADAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAAAAAARzaWRlAAAABAAAAAAAAAADd2hvAAAAABMAAAABAAAD6QAAA+0AAAACAAAACwAAAAEAAAAD",
        "AAAAAAAAAAAAAAAQZ2V0X21hcmtldF9jb3VudAAAAAAAAAABAAAABg==",
        "AAAAAAAAAAAAAAAQZ2V0X3BhdXNlX3N0YXR1cwAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAARZ2V0X2ZlZV9yZWNpcGllbnQAAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==",
        "AAAAAAAAAAAAAAARZ2V0X21hcmtldHNfYmF0Y2gAAAAAAAABAAAAAAAAAANpZHMAAAAD6gAAAAYAAAABAAAD6QAAA+oAAAPoAAAH0AAAAAZNYXJrZXQAAAAAAAM=",
        "AAAAAAAAAAAAAAASZ2V0X2VzY3Jvd19iYWxhbmNlAAAAAAAAAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAASZ2V0X3BlbmRpbmdfb3JhY2xlAAAAAAAAAAAAAQAAA+gAAAfQAAAADVBlbmRpbmdPcmFjbGUAAAA=",
        "AAAAAAAAAKRSZXRyeSBhIHBheW91dCB0aGF0IFtgU2VsZjo6Y2xhaW1gXSBwYXJrZWQgYmVjYXVzZSB0aGUgdHJhbnNmZXIgdHJhcHBlZAooZnJvemVuIG9yIGRlYXV0aG9yaXplZCB0cnVzdGxpbmUpLiBSZXR1cm5zIHRoZSBhbW91bnQgbW92ZWQsIG9yIGAwYAp3aGVuIG5vdGhpbmcgaXMgcGFya2VkLgAAABNjbGFpbV9wYXJrZWRfcGF5b3V0AAAAAAMAAAAAAAAAC3BhcnRpY2lwYW50AAAAABMAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAAAAAAABHNpZGUAAAAEAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAElRdWV1ZSBhIGZlZSByZWNpcGllbnQgcm90YXRpb247IHRoZSBjdXJyZW50IGZlZSByZWNpcGllbnQgbXVzdCBhdXRob3JpemUuAAAAAAAAE3F1ZXVlX2ZlZV9yZWNpcGllbnQAAAAAAQAAAAAAAAANbmV3X3JlY2lwaWVudAAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAATdHJhbnNpdGlvbl9kZWFkbGluZQAAAAABAAAAAAAAAAltYXJrZXRfaWQAAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAE9Ecm9wIGEgcXVldWVkIGZlZSByZWNpcGllbnQgcm90YXRpb247IHRoZSBjdXJyZW50IGZlZSByZWNpcGllbnQgbXVzdCBhdXRob3JpemUuAAAAABRjYW5jZWxfZmVlX3JlY2lwaWVudAAAAAAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAERBcHBseSBhIHF1ZXVlZCBmZWUgcmVjaXBpZW50IHJvdGF0aW9uIG9uY2UgaXRzIHRpbWVsb2NrIGhhcyBlbGFwc2VkLgAAABVleGVjdXRlX2ZlZV9yZWNpcGllbnQAAAAAAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAjRBIHBhZ2luYXRlZCwgcmVhZC1vbmx5IHdpbmRvdyBpbnRvIGEgbWFya2V0J3MgcGFydGljaXBhbnQgZW50aXRsZW1lbnRzLgoKUmV0dXJucyB1cCB0byBgbGltaXRgIHJlY29yZHMgc3RhcnRpbmcgYXQgYG9mZnNldGAgKDAtYmFzZWQpOyBgbGltaXQgPSAwYApyZXR1cm5zIGV2ZXJ5IHJlbWFpbmluZyByZWNvcmQuIGBsaW1pdGAgYWJvdmUgYE1BWF9FTlRJVExFTUVOVF9QQUdFYCBpcwpyZWZ1c2VkLCBzbyBvbmUgcGFnZSBpcyBhbHdheXMgYm91bmRlZC4gVGhlIHJvc3RlciBpcyBvcmRlcmVkIGBTSURFX0FgCmVudHJpZXMgZmlyc3QsIHRoZW4gYFNJREVfQmAsIGVhY2ggaW4gZGVwb3NpdCBvcmRlciwgYW5kIGB0b3RhbGAgcmVwb3J0cwp0aGUgZnVsbCByb3N0ZXIgbGVuZ3RoIHNvIGEgY2FsbGVyIGNhbiBkZXRlY3QgdGhlIGxhc3QgcGFnZS4KClJlYWQtb25seTogbm8gYXV0aCwgbm8gdG9rZW4gdHJhbnNmZXIsIG5vIHN0YXRlIG11dGF0aW9uLiBBbW91bnRzIGFyZQpleGFjdCBpbnRlZ2VyIFVTREMgYXRvbWljIHVuaXRzIGFuZCBtYXRjaCB3aGF0IGBjbGFpbWAgd291bGQgcGF5IG5vdy4AAAAVZ2V0X2VudGl0bGVtZW50c19wYWdlAAAAAAAAAwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAGb2Zmc2V0AAAAAAAEAAAAAAAAAAVsaW1pdAAAAAAAAAQAAAABAAAD6QAAB9AAAAAPRW50aXRsZW1lbnRQYWdlAAAAAAM=",
        "AAAAAAAAAJNSZWFkLW9ubHkgcHJldmlldyBvZiB0aGUgcmVmdW5kYWJsZSBsaWFiaWxpdGllcyB0aGF0IGBjYW5jZWxfbWFya2V0YAp3b3VsZCBjcmVhdGUgZm9yIGBtYXJrZXRfaWRgLiBQZXJmb3JtcyBubyB2YWx1ZSBtb3ZlbWVudCBvciBhdXRob3JpdHkKY2hhbmdlcy4AAAAAFXByZXZpZXdfY2FuY2VsX21hcmtldAAAAAAAAAEAAAAAAAAACW1hcmtldF9pZAAAAAAAAAYAAAABAAAD6QAAB9AAAAANQ2FuY2VsUHJldmlldwAAAAAAAAM=",
        "AAAAAAAAAMpWZXJzaW9uZWQgc3F1YWQgc2V0dGxlbWVudCBtYW5pZmVzdC4gUmV0dXJucyB0aGUgZGlnZXN0IGJpbmRpbmcgdGhlCndpbm5pbmcgc2lkZSwgZmVlIHBvbGljeSBhbmQgcG9vbCB0b3RhbHMgZm9yIGBtYXJrZXRfaWRgLCB0b2dldGhlciB3aXRoCnRoZSBtYW5pZmVzdCB2ZXJzaW9uLiBMaWFiaWxpdHkgdG90YWxzIGFyZSBleGFjdCBpbnRlZ2VyIFVTREMuAAAAAAAXZ2V0X3NldHRsZW1lbnRfbWFuaWZlc3QAAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAD7QAAAAIAAAAEAAAD7gAAACAAAAAD",
        "AAAAAAAAAQZSZWFkLW9ubHkgc2V0dGxlbWVudCByZWFkaW5lc3MgZm9yIGEgbWFya2V0LiBOZXZlciBtdXRhdGVzIHN0YXRlLgpgd2l0aGRyYXdhbF9vcGVuYCBpcyByZXBvcnRlZCBpbmRlcGVuZGVudGx5IG9mIGByZXNvbHZlZGAsIHNvIGNhbGxlcnMgY2FuCnNlZSB3aGV0aGVyIHByZS1kZWFkbGluZSB3aXRoZHJhd2FscyByZW1haW4gYXZhaWxhYmxlLiBVbmtub3duIG1hcmtldHMKcmV0dXJuIGBNYXJrZXROb3RGb3VuZGAgcmF0aGVyIHRoYW4gYSBwYXJ0aWFsIHZpZXcuAAAAAAAYZ2V0X3NldHRsZW1lbnRfcmVhZGluZXNzAAAAAQAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAABNTZXR0bGVtZW50UmVhZGluZXNzAAAAAAM=",
        "AAAAAAAAAAAAAAAYd2l0aGRyYXdfYmVmb3JlX2RlYWRsaW5lAAAABAAAAAAAAAALcGFydGljaXBhbnQAAAAAEwAAAAAAAAAJbWFya2V0X2lkAAAAAAAABgAAAAAAAAAEc2lkZQAAAAQAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAZZ2V0X3BlbmRpbmdfZmVlX3JlY2lwaWVudAAAAAAAAAAAAAABAAAD6AAAABM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<Result<i128>>,
        deposit: this.txFromJSON<Result<void>>,
        resolve: this.txFromJSON<Result<void>>,
        get_usdc: this.txFromJSON<Result<string>>,
        is_paused: this.txFromJSON<boolean>,
        claim_fees: this.txFromJSON<Result<i128>>,
        get_limits: this.txFromJSON<SquadLimits>,
        get_market: this.txFromJSON<Result<Market>>,
        get_oracle: this.txFromJSON<Result<string>>,
        get_paused: this.txFromJSON<boolean>,
        initialize: this.txFromJSON<Result<void>>,
        set_paused: this.txFromJSON<Result<void>>,
        get_deposit: this.txFromJSON<i128>,
        has_claimed: this.txFromJSON<boolean>,
        queue_oracle: this.txFromJSON<Result<void>>,
        cancel_market: this.txFromJSON<Result<void>>,
        cancel_oracle: this.txFromJSON<Result<void>>,
        create_market: this.txFromJSON<Result<u64>>,
        parked_payout: this.txFromJSON<i128>,
        preview_claim: this.txFromJSON<Result<ClaimResult>>,
        execute_oracle: this.txFromJSON<Result<void>>,
        get_paused_flag: this.txFromJSON<boolean>,
        get_accrued_fees: this.txFromJSON<i128>,
        get_claim_status: this.txFromJSON<Result<readonly [i128, boolean]>>,
        get_market_count: this.txFromJSON<u64>,
        get_pause_status: this.txFromJSON<boolean>,
        get_fee_recipient: this.txFromJSON<Result<string>>,
        get_markets_batch: this.txFromJSON<Result<Array<Option<Market>>>>,
        get_escrow_balance: this.txFromJSON<Result<i128>>,
        get_pending_oracle: this.txFromJSON<Option<PendingOracle>>,
        claim_parked_payout: this.txFromJSON<Result<i128>>,
        queue_fee_recipient: this.txFromJSON<Result<void>>,
        transition_deadline: this.txFromJSON<Result<void>>,
        cancel_fee_recipient: this.txFromJSON<Result<void>>,
        execute_fee_recipient: this.txFromJSON<Result<void>>,
        get_entitlements_page: this.txFromJSON<Result<EntitlementPage>>,
        preview_cancel_market: this.txFromJSON<Result<CancelPreview>>,
        get_settlement_manifest: this.txFromJSON<Result<readonly [u32, Buffer]>>,
        get_settlement_readiness: this.txFromJSON<Result<SettlementReadiness>>,
        withdraw_before_deadline: this.txFromJSON<Result<void>>,
        get_pending_fee_recipient: this.txFromJSON<Option<string>>
  }
}