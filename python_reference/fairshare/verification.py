"""Pluggable verification provider interface with local and external-gateway stub implementations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
from typing import Dict, List, Optional


@dataclass
class VerificationToken:
    purpose: str
    recipient_label: str
    token: str
    expires_at: str
    detail: str


class VerificationProvider(ABC):
    @abstractmethod
    def issue_token(
        self,
        purpose: str,
        recipient_label: str,
        detail: str,
        ttl_minutes: int = 4320,
        fixed_token: Optional[str] = None,
    ) -> VerificationToken:
        raise NotImplementedError

    @abstractmethod
    def send_batch_summary(self, recipient_label: str, summary_text: str) -> Dict[str, str]:
        raise NotImplementedError

    @abstractmethod
    def get_active_tokens(self) -> List[VerificationToken]:
        raise NotImplementedError


class DevMockVerificationProvider(VerificationProvider):
    """Local verification provider that keeps expiring codes in memory without printing secrets to stdout."""

    def __init__(self) -> None:
        self._tokens: Dict[str, VerificationToken] = {}

    def issue_token(
        self,
        purpose: str,
        recipient_label: str,
        detail: str,
        ttl_minutes: int = 4320,
        fixed_token: Optional[str] = None,
    ) -> VerificationToken:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
        ).isoformat()
        raw_token = fixed_token or f"FS-{secrets.token_hex(3).upper()}-{secrets.token_hex(2).upper()}"
        record = VerificationToken(
            purpose=purpose,
            recipient_label=recipient_label,
            token=raw_token,
            expires_at=expires_at,
            detail=detail,
        )
        self._tokens[raw_token] = record
        return record

    def send_batch_summary(self, recipient_label: str, summary_text: str) -> Dict[str, str]:
        return {"channel": "in_app_summary", "status": "prepared"}

    def get_active_tokens(self) -> List[VerificationToken]:
        now = datetime.now(timezone.utc)
        active = []
        for key, item in list(self._tokens.items()):
            if datetime.fromisoformat(item.expires_at) > now:
                active.append(item)
            else:
                del self._tokens[key]
        return active

    def consume_token(self, token: str) -> None:
        self._tokens.pop(token, None)


class ProductionStubVerificationProvider(VerificationProvider):
    """Stub reserving the interface for external SMS/email gateways."""

    def issue_token(
        self,
        purpose: str,
        recipient_label: str,
        detail: str,
        ttl_minutes: int = 4320,
        fixed_token: Optional[str] = None,
    ) -> VerificationToken:
        raise NotImplementedError(
            "External SMS/Email gateway is not configured."
        )

    def send_batch_summary(self, recipient_label: str, summary_text: str) -> Dict[str, str]:
        raise NotImplementedError(
            "External SMS/Email gateway is not configured."
        )

    def get_active_tokens(self) -> List[VerificationToken]:
        return []
