<img width="371" height="666" alt="image" src="https://github.com/user-attachments/assets/68b13eb5-cdeb-4275-90e2-5acfbc54f9e0" />





# FairShare Ledger

A mobile-first roommate and group expense tracker built around exact `PKR` accounting, multi-group switching, horizontal swipe navigation, shareable invite codes for unregistered friends, confirmation-gated partial payments, and a clear activity log.

---

## Quick Start (Local & Wi-Fi / LAN)

### Live Web App (Express + SQLite + React)

```bash
npm install
cp .env.example .env
npm run dev
```

- **Local access**: `http://localhost:3000`
- **Wi-Fi / LAN access**: Open `http://<your-computer-lan-ip>:3000` on any phone connected to the same Wi-Fi network.

### Standalone Python + SQLite Reference

The `python_reference/` package uses only the Python 3.11+ standard library (`sqlite3`, `http.server`, `unittest`):

```bash
PYTHONPATH=python_reference python3 -m unittest discover -s python_reference/tests -v
PYTHONPATH=python_reference python3 python_reference/run_server.py
```

---

## Core Features

- **Real Accounts & Multi-Group Switching**: Sign up with a `@username` and password, create multiple groups (hostel rooms, shared apartments, trips), and switch between groups with a single tap.
- **Mobile-First 4-Tab + Center Add Bill Navigation**: Swipe left or right across views or tap the 4 primary tabs (**Home**, **Balances**, **Settle**, **Friends**) flanking the raised center **Add Bill (+)** button, with **Activity Log** 1 tap away in the top bar and Home screen.
- **Category Spending Breakdown & Custom Group Badges**: Interactive Home spending chart by category (`Food`, `Bills`, `Rent`, `Groceries`, `Travel`, `Other`) that filters Activity on tap, plus custom icons and color themes for each group.
- **Exact PKR Splits**: Split bills equally or with custom amounts per person; integer precision underneath ensures zero rounding drift while keeping the interface simple in `PKR`.
- **Invite Codes for Unregistered Friends**: Add friends by name right away so they can share bills immediately, then share a single-use invite code so they can claim their profile later without losing past splits.
- **Confirmation-Gated Partial Payments**: Payments wait for confirmation from the recipient (or Group Host/Admin) before updating balances, with optional notes and receipt proof uploads.
- **Non-Destructive Bill Removal & Activity Log**: Authorized members can remove mistaken bills with a reason; removed bills stay visibly recorded in the group history and activity log.
