#![cfg(test)]
//! Migration compatibility report for live squad pools.
//!
//! A contract upgrade swaps the wasm behind the same contract id: persistent
//! `Market`, `Deposit` and `Claimed` entries survive, so settlement must keep
//! paying exactly what it owed before the upgrade. These tests build synthetic
//! pools in each live state, snapshot the pre-upgrade liability, then replay
//! the post-upgrade reads and pulls against the same state.
//!
//! Fixtures are synthetic: no live deployment, credentials or funded state is
//! touched.

extern crate std;

use crate::test_common::{Fixture, DEFAULT_DURATION, USDC};
use crate::types::{
    Error, PoolMigrationState, MIGRATION_REPORT_VERSION, RESULT_CANCELLED, SIDE_A, SIDE_B,
};

#[test]
fn unresolved_pool_reports_every_deposit_as_outstanding_liability() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let a = f.user(10 * USDC);
    let b = f.user(4 * USDC);
    f.client().deposit(&a, &id, &SIDE_A, &(10 * USDC));
    f.client().deposit(&b, &id, &SIDE_B, &(4 * USDC));

    let market_before = f.client().get_market(&id);
    let report = f.client().get_migration_report(&id);

    assert_eq!(report.version, MIGRATION_REPORT_VERSION);
    assert_eq!(report.market_id, id);
    assert_eq!(report.state, PoolMigrationState::Unresolved);
    assert!(!report.resolved);
    assert_eq!(report.outstanding_user_liability, 14 * USDC);
    assert_eq!(report.pool_a, 10 * USDC);
    assert_eq!(report.pool_b, 4 * USDC);
    assert!(report.compatible);

    // The report is read-only: the stored market is byte-for-byte unchanged.
    assert_eq!(f.client().get_market(&id), market_before);

    // After the upgrade the same liabilities are still payable: a pre-deadline
    // withdrawal pays exactly the amount the report attributed to that side.
    f.client()
        .withdraw_before_deadline(&a, &id, &SIDE_A, &(10 * USDC));
    assert_eq!(f.escrow_balance(), 4 * USDC);
    let after = f.client().get_migration_report(&id);
    assert_eq!(after.state, PoolMigrationState::Unresolved);
    assert_eq!(after.outstanding_user_liability, 4 * USDC);
    assert!(after.compatible);
}

#[test]
fn cancelled_pool_preserves_unclaimed_refunds() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 1_000); // fee must not be charged on a refund

    let a = f.user(10 * USDC);
    let b = f.user(7 * USDC);
    f.client().deposit(&a, &id, &SIDE_A, &(10 * USDC));
    f.client().deposit(&b, &id, &SIDE_B, &(7 * USDC));

    f.client().cancel_market(&id);

    let before = f.client().get_migration_report(&id);
    assert_eq!(before.state, PoolMigrationState::Cancelled);
    assert_eq!(before.result, RESULT_CANCELLED);
    assert_eq!(before.outstanding_user_liability, 17 * USDC);
    assert!(before.compatible);

    // Every preview still promises exactly the unclaimed deposit, with no fee.
    let preview_a = f.client().preview_claim(&id, &SIDE_A, &a);
    let preview_b = f.client().preview_claim(&id, &SIDE_B, &b);
    assert_eq!(preview_a.net, 10 * USDC);
    assert_eq!(preview_b.net, 7 * USDC);
    assert_eq!(
        preview_a.net + preview_b.net,
        before.outstanding_user_liability
    );

    assert_eq!(f.client().claim(&a, &id, &SIDE_A), 10 * USDC);
    assert_eq!(f.client().claim(&b, &id, &SIDE_B), 7 * USDC);

    let after = f.client().get_migration_report(&id);
    assert_eq!(after.state, PoolMigrationState::Settled);
    assert_eq!(after.outstanding_user_liability, 0);
    assert_eq!(f.escrow_balance(), 0);
    assert_eq!(f.client().get_accrued_fees(), 0);
}

#[test]
fn partially_claimed_pool_retains_exact_liability_for_remaining_winners() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 250);

    let stakes = [3 * USDC, 5 * USDC, 7 * USDC];
    let mut winners = std::vec::Vec::new();
    for stake in stakes {
        let who = f.user(stake);
        f.client().deposit(&who, &id, &SIDE_A, &stake);
        winners.push(who);
    }
    let loser = f.user(11 * USDC);
    f.client().deposit(&loser, &id, &SIDE_B, &(11 * USDC));

    f.advance_by(DEFAULT_DURATION);
    f.client().resolve(&id, &SIDE_A);

    let pre_upgrade = f.client().get_migration_report(&id);
    assert_eq!(pre_upgrade.state, PoolMigrationState::PartiallyClaimed);
    assert_eq!(pre_upgrade.outstanding_user_liability, 26 * USDC);
    assert_eq!(pre_upgrade.winner_claims, 0);

    // One winner pulls. The liability drops by that claim's GROSS (the fee is
    // accrued separately and the winner receives gross minus fee).
    let first_preview = f.client().preview_claim(&id, &SIDE_A, &winners[0]);
    f.client().claim(&winners[0], &id, &SIDE_A);

    let post_upgrade = f.client().get_migration_report(&id);
    assert_eq!(post_upgrade.state, PoolMigrationState::PartiallyClaimed);
    assert_eq!(post_upgrade.winner_claims, 1);
    assert_eq!(
        post_upgrade.outstanding_user_liability,
        pre_upgrade.outstanding_user_liability - first_preview.gross
    );

    // Every remaining winner can still preview and pull exactly what the
    // post-upgrade liability accounts for.
    let second = f.client().preview_claim(&id, &SIDE_A, &winners[1]);
    f.client().claim(&winners[1], &id, &SIDE_A);

    let after_second = f.client().get_migration_report(&id);
    assert_eq!(
        after_second.outstanding_user_liability,
        post_upgrade.outstanding_user_liability - second.gross
    );

    // The final claimant's preview is the residual escrow, no dust stranded.
    let third = f.client().preview_claim(&id, &SIDE_A, &winners[2]);
    assert_eq!(third.gross, after_second.outstanding_user_liability);
    f.client().claim(&winners[2], &id, &SIDE_A);

    let settled = f.client().get_migration_report(&id);
    assert_eq!(settled.state, PoolMigrationState::Settled);
    assert_eq!(settled.outstanding_user_liability, 0);
    assert_eq!(f.escrow_balance(), f.client().get_accrued_fees());
}

#[test]
fn unknown_market_is_refused() {
    let f = Fixture::new();
    let err = f
        .client()
        .try_get_migration_report(&42)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotFound);
}

#[test]
fn boundary_insolvent_pool_is_reported_incompatible_instead_of_migrating_blindly() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let a = f.user(10 * USDC);
    f.client().deposit(&a, &id, &SIDE_A, &(10 * USDC));

    // Emulate a corrupt/legacy entry whose escrow claim exceeds the pool total.
    let mut market = f.client().get_market(&id);
    market.resolved = true;
    market.result = SIDE_A;
    market.remaining_escrow = market.pool_a + market.pool_b + 1;
    f.env.as_contract(&f.contract_id, || {
        crate::storage::set_market(&f.env, id, &market);
    });

    // The report still describes the pool, but flags it as incompatible rather
    // than claiming a liability it cannot back.
    let report = f.client().get_migration_report(&id);
    assert!(!report.compatible);
    assert_eq!(report.outstanding_user_liability, market.remaining_escrow);
    assert_eq!(report.remaining_escrow, market.remaining_escrow);
}
