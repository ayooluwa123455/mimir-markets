#![cfg(test)]
//! Cross-version claim lifecycle migration fixtures.
//!
//! A Soroban upgrade keeps the contract id and its persistent entries, so a
//! claim funded and/or resolved by an older build must settle under the new
//! code with the same escrow liability, verdict meaning and pull eligibility.
//!
//! Each fixture under `tests/fixtures/claim-migrations/` describes a synthetic
//! funded state. The test builds that state with the public entry points, then
//! downgrades the stored claim to what an older build would have left behind
//! (no versioned verdict record), snapshots the pre-upgrade liability, and
//! replays settlement through the read and pull endpoints a client uses after
//! the upgrade. All amounts are integer USDC atomic units; no live deployment,
//! credentials or funded state is touched.

extern crate std;

use serde::Deserialize;

use crate::storage::DataKey;
use crate::test_common::{Fixture, USDC};
use crate::types::{ClaimState, Error, WinnerSide, VERDICT_VERSION_V1};

/// One synthetic funded state, replayed across a simulated upgrade.
#[derive(Deserialize)]
struct ClaimMigrationFixture {
    name: std::string::String,
    creator_stake: i128,
    challengers: std::vec::Vec<i128>,
    /// `"active"` (funded, not yet resolved) or `"resolved"` (challengers won
    /// and the claim is mid-payout).
    state: std::string::String,
    /// Challengers that already pulled before the upgrade.
    pre_upgrade_claims: usize,
    /// Escrow still owed after `pre_upgrade_claims`.
    expected_escrow_liability: i128,
    /// Gross payout per challenger in pull order. These fixtures use a zero fee
    /// policy, so the net pulled equals the gross.
    expected_payouts: std::vec::Vec<i128>,
}

fn parse_fixture(json: &str) -> ClaimMigrationFixture {
    serde_json::from_str(json).expect("claim migration fixture must parse")
}

/// Simulate a claim resolved by a pre-versioning build: drop the versioned
/// verdict record so only `Claim.winner_side` remains.
fn drop_versioned_verdict(f: &Fixture, id: u64) {
    f.env.as_contract(&f.contract_id, || {
        f.env.storage().persistent().remove(&DataKey::Verdict(id));
    });
}

fn replay_fixture(fixture: &ClaimMigrationFixture) {
    let f = Fixture::new(0, 0);
    let creator = f.user(fixture.creator_stake * 2);
    let id = f
        .client()
        .create_claim(&creator, &f.params(fixture.creator_stake));

    let mut challengers = std::vec::Vec::new();
    for stake in fixture.challengers.iter() {
        let who = f.user(*stake);
        f.client().challenge_claim(&who, &id, stake, &None);
        challengers.push(who);
    }

    let resolved_before = fixture.state == "resolved";
    f.advance_by(3_600);
    if resolved_before {
        f.client().resolve_claim(
            &id,
            &WinnerSide::Challengers,
            &f.str("challengers"),
            &90,
            &f.zero_hash(),
        );
        // Emulate a claim resolved by a build that wrote no versioned verdict.
        drop_versioned_verdict(&f, id);

        // Payouts that already happened before the upgrade, in pull order.
        for index in 0..fixture.pre_upgrade_claims {
            let paid = f.client().claim_challenger_payout(&challengers[index], &id);
            assert_eq!(paid, fixture.expected_payouts[index]);
        }
    }

    // ── Before the upgrade ──────────────────────────────────────────────────
    let claim_before = f.client().get_claim(&id);
    let liability_before = if resolved_before {
        claim_before.remaining_escrow
    } else {
        claim_before.creator_stake + claim_before.total_challenger_stake
    };
    assert_eq!(
        liability_before, fixture.expected_escrow_liability,
        "fixture '{}': pre-upgrade escrow liability",
        fixture.name
    );

    if resolved_before {
        // A pre-versioning build left no verdict record: the claim's own side
        // is the only source of truth.
        assert!(f
            .env
            .as_contract(&f.contract_id, || crate::storage::verdict(&f.env, id))
            .is_none());
        let verdict = f.client().get_verdict(&id);
        assert_eq!(verdict.side, WinnerSide::Challengers);
        assert_eq!(verdict.version, VERDICT_VERSION_V1);
    }

    // ── After the upgrade ───────────────────────────────────────────────────
    if !resolved_before {
        f.client().resolve_claim(
            &id,
            &WinnerSide::Challengers,
            &f.str("challengers"),
            &90,
            &f.zero_hash(),
        );
    }

    let claim_after = f.client().get_claim(&id);
    assert_eq!(claim_after.state, ClaimState::Resolved);
    assert_eq!(claim_after.winner_side, WinnerSide::Challengers);
    assert_eq!(
        claim_after.remaining_escrow, fixture.expected_escrow_liability,
        "fixture '{}': liability must survive the upgrade",
        fixture.name
    );
    assert_eq!(
        f.client().get_verdict(&id).side,
        WinnerSide::Challengers,
        "fixture '{}': verdict meaning must survive the upgrade",
        fixture.name
    );

    // Pull eligibility and amounts are unchanged for every remaining winner.
    for index in fixture.pre_upgrade_claims..challengers.len() {
        let quote = f.client().quote_challenger_payout(&id, &challengers[index]);
        assert_eq!(
            quote.net, fixture.expected_payouts[index],
            "fixture '{}': post-upgrade quote for challenger {}",
            fixture.name, index
        );
        let balance_before = f.token().balance(&challengers[index]);
        let paid = f.client().claim_challenger_payout(&challengers[index], &id);
        assert_eq!(paid, fixture.expected_payouts[index]);
        assert_eq!(
            f.token().balance(&challengers[index]) - balance_before,
            fixture.expected_payouts[index]
        );
    }

    let settled = f.client().get_claim(&id);
    assert_eq!(settled.remaining_escrow, 0, "fixture '{}'", fixture.name);
    assert_eq!(
        settled.challenger_claims,
        fixture.challengers.len() as u32,
        "fixture '{}'",
        fixture.name
    );
    assert_eq!(f.escrow_balance(), 0, "fixture '{}'", fixture.name);
}

