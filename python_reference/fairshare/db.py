"""SQLite persistence layer (7 core tables), role checks, shadow claims, and demo seeder."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
import sqlite3
from typing import Dict, List, Optional, Tuple

from .ledger import (
    compute_balances,
    compute_equal_splits,
    evaluate_reminder_eligibility,
    format_paisa_to_pkr,
    validate_custom_splits,
)
from .verification import VerificationProvider


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  handle TEXT UNIQUE,
  password_hash TEXT,
  is_shadow INTEGER NOT NULL DEFAULT 0 CHECK (is_shadow IN (0, 1)),
  claim_token_hash TEXT,
  claim_token_expires_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'PKR',
  quiet_hours_start INTEGER NOT NULL DEFAULT 22 CHECK (quiet_hours_start BETWEEN 0 AND 23),
  quiet_hours_end INTEGER NOT NULL DEFAULT 8 CHECK (quiet_hours_end BETWEEN 0 AND 23),
  reminder_cooldown_hours INTEGER NOT NULL DEFAULT 12 CHECK (reminder_cooldown_hours BETWEEN 1 AND 168),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('HOST', 'ADMIN', 'MEMBER')),
  snoozed_until TEXT,
  last_reminded_at TEXT,
  joined_at TEXT NOT NULL,
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  paid_by_member_id INTEGER NOT NULL REFERENCES group_members(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor > 0),
  split_mode TEXT NOT NULL CHECK (split_mode IN ('EQUAL', 'CUSTOM')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOIDED')),
  void_reason TEXT,
  voided_by_member_id INTEGER REFERENCES group_members(id),
  receipt_path TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES group_members(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  UNIQUE (expense_id, member_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_member_id INTEGER NOT NULL REFERENCES group_members(id),
  to_member_id INTEGER NOT NULL REFERENCES group_members(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION' CHECK (
    status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'CANCELLED')
  ),
  note TEXT,
  receipt_path TEXT,
  rejection_reason TEXT,
  acted_by_member_id INTEGER REFERENCES group_members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (from_member_id != to_member_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_member_id INTEGER REFERENCES group_members(id),
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
"""


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return f"{salt.hex()}:{derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    salt_hex, key_hex = stored_hash.split(":", 1)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=bytes.fromhex(salt_hex),
        n=16384,
        r=8,
        p=1,
    )
    return hmac.compare_digest(derived, bytes.fromhex(key_hex))


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA_SQL)
    return conn


def append_audit(
    conn: sqlite3.Connection,
    group_id: int,
    actor_member_id: Optional[int],
    action_type: str,
    entity_type: str,
    entity_id: Optional[int],
    payload: Dict,
    created_at: Optional[str] = None,
) -> None:
    ts = created_at or datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO audit_logs (group_id, actor_member_id, action_type, entity_type, entity_id, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (group_id, actor_member_id, action_type, entity_type, entity_id, json.dumps(payload), ts),
    )


def get_member_role(conn: sqlite3.Connection, member_id: int) -> Tuple[int, str, int]:
    row = conn.execute(
        """SELECT gm.group_id, gm.role, u.is_shadow
           FROM group_members gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.id = ?""",
        (member_id,),
    ).fetchone()
    if not row:
        raise ValueError("Member not found.")
    return int(row["group_id"]), str(row["role"]), int(row["is_shadow"])


def create_expense(
    conn: sqlite3.Connection,
    actor_member_id: int,
    paid_by_member_id: int,
    title: str,
    category: str,
    total_minor: int,
    split_mode: str,
    participant_member_ids: Optional[List[int]] = None,
    custom_splits: Optional[List[Tuple[int, int]]] = None,
) -> int:
    group_id, _, actor_shadow = get_member_role(conn, actor_member_id)
    if actor_shadow:
        raise PermissionError("Unclaimed shadow members cannot log expenses.")
    if split_mode == "EQUAL":
        splits = compute_equal_splits(total_minor, participant_member_ids or [])
    elif split_mode == "CUSTOM":
        splits = validate_custom_splits(total_minor, custom_splits or [])
    else:
        raise ValueError("split_mode must be EQUAL or CUSTOM.")

    now = datetime.now(timezone.utc).isoformat()
    with conn:
        cur = conn.execute(
            """INSERT INTO expenses (group_id, paid_by_member_id, title, category, total_minor, split_mode, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)""",
            (group_id, paid_by_member_id, title, category, total_minor, split_mode, now),
        )
        expense_id = int(cur.lastrowid)
        for member_id, amt in splits:
            conn.execute(
                "INSERT INTO expense_splits (expense_id, member_id, amount_minor) VALUES (?, ?, ?)",
                (expense_id, member_id, amt),
            )
        append_audit(
            conn,
            group_id,
            actor_member_id,
            "EXPENSE_CREATED",
            "EXPENSE",
            expense_id,
            {"title": title, "total_minor": total_minor, "split_mode": split_mode},
            now,
        )
    return expense_id


