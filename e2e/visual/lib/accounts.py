"""Demo accounts for visual regression testing on localhost + staging.

Staging (vantai.tingting.vip) uses password `123456`; localhost uses
`admin123`. Set VISUAL_PASSWORD env var to override, or rely on the
default `admin123` for localhost.

The runner uses `khachhang` as the primary CUSTOMER account (matches
staging) and falls back to `customer` if `khachhang` is not seeded.
"""
from __future__ import annotations

import os

# Default password for the localhost dev stack. Staging (vantai.tingting.vip)
# uses "123456" — override at runtime by setting the VISUAL_PASSWORD env var
# rather than editing this file, so the same code works in both environments.
DEFAULT_PASSWORD = os.environ.get("VISUAL_PASSWORD", "admin123")

# role_key -> identifier. The role_key doubles as the canonical RBAC role
# name used throughout the regression docs. Every entry must authenticate as
# that exact role; substituting a broader account would make RBAC evidence a
# false positive. Environments without a CLERK fixture must fail preflight
# instead of silently running the scenario as an administrator.
ACCOUNTS = {
    "ADMIN":     {"identifier": "admin",     "home": "/dashboard"},
    "MANAGER":   {"identifier": "giamdoc",   "home": "/dashboard"},
    "ACCOUNTANT":{"identifier": "ketoan",    "home": "/dashboard"},
    "DRIVER":    {"identifier": "laixe",     "home": "/my-trips"},
    "FORWARDER": {"identifier": "giaonhan",  "home": "/my-forwarder-trips"},
    "CUSTOMER":  {"identifier": "khachhang", "home": "/portal/shipments"},
    "CLERK":     {
        "identifier": os.environ.get("VISUAL_CLERK_IDENTIFIER", "clerk"),
        "home": "/clerk/shipments/new",
    },
}


def resolve(role: str) -> tuple[str, str]:
    """Return (identifier, password) for a role key. Raises KeyError if unknown."""
    acct = ACCOUNTS[role]
    return acct["identifier"], DEFAULT_PASSWORD
