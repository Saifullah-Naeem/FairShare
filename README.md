# FairShare Ledger

A lightweight, mobile-first web application for hostel rooms, shared flats, and university group expense splitting—built around strict integer minor-unit (`paisa`) accounting, claimable shadow members, confirmation-gated partial settlements, non-spam reminders, and an append-only audit trail.

> **Demo Environment Notice:** FairShare Ledger is a portfolio and concept application. It does **not** process real money, connect to banking/wallet APIs, or send paid SMS/email messages. All verification tokens and reminder summaries run through a pluggable `DevMockVerificationProvider` in demo mode.

---

## 1. The Problem

Shared living expenses in student hostels and roommate flats frequently break down over four recurring edge cases:
1. **Floating-point rounding drift**: Naive decimal splits (`100 / 3`) leak or create cents/paisa over time.
2. **Unregistered friends ("Ghost" members)**: Groups wait weeks to split bills because one roommate hasn't installed the app yet.
3. **Disputed partial payments**: Marking a debt "settled" immediately without recipient confirmation or rejection reasons leads to misunderstandings.
4. **Silent edits & reminder spam**: Deleting mistakes erases accountability, while per-expense ping notifications annoy roommates late at night.

---

## 2. Quick Start (Local & Wi-Fi / LAN)

### Option A: Live Full-Stack App (Express + SQLite + React)

```bash
npm install
cp .env.example .env
npm run dev
```

- **Local access**: `http://localhost:3000`
- **Wi-Fi / LAN access**: The server binds to `0.0.0.0:3000`, so any phone on the same Wi-Fi network can open `http://<your-laptop-lan-ip>:3000`.

### Option B: Standalone Python + Built-in SQLite Reference

The `python_reference/` package uses **only the Python 3.11+ standard library** (`sqlite3`, `http.server`, `unittest`, `hashlib`, `secrets`).

```bash
# Run the unittest verification suite
PYTHONPATH=python_reference python3 -m unittest discover -s python_reference/tests -v

# Start the standalone Python LAN server
PYTHONPATH=python_reference python3 python_reference/run_server.py
```

---

## 3. Core Ledger Rules & Invariants

1. **Exact Integer Minor Units (PKR Paisa)**:
   - Every currency amount is parsed via string-digit splitting (zero floating-point multiplication) and persisted in SQLite as integer **paisa** (`1 Rs. = 100 paisa`).
   - Equal splits distribute odd remainder paisa deterministically (`+1` paisa to the first `N` sorted participants) so `SUM(expense_splits) == total_minor` always holds.
   - Custom splits are rejected unless the integer sum strictly equals `total_minor`.

2. **Shadow ("Ghost") Members & Single-Use Claims**:
   - Hosts/Admins can add unregistered friends by name (`is_shadow = 1`) and assign splits to them immediately.
   - Inviting generates an expiring, single-use claim token whose SHA-256 hash is stored in `users.claim_token_hash`.
   - Claiming atomically binds a `@handle` and `scrypt`-hashed password, preserves the exact `group_members.id` (keeping all historical splits and debts intact), clears the token hash, and locks out duplicate takeovers.

3. **Partial Payments & Explicit State Machine**:
   - Settlements begin in `PENDING_CONFIRMATION` and move to `CONFIRMED`, `REJECTED` (with mandatory reason), or `CANCELLED`.
   - **Only `CONFIRMED` settlements reduce balances.** Pending, rejected, and cancelled payments stay visible without altering net balances.

4. **Non-Destructive Voids & Append-Only Audit Trail**:
   - Expenses are never deleted. Authorized actors (`paid_by_member`, `ADMIN`, or `HOST`) can transition an `ACTIVE` expense to `VOIDED` with a required reason; voided items stay visible in history while being excluded from balance totals.
   - Every mutation writes an immutable row to `audit_logs`.

5. **Balances & Debt Simplification**:
   - Net balances maintain the strict zero-sum invariant (`SUM(net_balances) == 0`).
   - Screen 2 provides both the **Raw Pairwise Balances** view and a greedy **Simplified Debt-Settlement Plan** minimizing total transfers.

6. **Non-Spam Reminders**:
   - Supports configurable group **Quiet Hours** (default `22:00–08:00`), per-group **Cooldown** windows (default `12h`), personal **Snooze**, and single **Batched Summary** dispatches.

---

## 4. Database Schema (7 Core Tables)

1. `users` — Registered users, shadow flags, `scrypt` password hashes, and single-use SHA-256 claim token hashes + expiry.
2. `groups` — Group configuration (`currency_code = 'PKR'`, quiet hours, cooldown hours).
3. `group_members` — Role assignment (`HOST`, `ADMIN`, `MEMBER`), snooze timestamp, and last reminder timestamp.
4. `expenses` — Integer `total_minor`, `EQUAL`/`CUSTOM` split mode, `ACTIVE`/`VOIDED` status, void reason, and local receipt proof path.
5. `expense_splits` — Exact minor-unit allocation per member.
6. `settlements` — Partial/full transfers with `PENDING_CONFIRMATION` / `CONFIRMED` / `REJECTED` / `CANCELLED` states, notes, and receipt paths.
7. `audit_logs` — Append-only JSON event log of all ledger mutations.

---

## 5. Key Engineering Trade-Offs

- **SQLite + Single-Host Bind vs. Cloud Auth**: Designed to run effortlessly on a laptop over hostel Wi-Fi without cloud dependencies. Role permissions (`HOST`, `ADMIN`, `MEMBER`, payer/recipient) are enforced on the server via HMAC-signed Bearer tokens, while demo mode includes a perspective switcher to test permission boundaries immediately.
- **Greedy Debt Simplification Alongside Raw Pairs**: Greedy matching minimizes transfer count in `O(N log N)` time, while retaining raw pairwise balances lets roommates inspect exact per-person obligations when someone prefers direct settling.
- **Pluggable Verification Boundary**: `DevMockVerificationProvider` logs expiring tokens in the server console and UI banner so every claim and reminder flow can be verified end-to-end without paid SMS/email credentials, while `ProductionStubVerificationProvider` defines the clean swap boundary.