def void_expense(
    conn: sqlite3.Connection, actor_member_id: int, expense_id: int, reason: str
) -> None:
    if len(reason.strip()) < 3:
        raise ValueError("Void reason is required.")
    group_id, role, _ = get_member_role(conn, actor_member_id)
    exp = conn.execute(
        "SELECT id, paid_by_member_id, status FROM expenses WHERE id = ? AND group_id = ?",
        (expense_id, group_id),
    ).fetchone()
    if not exp:
        raise ValueError("Expense not found.")
    if exp["status"] == "VOIDED":
        raise ValueError("Expense is already voided.")
    if role not in ("HOST", "ADMIN") and int(exp["paid_by_member_id"]) != actor_member_id:
        raise PermissionError("Only payer, ADMIN, or HOST can void this expense.")

    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            "UPDATE expenses SET status = 'VOIDED', void_reason = ?, voided_by_member_id = ? WHERE id = ?",
            (reason.strip(), actor_member_id, expense_id),
        )
        append_audit(
            conn,
            group_id,
            actor_member_id,
            "EXPENSE_VOIDED",
            "EXPENSE",
            expense_id,
            {"reason": reason.strip()},
            now,
        )


def create_settlement(
    conn: sqlite3.Connection,
    from_member_id: int,
    to_member_id: int,
    amount_minor: int,
    note: Optional[str] = None,
) -> int:
    if amount_minor <= 0:
        raise ValueError("Settlement amount must be positive.")
    group_id, _, _ = get_member_role(conn, from_member_id)
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        cur = conn.execute(
            """INSERT INTO settlements (group_id, from_member_id, to_member_id, amount_minor, status, note, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'PENDING_CONFIRMATION', ?, ?, ?)""",
            (group_id, from_member_id, to_member_id, amount_minor, note, now, now),
        )
        st_id = int(cur.lastrowid)
        append_audit(
            conn,
            group_id,
            from_member_id,
            "SETTLEMENT_CREATED",
            "SETTLEMENT",
            st_id,
            {"from_member_id": from_member_id, "to_member_id": to_member_id, "amount_minor": amount_minor},
            now,
        )
    return st_id


def act_on_settlement(
    conn: sqlite3.Connection,
    actor_member_id: int,
    settlement_id: int,
    action: str,
    reason: Optional[str] = None,
) -> None:
    group_id, role, _ = get_member_role(conn, actor_member_id)
    st = conn.execute(
        "SELECT * FROM settlements WHERE id = ? AND group_id = ?",
        (settlement_id, group_id),
    ).fetchone()
    if not st:
        raise ValueError("Settlement not found.")
    if st["status"] != "PENDING_CONFIRMATION":
        raise ValueError(f"Settlement is already {st['status']}.")

    if action in ("CONFIRMED", "REJECTED"):
        if int(st["from_member_id"]) == actor_member_id and role == "MEMBER":
            raise PermissionError("Sender cannot confirm or reject their own payment.")
        if int(st["to_member_id"]) != actor_member_id and role not in ("HOST", "ADMIN"):
            raise PermissionError("Only recipient, ADMIN, or HOST can confirm or reject.")
        if action == "REJECTED" and (not reason or len(reason.strip()) < 3):
            raise ValueError("Rejection reason is required.")
    elif action == "CANCELLED":
        if int(st["from_member_id"]) != actor_member_id and role not in ("HOST", "ADMIN"):
            raise PermissionError("Only sender, ADMIN, or HOST can cancel.")
    else:
        raise ValueError("Unsupported settlement action.")

    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """UPDATE settlements
               SET status = ?, rejection_reason = ?, acted_by_member_id = ?, updated_at = ?
               WHERE id = ?""",
            (action, reason.strip() if reason else None, actor_member_id, now, settlement_id),
        )
        append_audit(
            conn,
            group_id,
            actor_member_id,
            f"SETTLEMENT_{action}",
            "SETTLEMENT",
            settlement_id,
            {"reason": reason} if reason else {},
            now,
        )


