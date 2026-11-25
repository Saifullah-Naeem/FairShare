"""Comprehensive unittest suite for FairShare Ledger Python + SQLite reference."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from fairshare.db import (
    act_on_settlement,
    claim_shadow_member,
    connect,
    create_expense,
    create_settlement,
    dispatch_batched_reminders,
    invite_shadow_member,
    seed_demo_data,
    void_expense,
)
from fairshare.ledger import (
    compute_balances,
    compute_equal_splits,
    evaluate_reminder_eligibility,
    format_paisa_to_pkr,
    parse_pkr_to_paisa,
    validate_custom_splits,
)
from fairshare.verification import DevMockVerificationProvider, ProductionStubVerificationProvider


class FairShareLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = connect(":memory:")
        self.verification = DevMockVerificationProvider()
        self.seed = seed_demo_data(self.conn, self.verification)

    def tearDown(self) -> None:
        self.conn.close()

    def test_exact_paisa_parsing_and_remainder_splits(self) -> None:
        self.assertEqual(parse_pkr_to_paisa("1,450.75"), 145075)
        self.assertEqual(parse_pkr_to_paisa("Rs. 500"), 50000)
        self.assertEqual(format_paisa_to_pkr(145075), "Rs. 1,450.75")

        splits = compute_equal_splits(10000, [3, 1, 2])
        self.assertEqual(sum(amt for _, amt in splits), 10000)
        self.assertEqual(splits, [(1, 3334), (2, 3333), (3, 3333)])

    def test_custom_splits_reject_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            validate_custom_splits(10000, [(1, 5000), (2, 4999)])

    def test_shadow_claim_preserves_splits_and_locks_takeovers(self) -> None:
        shadow_id = int(self.seed["shadow_member_id"])
        token = str(self.seed["shadow_token"])

        # Claim once succeeds and preserves member_id & past PTCL Wi-Fi split
        claimed_id = claim_shadow_member(self.conn, token, "bilal_hostel", "pass1234")
        self.assertEqual(claimed_id, shadow_id)

        user_row = self.conn.execute(
            "SELECT is_shadow, handle, claim_token_hash FROM users WHERE handle = 'bilal_hostel'"
        ).fetchone()
        self.assertEqual(user_row["is_shadow"], 0)
        self.assertIsNone(user_row["claim_token_hash"])

        # Takeover attempt with the same single-use token is rejected
        with self.assertRaises(ValueError):
            claim_shadow_member(self.conn, token, "attacker", "hack1234")

    def test_partial_settlements_and_void_rules(self) -> None:
        host = int(self.seed["host_member_id"])
        member = int(self.seed["member_id"])

        # Saad owes Hamza Rs. 1,125.00 (112,500 paisa) from seeded PTCL Wi-Fi (450,000 / 4)
        st_id = create_settlement(self.conn, member, host, 50000, note="JazzCash partial")

        # Sender cannot self-confirm
        with self.assertRaises(PermissionError):
            act_on_settlement(self.conn, member, st_id, "CONFIRMED")

        # Pending settlement does NOT reduce net balance yet
        exps = [dict(r) for r in self.conn.execute("SELECT * FROM expenses").fetchall()]
        sps = [dict(r) for r in self.conn.execute("SELECT * FROM expense_splits").fetchall()]
        sts = [dict(r) for r in self.conn.execute("SELECT * FROM settlements").fetchall()]
        m_ids = [r["id"] for r in self.conn.execute("SELECT id FROM group_members").fetchall()]
        before = compute_balances(m_ids, exps, sps, sts)
        self.assertEqual(before.net_balances[member], -112500)
        self.assertEqual(before.zero_sum_check, 0)

        # Host confirms -> balance drops from -112,500 to -62,500
        act_on_settlement(self.conn, host, st_id, "CONFIRMED")
        sts_after = [dict(r) for r in self.conn.execute("SELECT * FROM settlements").fetchall()]
        after = compute_balances(m_ids, exps, sps, sts_after)
        self.assertEqual(after.net_balances[member], -62500)
        self.assertEqual(after.zero_sum_check, 0)

        # Member cannot void Host's expense, Host can void with reason, stays visible in DB
        exp_id = exps[0]["id"]
        with self.assertRaises(PermissionError):
            void_expense(self.conn, member, exp_id, "Trying unauthorized void")
        void_expense(self.conn, host, exp_id, "Billed next month instead")
        voided_row = self.conn.execute("SELECT status, void_reason FROM expenses WHERE id = ?", (exp_id,)).fetchone()
        self.assertEqual(voided_row["status"], "VOIDED")

    def test_non_spam_reminders_and_production_stub(self) -> None:
        host = int(self.seed["host_member_id"])
        group_id = int(self.seed["group_id"])

        # Quiet hours 22:00-08:00 suppress at 23:00
        suppressed = dispatch_batched_reminders(self.conn, group_id, host, self.verification, override_hour=23)
        self.assertTrue(all(r["status"] == "SUPPRESSED" for r in suppressed))

        # Daytime 14:00 dispatches once, immediate repeat hits cooldown
        sent = dispatch_batched_reminders(self.conn, group_id, host, self.verification, override_hour=14)
        self.assertTrue(any(r["status"] == "SENT" for r in sent))
        repeat = dispatch_batched_reminders(self.conn, group_id, host, self.verification, override_hour=14)
        self.assertTrue(all(r["status"] == "SUPPRESSED" for r in repeat))

        # Production stub rejects live SMS/email calls cleanly
        stub = ProductionStubVerificationProvider()
        with self.assertRaises(NotImplementedError):
            invite_shadow_member(self.conn, host, "Zain", stub)


if __name__ == "__main__":
    unittest.main()
