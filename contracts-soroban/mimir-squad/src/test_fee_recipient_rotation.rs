#![cfg(test)]
//! Timelocked fee-recipient rotation for the squad pool.
//!
//! The current fee recipient authorizes a rotation, the change is held for
//! `FEE_RECIPIENT_TIMELOCK_SECONDS`, and only then can it be executed. Accrued
//! but unclaimed fees follow the recipient address.

extern crate std;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use crate::test_common::{Fixture, USDC};
use crate::types::{Error, FEE_RECIPIENT_TIMELOCK_SECONDS, SIDE_A, SIDE_B};

#[test]
fn queueing_a_rotation_keeps_the_current_recipient_until_execution() {
    let f = Fixture::new();
    let next = Address::generate(&f.env);
    let previous = f.client().get_fee_recipient();

    f.client().queue_fee_recipient(&next);
    let queued = f.client().get_pending_fee_recipient().unwrap();
    assert_eq!(queued, next);
    assert_eq!(f.client().get_fee_recipient(), previous);

    f.advance_by(FEE_RECIPIENT_TIMELOCK_SECONDS - 1);
    assert_eq!(
        f.client().try_execute_fee_recipient(),
        Err(Ok(Error::Timelocked))
    );
    assert_eq!(f.client().get_fee_recipient(), previous);

    f.advance_by(1);
    f.client().execute_fee_recipient();
    assert_eq!(f.client().get_fee_recipient(), next);
    assert!(f.client().get_pending_fee_recipient().is_none());
}

#[test]
fn cancelling_a_rotation_clears_the_queue() {
    let f = Fixture::new();
    let next = Address::generate(&f.env);

    f.client().queue_fee_recipient(&next);
    f.client().cancel_fee_recipient();
    assert!(f.client().get_pending_fee_recipient().is_none());
    assert_eq!(f.client().get_fee_recipient(), f.fee_recipient);

    f.advance_by(FEE_RECIPIENT_TIMELOCK_SECONDS);
    assert_eq!(
        f.client().try_execute_fee_recipient(),
        Err(Ok(Error::NoFeeRecipientQueued))
    );
}

#[test]
fn executing_or_cancelling_without_a_queued_rotation_is_rejected() {
    let f = Fixture::new();

    assert!(f.client().get_pending_fee_recipient().is_none());
    assert_eq!(
        f.client().try_cancel_fee_recipient(),
        Err(Ok(Error::NoFeeRecipientQueued))
    );
    assert_eq!(
        f.client().try_execute_fee_recipient(),
        Err(Ok(Error::NoFeeRecipientQueued))
    );
}

#[test]
fn accrued_fees_pay_the_rotated_recipient() {
    let f = Fixture::new();
    let captain = f.user(0);
    let id = f.market(&captain, 1_000);

    let winner = f.user(10 * USDC);
    let loser = f.user(10 * USDC);
    f.client().deposit(&winner, &id, &SIDE_A, &(10 * USDC));
    f.client().deposit(&loser, &id, &SIDE_B, &(10 * USDC));

    f.advance_by(crate::test_common::DEFAULT_DURATION);
    f.client().resolve(&id, &SIDE_A);
    f.client().claim(&winner, &id, &SIDE_A);

    let accrued = f.client().get_accrued_fees();
    assert!(accrued > 0);

    let next = Address::generate(&f.env);
    f.client().queue_fee_recipient(&next);
    f.advance_by(FEE_RECIPIENT_TIMELOCK_SECONDS);
    f.client().execute_fee_recipient();

    let before = f.token().balance(&next);
    let paid = f.client().claim_fees();
    assert_eq!(paid, accrued);
    assert_eq!(f.token().balance(&next) - before, accrued);
}