def invite_shadow_member(
    conn: sqlite3.Connection,
    actor_member_id: int,
    name: str,
    verification: VerificationProvider,
) -> Tuple[int, str]:
    group_id, role, _ = get_member_role(conn, actor_member_id)
    if role not in ("HOST", "ADMIN"):
        raise PermissionError("Only HOST or ADMIN can add shadow members.")
    token_obj = verification.issue_token(
        purpose="SHADOW_CLAIM",
        recipient_label=f"{name} (Shadow)",
        detail=f"Single-use claim token for group {group_id}",
    )
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        user_cur = conn.execute(
            """INSERT INTO users (name, is_shadow, claim_token_hash, claim_token_expires_at, created_at)
               VALUES (?, 1, ?, ?, ?)""",
            (name.strip(), hash_token(token_obj.token), token_obj.expires_at, now),
        )
        user_id = int(user_cur.lastrowid)
        mem_cur = conn.execute(
            "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'MEMBER', ?)",
            (group_id, user_id, now),
        )
        member_id = int(mem_cur.lastrowid)
        append_audit(
            conn,
            group_id,
            actor_member_id,
            "SHADOW_MEMBER_INVITED",
            "USER",
            user_id,
            {"name": name.strip(), "member_id": member_id},
            now,
        )
    return member_id, token_obj.token


def claim_shadow_member(
    conn: sqlite3.Connection,
    raw_token: str,
    handle: str,
    password: str,
) -> int:
    token_hash = hash_token(raw_token)
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()
    row = conn.execute(
        """SELECT u.id AS user_id, u.is_shadow, u.claim_token_expires_at, u.claimed_at,
                  gm.id AS member_id, gm.group_id
           FROM users u
           JOIN group_members gm ON gm.user_id = u.id
           WHERE u.claim_token_hash = ?""",
        (token_hash,),
    ).fetchone()
    if not row:
        raise ValueError("Invalid or already consumed claim token.")
    if int(row["is_shadow"]) != 1 or row["claimed_at"] is not None:
        raise ValueError("Shadow account already claimed and locked.")
    if row["claim_token_expires_at"] and datetime.fromisoformat(row["claim_token_expires_at"]) <= now_dt:
        raise ValueError("Claim token expired.")

    with conn:
        cur = conn.execute(
            """UPDATE users
               SET handle = ?, password_hash = ?, is_shadow = 0,
                   claim_token_hash = NULL, claim_token_expires_at = NULL, claimed_at = ?
               WHERE id = ? AND is_shadow = 1 AND claimed_at IS NULL""",
            (handle.strip().lower(), hash_password(password), now, int(row["user_id"])),
        )
        if cur.rowcount != 1:
            raise ValueError("Claim conflict — takeover blocked.")
        append_audit(
            conn,
            int(row["group_id"]),
            int(row["member_id"]),
            "SHADOW_MEMBER_CLAIMED",
            "USER",
            int(row["user_id"]),
            {"handle": handle.strip().lower()},
            now,
        )
    return int(row["member_id"])


def dispatch_batched_reminders(
    conn: sqlite3.Connection,
    group_id: int,
    actor_member_id: int,
    verification: VerificationProvider,
    override_hour: Optional[int] = None,
) -> List[Dict[str, str]]:
    group = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    members = [dict(r) for r in conn.execute(
        """SELECT gm.*, u.name FROM group_members gm
           JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?""",
        (group_id,),
    ).fetchall()]
    expenses = [dict(r) for r in conn.execute("SELECT * FROM expenses WHERE group_id = ?", (group_id,)).fetchall()]
    splits = [dict(r) for r in conn.execute(
        "SELECT es.* FROM expense_splits es JOIN expenses e ON e.id = es.expense_id WHERE e.group_id = ?",
        (group_id,),
    ).fetchall()]
    settlements = [dict(r) for r in conn.execute("SELECT * FROM settlements WHERE group_id = ?", (group_id,)).fetchall()]

    summary = compute_balances([m["id"] for m in members], expenses, splits, settlements)
    now = datetime.now(timezone.utc)
    results = []
    for m in members:
        net = summary.net_balances.get(m["id"], 0)
        if net >= 0:
            continue
        eligible, reason = evaluate_reminder_eligibility(
            int(group["quiet_hours_start"]),
            int(group["quiet_hours_end"]),
            int(group["reminder_cooldown_hours"]),
            m["snoozed_until"],
            m["last_reminded_at"],
            now,
            override_hour,
        )
        if not eligible:
            results.append({"name": m["name"], "status": "SUPPRESSED", "reason": reason})
            continue
        text = f"FairShare Summary: You owe {format_paisa_to_pkr(abs(net))}."
        verification.send_batch_summary(m["name"], text)
        with conn:
            conn.execute(
                "UPDATE group_members SET last_reminded_at = ? WHERE id = ?",
                (now.isoformat(), m["id"]),
            )
        results.append({"name": m["name"], "status": "SENT", "reason": text})
    append_audit(
        conn,
        group_id,
        actor_member_id,
        "REMINDER_BATCH_PROCESSED",
        "GROUP",
        group_id,
        {"count": len(results)},
        now.isoformat(),
    )
    return results
