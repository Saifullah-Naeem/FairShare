"""Pure integer-paisa ledger calculations, debt simplification, and non-spam reminder rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Dict, Iterable, List, Optional, Tuple


PKR_PATTERN = re.compile(r"^\d+(\.\d{1,2})?$")


def parse_pkr_to_paisa(raw: str | int) -> int:
    """Parse a PKR decimal string or integer rupees into exact integer paisa (no floats)."""
    cleaned = str(raw).strip()
    cleaned = re.sub(r"^(rs\.?|pkr)\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.replace(",", "")
    if not PKR_PATTERN.match(cleaned):
        raise ValueError("Enter a valid positive PKR amount with up to 2 decimal places.")
    if "." in cleaned:
        whole_str, frac_str = cleaned.split(".", 1)
    else:
        whole_str, frac_str = cleaned, ""
    total_minor = int(whole_str) * 100 + int(frac_str.ljust(2, "0"))
    if total_minor <= 0:
        raise ValueError("Amount must be greater than Rs. 0.00.")
    return total_minor


def format_paisa_to_pkr(paisa: int) -> str:
    """Format integer paisa as Rs. X,XXX.XX without floating-point arithmetic."""
    sign = "-" if paisa < 0 else ""
    abs_val = abs(paisa)
    rupees, rem = divmod(abs_val, 100)
    return f"{sign}Rs. {rupees:,}.{rem:02d}"


def compute_equal_splits(total_minor: int, member_ids: Iterable[int]) -> List[Tuple[int, int]]:
    """Split integer paisa equally with deterministic +1 paisa remainder distribution."""
    if total_minor <= 0:
        raise ValueError("Total minor units must be positive.")
    unique_sorted = sorted(set(member_ids))
    if not unique_sorted:
        raise ValueError("At least one participant is required.")
    base, remainder = divmod(total_minor, len(unique_sorted))
    return [
        (member_id, base + (1 if idx < remainder else 0))
        for idx, member_id in enumerate(unique_sorted)
    ]


def validate_custom_splits(
    total_minor: int, splits: List[Tuple[int, int]]
) -> List[Tuple[int, int]]:
    """Verify custom splits are non-negative integers summing strictly to total_minor."""
    if total_minor <= 0:
        raise ValueError("Total minor units must be positive.")
    if not splits:
        raise ValueError("Custom splits cannot be empty.")
    seen = set()
    running_sum = 0
    for member_id, amount_minor in splits:
        if member_id in seen:
            raise ValueError("Duplicate member in custom splits.")
        if amount_minor < 0:
            raise ValueError("Split amount cannot be negative.")
        seen.add(member_id)
        running_sum += amount_minor
    if running_sum != total_minor:
        raise ValueError(
            f"Split sum ({format_paisa_to_pkr(running_sum)}) must equal {format_paisa_to_pkr(total_minor)}."
        )
    return [(m, amt) for m, amt in splits if amt > 0]


@dataclass
class BalanceSummary:
    net_balances: Dict[int, int]
    raw_pair_balances: List[Tuple[int, int, int]]
    simplified_plan: List[Tuple[int, int, int]]
    zero_sum_check: int


def compute_balances(
    member_ids: List[int],
    expenses: List[Dict],
    splits: List[Dict],
    settlements: List[Dict],
) -> BalanceSummary:
    """Compute zero-sum net balances, raw pairwise debts, and minimum-transfer simplified plan."""
    net: Dict[int, int] = {mid: 0 for mid in member_ids}
    splits_by_exp: Dict[int, List[Dict]] = {}
    for sp in splits:
        splits_by_exp.setdefault(sp["expense_id"], []).append(sp)

    pair_debt: Dict[Tuple[int, int], int] = {}

    for exp in expenses:
        if exp["status"] == "VOIDED":
            continue
        payer = exp["paid_by_member_id"]
        net[payer] = net.get(payer, 0) + exp["total_minor"]
        for sp in splits_by_exp.get(exp["id"], []):
            borrower = sp["member_id"]
            amt = sp["amount_minor"]
            net[borrower] = net.get(borrower, 0) - amt
            if borrower != payer:
                pair_debt[(borrower, payer)] = pair_debt.get((borrower, payer), 0) + amt

    for st in settlements:
        if st["status"] != "CONFIRMED":
            continue
        sender = st["from_member_id"]
        receiver = st["to_member_id"]
        amt = st["amount_minor"]
        net[sender] = net.get(sender, 0) + amt
        net[receiver] = net.get(receiver, 0) - amt
        pair_debt[(sender, receiver)] = pair_debt.get((sender, receiver), 0) - amt

    raw_pairs: List[Tuple[int, int, int]] = []
    sorted_ids = sorted(member_ids)
    for i, a in enumerate(sorted_ids):
        for b in sorted_ids[i + 1 :]:
            diff = pair_debt.get((a, b), 0) - pair_debt.get((b, a), 0)
            if diff > 0:
                raw_pairs.append((a, b, diff))
            elif diff < 0:
                raw_pairs.append((b, a, abs(diff)))

    creditors = sorted(
        [(mid, amt) for mid, amt in net.items() if amt > 0],
        key=lambda x: (-x[1], x[0]),
    )
    debtors = sorted(
        [(mid, abs(amt)) for mid, amt in net.items() if amt < 0],
        key=lambda x: (-x[1], x[0]),
    )

    simplified: List[Tuple[int, int, int]] = []
    ci = 0
    di = 0
    cred_list = [[m, a] for m, a in creditors]
    debt_list = [[m, a] for m, a in debtors]

    while ci < len(cred_list) and di < len(debt_list):
        transfer = min(cred_list[ci][1], debt_list[di][1])
        if transfer > 0:
            simplified.append((debt_list[di][0], cred_list[ci][0], transfer))
        cred_list[ci][1] -= transfer
        debt_list[di][1] -= transfer
        if cred_list[ci][1] == 0:
            ci += 1
        if debt_list[di][1] == 0:
            di += 1

    return BalanceSummary(
        net_balances=net,
        raw_pair_balances=raw_pairs,
        simplified_plan=simplified,
        zero_sum_check=sum(net.values()),
    )


def is_in_quiet_hours(hour: int, start: int, end: int) -> bool:
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def evaluate_reminder_eligibility(
    quiet_start: int,
    quiet_end: int,
    cooldown_hours: int,
    snoozed_until: Optional[str],
    last_reminded_at: Optional[str],
    now: Optional[datetime] = None,
    override_hour: Optional[int] = None,
) -> Tuple[bool, str]:
    now_dt = now or datetime.now(timezone.utc)
    hour = override_hour if override_hour is not None else now_dt.hour
    if is_in_quiet_hours(hour, quiet_start, quiet_end):
        return False, f"Suppressed during quiet hours ({quiet_start:02d}:00-{quiet_end:02d}:00)."

    if snoozed_until:
        snooze_dt = datetime.fromisoformat(snoozed_until)
        if snooze_dt.tzinfo is None:
            snooze_dt = snooze_dt.replace(tzinfo=timezone.utc)
        if snooze_dt > now_dt:
            return False, "Member snoozed reminders."

    if last_reminded_at:
        last_dt = datetime.fromisoformat(last_reminded_at)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        if last_dt + timedelta(hours=cooldown_hours) > now_dt:
            return False, f"Cooldown active ({cooldown_hours}h window)."

    return True, "Eligible for batched summary reminder."
