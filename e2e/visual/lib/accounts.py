"""Environment-configured accounts for visual regression testing.

Set ``VISUAL_PASSWORD`` outside the repository. Environment-specific account
identifiers may be overridden without embedding credentials in test evidence.
"""
from __future__ import annotations

import os

DEFAULT_PASSWORD = os.environ.get("VISUAL_PASSWORD", "")

# role_key -> identifier. The role_key doubles as the canonical RBAC role
# name used throughout the regression docs. Every entry must authenticate as
# that exact role; substituting a broader account would make RBAC evidence a
# false positive.
ACCOUNTS = {
    "ADMIN":     {"identifier": "admin",     "home": "/dashboard"},
    "MANAGER":   {"identifier": "giamdoc",   "home": "/dashboard"},
    "ACCOUNTANT":{"identifier": "ketoan",    "home": "/accounting"},
    "CUS":       {"identifier": os.environ.get("VISUAL_CUS_IDENTIFIER", "cus"), "home": "/shipments"},
    "DRIVER":    {"identifier": "laixe",     "home": "/my-trips"},
    "FORWARDER": {"identifier": "giaonhan",  "home": "/my-orders"},
    "CUSTOMER":  {
        "identifier": os.environ.get("VISUAL_CUSTOMER_IDENTIFIER", "customer"),
        "home": "/portal/shipments",
    },
}

if legacy_clerk_identifier := os.environ.get("VISUAL_LEGACY_CLERK_IDENTIFIER"):
    ACCOUNTS["CLERK"] = {"identifier": legacy_clerk_identifier, "home": "/shipments/new"}


def resolve(role: str) -> tuple[str, str]:
    """Return (identifier, password) for a role key. Raises KeyError if unknown."""
    if not DEFAULT_PASSWORD:
        raise RuntimeError("VISUAL_PASSWORD must be configured outside the repository")
    acct = ACCOUNTS[role]
    return acct["identifier"], DEFAULT_PASSWORD