#[test]
fn legacy_active_pool_resolves_after_upgrade() {
    let json = include_str!(
        "../../tests/fixtures/claim-migrations/legacy_active_pool_resolves_after_upgrade.json"
    );
    replay_fixture(&parse_fixture(json));
}

#[test]
fn legacy_resolved_pool_without_versioned_verdict_still_pays() {
    let json = include_str!(
        "../../tests/fixtures/claim-migrations/legacy_resolved_pool_without_versioned_verdict.json"
    );
    replay_fixture(&parse_fixture(json));
}

#[test]
fn legacy_partially_paid_pool_replays_remaining_pull() {
    let json = include_str!(
        "../../tests/fixtures/claim-migrations/legacy_partially_paid_pool_replays_remaining_pull.json"
    );
    replay_fixture(&parse_fixture(json));
}

#[test]
fn legacy_dust_boundary_last_puller_absorbs_remainder() {
    let json = include_str!(
        "../../tests/fixtures/claim-migrations/legacy_dust_boundary_last_puller_absorbs_remainder.json"
    );
    replay_fixture(&parse_fixture(json));
}

/// A pre-versioning claim that the creator won keeps its verdict meaning: the
/// challenger pull stays ineligible and nothing moves.
#[test]
fn legacy_creator_win_keeps_challenger_pull_ineligible() {
    let f = Fixture::new(0, 0);
    let creator = f.user(20 * USDC);
    let challenger = f.user(10 * USDC);
    let id = f.client().create_claim(&creator, &f.params(10 * USDC));
    f.client()
        .challenge_claim(&challenger, &id, &(10 * USDC), &None);

    f.advance_by(3_600);
    f.client().resolve_claim(
        &id,
        &WinnerSide::Creator,
        &f.str("creator"),
        &90,
        &f.zero_hash(),
    );
    drop_versioned_verdict(&f, id);

    assert_eq!(f.client().get_verdict(&id).side, WinnerSide::Creator);
    let escrow_before = f.escrow_balance();
    let err = f
        .client()
        .try_claim_challenger_payout(&challenger, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ChallengersDidNotWin);
    assert_eq!(f.escrow_balance(), escrow_before);
}

/// A pull that already settled before the upgrade cannot settle twice after
/// it, so the upgrade never double-pays a legacy claim.
#[test]
fn legacy_pull_is_not_replayable_after_upgrade() {
    let f = Fixture::new(0, 0);
    let creator = f.user(20 * USDC);
    let challenger = f.user(10 * USDC);
    let id = f.client().create_claim(&creator, &f.params(10 * USDC));
    f.client()
        .challenge_claim(&challenger, &id, &(10 * USDC), &None);

    f.advance_by(3_600);
    f.client().resolve_claim(
        &id,
        &WinnerSide::Challengers,
        &f.str("challengers"),
        &90,
        &f.zero_hash(),
    );
    drop_versioned_verdict(&f, id);

    assert_eq!(
        f.client().claim_challenger_payout(&challenger, &id),
        20 * USDC
    );
    let err = f
        .client()
        .try_claim_challenger_payout(&challenger, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::AlreadyClaimedPayout);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(f.client().get_claim(&id).remaining_escrow, 0);
}

/// An unresolved claim was not pull-eligible before the upgrade and is not
/// pull-eligible after it: migration must not create a payout obligation.
#[test]
fn legacy_unresolved_claim_keeps_pull_refused() {
    let f = Fixture::new(0, 0);
    let creator = f.user(20 * USDC);
    let challenger = f.user(10 * USDC);
    let id = f.client().create_claim(&creator, &f.params(10 * USDC));
    f.client()
        .challenge_claim(&challenger, &id, &(10 * USDC), &None);

    let err = f
        .client()
        .try_claim_challenger_payout(&challenger, &id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ClaimNotResolved);
    assert_eq!(f.escrow_balance(), 20 * USDC);
}
