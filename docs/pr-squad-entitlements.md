# feat(contracts): add a paginated squad participant entitlement view

## Summary

Adds `get_entitlements_page` to `mimir-squad`, a read-only, paginated window over a
market's participant entitlements. Operators and UIs can now read what every
participant is owed — exact principal, gross, fee and net amounts, plus whether the
position has been pulled — without calling `claim` for each wallet or replaying
`Claimed` events. The function is a pure read: no auth, no USDC transfer, no state
mutation.

Closes #791

---

## What changed

### Rust (`contracts-soroban/mimir-squad/src/`)

| File | Change |
|------|--------|
| `types.rs` | Added `ParticipantEntitlement`, `EntitlementPage`, `MAX_ENTITLEMENT_PAGE` (50) and `Error::PageTooLarge` |
| `storage.rs` | Added the `Participants(market, side)` roster and its append/remove/page accessors |
| `pool.rs` | Added `entitlements_page`; the roster is maintained by `deposit` (append on a new position) and `withdraw_before_deadline` (remove on a full withdrawal) |
| `contract.rs` | Added the `get_entitlements_page(market_id, offset, limit)` entry point |
| `test_entitlements.rs` | Focused tests for amounts, pagination, boundaries and read-only behaviour |

### Interface

```rust
fn get_entitlements_page(
    env: Env,
    market_id: u64,
    offset: u32,
    limit: u32,
) -> Result<EntitlementPage, Error>
```

`EntitlementPage { items, offset, total }`:

- `items` holds at most `limit` records, starting at `offset`.
- `offset` echoes the caller's cursor, clamped to `total`.
- `total` is the full roster length across both sides, so a caller can detect the
  last page without fetching an extra empty one.

`ParticipantEntitlement { participant, side, principal, gross, fee, net, claimed }`
carries exact integer USDC atomic units. Ordering is `SIDE_A` entries first, then
`SIDE_B`, each side in deposit order. `limit = 0` returns every remaining record;
`limit > MAX_ENTITLEMENT_PAGE` is refused with `PageTooLarge` before any record is
read.

### Semantics

- Unresolved market: `principal` is reported, `gross`/`fee`/`net` are `0`.
- Resolved market: the amounts come from the same `winner_gross` and `profit_fee`
  helpers `claim` uses, so a record cannot disagree with the payout it previews.
  The final winner's record includes the dust it absorbs.
- Claimed position: zeros with `claimed = true`; the principal is kept as history.
- Losing side or no position: zeros with `claimed = false`, never an error.
- Unknown market: `MarketNotFound`, matching `get_market`.

---

## Acceptance criteria

- [x] Bounded public entitlement records, returned without triggering payment.
- [x] Exact atomic amounts and deterministic continuation (`offset` + `total`).
- [x] Focused automated coverage for the behaviour and its boundary/failure cases.
- [x] Existing deposit, withdraw, resolve, claim and preview behaviour unchanged.

---

## Accounting

`get_entitlements_page` is unconditionally read-only:

- No USDC contract transfer, no escrow change, no fee accrual, no claim marking.
- TTL handling matches the existing read accessors: a present roster entry is
  bumped by the same `BUMP_THRESHOLD` / `BUMP_EXTEND` pair used elsewhere.
- The roster mirrors the deposit entries exactly: it gains an address only on a
  new position and loses one only when the position is fully withdrawn, so
  `total` always equals `participants_a + participants_b`.

---

## Migration

Additive. The new storage key starts empty and is filled by deposits made after
the upgrade; positions that existed before it are not retroactively indexed. No
existing entry point, error discriminant or storage shape changed, and no state
migration or re-initialisation is needed.

---

## Test evidence

```text
# After
cargo test -p mimir-squad --release --locked
test result: ok. 162 passed; 0 failed; 0 ignored          (was: crate did not compile)

cargo build -p mimir-squad --release --target wasm32v1-none --locked
Finished `release` profile [optimized]
```

### Before / after

| | Before | After |
|---|---|---|
| Entitlements for a 200-participant squad | 200 `preview_claim` simulations, one per wallet | one `get_entitlements_page` call with `limit = 50`, plus the roster `total` |
| Participant roster | no way to enumerate it on chain | `total` is reported and every position is returned once across pages |
| Squad crate tests | did not compile on `main` | 162 passed, 0 failed |

The workspace-wide `cargo test` is still blocked by `mimir-market`, which does not
compile on this baseline (`#no_std` at the crate root plus symbols lost in earlier
merges). That crate is untouched by this change.

New tests in `test_entitlements.rs`:

- Unresolved market reports principal with zero payout, and moves no funds.
- Resolved market matches `preview_claim` field-by-field for every participant,
  and `gross + fee` over both sides equals `pool_a + pool_b`.
- Pages of 2 tile a five-participant roster exactly once in side order, with a
  partial last page and a deterministic repeat for the same cursor.
- `offset` beyond the roster returns an empty page with the correct total.
- `limit` above `MAX_ENTITLEMENT_PAGE` is rejected; the cap itself is accepted.
- Unknown market returns `MarketNotFound`.
- A claimed position reports zeros with `claimed = true` while an outstanding
  winner still reports its amount and receives nothing from the read.
- A full withdrawal removes the position; a partial one keeps it with the
  reduced principal.
- A double-sided depositor appears once per side.

## Baseline repairs

`main` did not compile (`mimir-squad` and `mimir-market` roots, `test_fee_recipient_rotation.rs`
and `test_preview_parity.rs` carried merge losses from earlier PRs). This change
restores those files so the contract suite runs, without changing deployed
behaviour: `#[config(test)]` → `#[cfg(test)]`, missing `CancelPreview` /
`SettlementReadiness` / `SquadLimits` types, the pause and fee-recipient entry
points the contract surface already referenced, and the parity fixtures now read
the current `tests/fixtures/squad-payouts` schema.
