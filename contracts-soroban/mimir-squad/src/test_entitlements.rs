#![cfg(test)]
//! Paginated squad participant entitlements — `get_entitlements_page`.
//!
//! Coverage
//!
//! positive     – unresolved and resolved markets, both sides, exact amounts
//! pagination   – page tiling, partial last page, deterministic continuation
//! negative     – unknown market, losing side, already-claimed position
//! boundary     – offset beyond the roster, `limit` above the page cap
//! conservation – the view moves no funds and matches `preview_claim` exactly
//! regression   – a full withdrawal removes the position from the roster

extern crate std;

use soroban_sdk::Address;

use crate::test_common::{Fixture, DEFAULT_DURATION, USDC};
use crate::types::{
    Error, ParticipantEntitlement, MAX_ENTITLEMENT_PAGE, SIDE_A, SIDE_B,
};

/// The record for `who`, or panic with a useful message.
fn record_for(
    page: &crate::types::EntitlementPage,
    who: &Address,
) -> ParticipantEntitlement {
    for item in page.items.iter() {
        if item.participant == *who {
            return item;
        }
    }
    panic!("participant missing from the entitlement page");
}

#[test]
fn unresolved_market_reports_principal_without_a_payout() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);
    let participant = f.user(2 * USDC);
    f.client().deposit(&participant, &id, &SIDE_A, &(2 * USDC));

    let page = f.client().get_entitlements_page(&id, &0, &0);

    assert_eq!(page.total, 1);
    assert_eq!(page.offset, 0);
    let record = record_for(&page, &participant);
    assert_eq!(record.side, SIDE_A);
    assert_eq!(record.principal, 2 * USDC);
    assert_eq!(record.gross, 0);
    assert_eq!(record.fee, 0);
    assert_eq!(record.net, 0);
    assert!(!record.claimed);

    // Read-only: the deposit is untouched in escrow and nothing was paid out.
    assert_eq!(f.escrow_balance(), 2 * USDC);
    assert_eq!(f.token().balance(&participant), 0);
    assert_eq!(f.client().get_accrued_fees(), 0);
}

#[test]
fn resolved_market_reports_the_exact_claim_amounts() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 800); // 8% fee on profit

    let mut winners = std::vec::Vec::new();
    for stake in [1 * USDC, 3 * USDC, 7 * USDC] {
        let who = f.user(stake);
        f.client().deposit(&who, &id, &SIDE_A, &stake);
        winners.push(who);
    }
    let mut losers = std::vec::Vec::new();
    for stake in [5 * USDC, 11 * USDC] {
        let who = f.user(stake);
        f.client().deposit(&who, &id, &SIDE_B, &stake);
        losers.push(who);
    }

    f.advance_by(DEFAULT_DURATION);
    f.client().resolve(&id, &SIDE_A);

    let escrow_before = f.escrow_balance();
    let fees_before = f.client().get_accrued_fees();
    let page = f.client().get_entitlements_page(&id, &0, &0);
    assert_eq!(page.total, 5);

    let mut gross_total = 0i128;
    let mut net_total = 0i128;
    let mut fee_total = 0i128;
    for winner in winners.iter() {
        let record = record_for(&page, winner);
        let preview = f.client().preview_claim(&id, &SIDE_A, winner);
        assert_eq!(record.principal, f.client().get_deposit(&id, &SIDE_A, winner));
        assert_eq!(record.gross, preview.gross);
        assert_eq!(record.fee, preview.fee);
        assert_eq!(record.net, preview.net);
        assert_eq!(record.net, record.gross - record.fee);
        assert!(!record.claimed);
        gross_total += record.gross;
        net_total += record.net;
        fee_total += record.fee;
    }
    for loser in losers.iter() {
        let record = record_for(&page, loser);
        assert_eq!(record.side, SIDE_B);
        assert_eq!(record.gross, 0);
        assert_eq!(record.fee, 0);
        assert_eq!(record.net, 0);
    }

    // Every atomic unit is accounted for: the winners' gross payouts are the
    // combined pools, the fee comes out of that gross, and the losers get
    // nothing. Each record previews independently, so the last-claimant dust
    // (strictly less than the number of winners) is only assigned at claim
    // time; it is never lost.
    let market = f.client().get_market(&id);
    let total = market.pool_a + market.pool_b;
    assert!(gross_total <= total);
    assert!(total - gross_total < winners.len() as i128);
    assert_eq!(net_total + fee_total, gross_total);

    // Reading the page moved nothing.
    assert_eq!(f.escrow_balance(), escrow_before);
    assert_eq!(f.client().get_accrued_fees(), fees_before);
    assert_eq!(f.client().get_market(&id).remaining_escrow, escrow_before);
}

#[test]
fn pages_tile_the_roster_exactly_once_in_side_order() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let mut side_a = std::vec::Vec::new();
    for _ in 0..3 {
        let who = f.user(USDC);
        f.client().deposit(&who, &id, &SIDE_A, &USDC);
        side_a.push(who);
    }
    let mut side_b = std::vec::Vec::new();
    for _ in 0..2 {
        let who = f.user(USDC);
        f.client().deposit(&who, &id, &SIDE_B, &USDC);
        side_b.push(who);
    }

    let first = f.client().get_entitlements_page(&id, &0, &2);
    assert_eq!(first.total, 5);
    assert_eq!(first.offset, 0);
    assert_eq!(first.items.len(), 2);

    let second = f.client().get_entitlements_page(&id, &2, &2);
    assert_eq!(second.total, 5);
    assert_eq!(second.offset, 2);
    assert_eq!(second.items.len(), 2);

    let third = f.client().get_entitlements_page(&id, &4, &2);
    assert_eq!(third.total, 5);
    assert_eq!(third.offset, 4);
    assert_eq!(third.items.len(), 1);

    let mut seen = std::vec::Vec::new();
    for page in [&first, &second, &third] {
        for item in page.items.iter() {
            seen.push(item.participant.clone());
        }
    }
    assert_eq!(seen.len(), 5, "each participant appears exactly once");

    let expected: std::vec::Vec<Address> = side_a
        .iter()
        .chain(side_b.iter())
        .cloned()
        .collect();
    assert_eq!(seen, expected, "order is SIDE_A then SIDE_B, deposit order");
}

