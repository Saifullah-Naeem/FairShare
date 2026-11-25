"""Comprehensive unittest suite for FairShare Ledger Python + SQLite reference."""

from __future__ import annotations

from datetime import datetime, timezone
import secrets
import sqlite3
import unittest

from fairshare.db import (
    act_on_settlement,
    claim_shadow_member,
    connect,
    create_expense,
    create_settlement,
    dispatch_batched_reminders,
    hash_password,
    invite_shadow_member,
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


def _create_test_fixture(
    conn: sqlite3.Connection, verification: DevMockVerificationProvider
) -> dict[str, int | str]:
    ts = datetime.now(timezone.utc).isoformat()
    pw = hash_password(secrets.token_urlsafe(16))
    with conn:
        hamza_u = int(
            conn.execute(
                "INSERT INTO users (name, handle, password_hash, is_shadow, claimed_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                ("Hamza Tariq", "hamza", pw, ts, ts),
            ).lastrowid
        )
        ayesha_u = int(
            conn.execute(
                "INSERT INTO users (name, handle, password_hash, is_shadow, claimed_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                ("Ayesha Khan", "ayesha", pw, ts, ts),
            ).lastrowid
        )
        saad_u = int(
            conn.execute(
                "INSERT INTO users (name, handle, password_hash, is_shadow, claimed_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
                ("Saad Mahmood", "saad", pw, ts, ts),
            ).lastrowid
        )
        group_id = int(
            conn.execute(
                "INSERT INTO groups (name, currency_code, quiet_hours_start, quiet_hours_end, reminder_cooldown_hours, created_by_user_id, created_at) VALUES (?, 'PKR', 22, 8, 12, ?, ?)",
                ("Hostel Wing B", hamza_u, ts),
            ).lastrowid
        )
        hamza_m = int(
            conn.execute(
                "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'HOST', ?)",
                (group_id, hamza_u, ts),
            ).lastrowid
        )
        ayesha_m = int(
            conn.execute(
                "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'ADMIN', ?)",
                (group_id, ayesha_u, ts),
            ).lastrowid
        )
        saad_m = int(
            conn.execute(
                "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)",
                (group_id, saad_u, ts),
            ).lastrowid
        )

    bilal_m, bilal_token = invite_shadow_member(conn, hamza_m, "Bilal Ahmed", verification)
    create_expense(
        conn,
        hamza_m,
        hamza_m,
        "PTCL Fiber Wi-Fi Monthly Bill",
        "Bills",
        450000,
        "EQUAL",
        participant_member_ids=[hamza_m, ayesha_m, saad_m, bilal_m],
    )
    return {
        "group_id": group_id,
        "host_member_id": hamza_m,
        "admin_member_id": ayesha_m,
        "member_id": saad_m,
        "shadow_member_id": bilal_m,
        "shadow_token": bilal_token,
    }


class FairShareLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = connect(":memory:")
        self.verification = DevMockVerificationProvider()
        self.seed = _create_test_fixture(self.conn, self.verification)

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

        claimed_id = claim_shadow_member(
            self.conn, token, "bilal_hostel", secrets.token_urlsafe(12)
        )
        self.assertEqual(claimed_id, shadow_id)

        user_row = self.conn.execute(
            "SELECT is_shadow, handle, claim_token_hash FROM users WHERE handle = 'bilal_hostel'"
        ).fetchone()
        self.assertEqual(user_row["is_shadow"], 0)
        self.assertIsNone(user_row["claim_token_hash"])

        with self.assertRaises(ValueError):
            claim_shadow_member(
                self.conn, token, "attacker", secrets.token_urlsafe(12)
            )

    def test_partial_settlements_and_void_rules(self) -> None:
        host = int(self.seed["host_member_id"])
        member = int(self.seed["member_id"])

        st_id = create_settlement(self.conn, member, host, 50000, note="JazzCash partial")

        with self.assertRaises(PermissionError):
            act_on_settlement(self.conn, member, st_id, "CONFIRMED")

        exps = [dict(r) for r in self.conn.execute("SELECT * FROM expenses").fetchall()]
        sps = [dict(r) for r in self.conn.execute("SELECT * FROM expense_splits").fetchall()]
        sts = [dict(r) for r in self.conn.execute("SELECT * FROM settlements").fetchall()]
        m_ids = [r["id"] for r in self.conn.execute("SELECT id FROM group_members").fetchall()]
        before = compute_balances(m_ids, exps, sps, sts)
        self.assertEqual(before.net_balances[member], -112500)
        self.assertEqual(before.zero_sum_check, 0)

        act_on_settlement(self.conn, host, st_id, "CONFIRMED")
        sts_after = [dict(r) for r in self.conn.execute("SELECT * FROM settlements").fetchall()]
        after = compute_balances(m_ids, exps, sps, sts_after)
        self.assertEqual(after.net_balances[member], -62500)
        self.assertEqual(after.zero_sum_check, 0)

        exp_id = exps[0]["id"]
        with self.assertRaises(PermissionError):
            void_expense(self.conn, member, exp_id, "Trying unauthorized void")
        void_expense(self.conn, host, exp_id, "Billed next month instead")
        voided_row = self.conn.execute(
            "SELECT status, void_reason FROM expenses WHERE id = ?", (exp_id,)
        ).fetchone()
        self.assertEqual(voided_row["status"], "VOIDED")

    def test_non_spam_reminders_and_production_stub(self) -> None:
        host = int(self.seed["host_member_id"])
        group_id = int(self.seed["group_id"])

        suppressed = dispatch_batched_reminders(
            self.conn, group_id, host, self.verification, override_hour=23
        )
        self.assertTrue(all(r["status"] == "SUPPRESSED" for r in suppressed))

        sent = dispatch_batched_reminders(
            self.conn, group_id, host, self.verification, override_hour=14
        )
        self.assertTrue(any(r["status"] == "SENT" for r in sent))
        repeat = dispatch_batched_reminders(
            self.conn, group_id, host, self.verification, override_hour=14
        )
        self.assertTrue(all(r["status"] == "SUPPRESSED" for r in repeat))

        stub = ProductionStubVerificationProvider()
        with self.assertRaises(NotImplementedError):
            invite_shadow_member(self.conn, host, "Zain", stub)


if __name__ == "__main__":
    unittest.main()
