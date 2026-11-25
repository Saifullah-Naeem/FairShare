"""Standalone local HTTP server for the FairShare Ledger Python + SQLite reference."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

from fairshare.db import connect
from fairshare.ledger import compute_balances


DB_PATH = os.environ.get("FAIRSHARE_DB_PATH", "./python_reference/fairshare_ref.db")
HOST = os.environ.get("FAIRSHARE_HOST", "127.0.0.1")
PORT = int(os.environ.get("FAIRSHARE_PORT", "8080"))
LOCAL_ADDRS = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

conn = connect(DB_PATH)


class FairShareHandler(BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(200, {"ok": True, "runtime": "python-sqlite"})
            return
        if self.path == "/api/summary":
            client_ip = self.client_address[0]
            if client_ip not in LOCAL_ADDRS:
                self._send_json(403, {"error": "Localhost access only."})
                return
            members = [dict(r) for r in conn.execute("SELECT id FROM group_members").fetchall()]
            expenses = [dict(r) for r in conn.execute("SELECT * FROM expenses").fetchall()]
            splits = [dict(r) for r in conn.execute("SELECT * FROM expense_splits").fetchall()]
            settlements = [dict(r) for r in conn.execute("SELECT * FROM settlements").fetchall()]
            summary = compute_balances([m["id"] for m in members], expenses, splits, settlements)
            self._send_json(
                200,
                {
                    "net_balances": summary.net_balances,
                    "raw_pair_balances": summary.raw_pair_balances,
                    "simplified_plan": summary.simplified_plan,
                    "zero_sum_check": summary.zero_sum_check,
                },
            )
            return
        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), FairShareHandler)
    print(f"FairShare Python Reference Server listening on http://{HOST}:{PORT}")
    server.serve_forever()