#[test]
fn the_same_cursor_returns_the_same_page() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);
    for _ in 0..4 {
        let who = f.user(USDC);
        f.client().deposit(&who, &id, &SIDE_A, &USDC);
    }

    let first = f.client().get_entitlements_page(&id, &1, &2);
    let again = f.client().get_entitlements_page(&id, &1, &2);
    assert_eq!(first, again);
}

#[test]
fn offset_beyond_the_roster_returns_an_empty_page_with_the_total() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);
    let who = f.user(USDC);
    f.client().deposit(&who, &id, &SIDE_A, &USDC);

    let page = f.client().get_entitlements_page(&id, &100, &10);
    assert_eq!(page.total, 1);
    assert_eq!(page.offset, 1, "offset is clamped to the roster length");
    assert_eq!(page.items.len(), 0);
}

#[test]
fn a_limit_above_the_page_cap_is_rejected() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);
    let who = f.user(USDC);
    f.client().deposit(&who, &id, &SIDE_A, &USDC);

    let err = f
        .client()
        .try_get_entitlements_page(&id, &0, &(MAX_ENTITLEMENT_PAGE + 1))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::PageTooLarge);

    // The cap itself is accepted.
    let page = f.client().get_entitlements_page(&id, &0, &MAX_ENTITLEMENT_PAGE);
    assert_eq!(page.items.len(), 1);
}

#[test]
fn unknown_market_is_an_explicit_error() {
    let f = Fixture::new();
    let err = f
        .client()
        .try_get_entitlements_page(&999, &0, &10)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotFound);
}

#[test]
fn a_claimed_position_reports_zero_and_pays_nothing_else() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let first = f.user(USDC);
    let second = f.user(USDC);
    f.client().deposit(&first, &id, &SIDE_A, &USDC);
    f.client().deposit(&second, &id, &SIDE_A, &USDC);
    let loser = f.user(2 * USDC);
    f.client().deposit(&loser, &id, &SIDE_B, &(2 * USDC));

    f.advance_by(DEFAULT_DURATION);
    f.client().resolve(&id, &SIDE_A);

    let before_claim = f.client().get_entitlements_page(&id, &0, &0);
    let expected_first = record_for(&before_claim, &first).net;
    let expected_second = record_for(&before_claim, &second).net;
    assert!(expected_first > 0 && expected_second > 0);

    assert_eq!(f.client().claim(&first, &id, &SIDE_A), expected_first);

    let after_claim = f.client().get_entitlements_page(&id, &0, &0);
    let claimed = record_for(&after_claim, &first);
    assert!(claimed.claimed);
    assert_eq!(claimed.gross, 0);
    assert_eq!(claimed.fee, 0);
    assert_eq!(claimed.net, 0);
    assert_eq!(claimed.principal, USDC, "principal history is preserved");

    let outstanding = record_for(&after_claim, &second);
    assert!(!outstanding.claimed);
    assert_eq!(outstanding.net, expected_second);
    assert_eq!(
        f.token().balance(&second),
        0,
        "reading entitlements must not pay the outstanding winner"
    );
}

#[test]
fn a_full_withdrawal_removes_the_position_from_the_roster() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let leaving = f.user(2 * USDC);
    let staying = f.user(2 * USDC);
    f.client().deposit(&leaving, &id, &SIDE_A, &(2 * USDC));
    f.client().deposit(&staying, &id, &SIDE_A, &(2 * USDC));

    f.client()
        .withdraw_before_deadline(&leaving, &id, &SIDE_A, &(2 * USDC));

    let page = f.client().get_entitlements_page(&id, &0, &0);
    assert_eq!(page.total, 1);
    let record = record_for(&page, &staying);
    assert_eq!(record.principal, 2 * USDC);

    // A partial withdrawal keeps the position and reports the reduced stake.
    f.client()
        .withdraw_before_deadline(&staying, &id, &SIDE_A, &USDC);
    let page = f.client().get_entitlements_page(&id, &0, &0);
    assert_eq!(page.total, 1);
    assert_eq!(record_for(&page, &staying).principal, USDC);
}

#[test]
fn a_double_sided_depositor_appears_once_per_side() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 0);

    let both = f.user(5 * USDC);
    f.client().deposit(&both, &id, &SIDE_A, &(2 * USDC));
    f.client().deposit(&both, &id, &SIDE_B, &(3 * USDC));

    let page = f.client().get_entitlements_page(&id, &0, &0);
    assert_eq!(page.total, 2);

    let mut side_a_seen = false;
    let mut side_b_seen = false;
    for item in page.items.iter() {
        if item.participant != both {
            continue;
        }
        match item.side {
            SIDE_A => {
                side_a_seen = true;
                assert_eq!(item.principal, 2 * USDC);
            }
            SIDE_B => {
                side_b_seen = true;
                assert_eq!(item.principal, 3 * USDC);
            }
            _ => panic!("unexpected side in entitlement record"),
        }
    }
    assert!(side_a_seen && side_b_seen);
}
