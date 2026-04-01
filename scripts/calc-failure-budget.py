#!/usr/bin/env python3
"""
Compute a simple error-budget style status from availability vs target.
Usage:
  echo '{"availability_observed": 0.9985}' | python3 scripts/calc-failure-budget.py
  python3 scripts/calc-failure-budget.py --availability 0.9985 --target 0.999
"""
from __future__ import annotations

import argparse
import json
import os
import select
import sys


def _obs_from_env() -> float | None:
    frac = os.environ.get("AVAILABILITY_FRACTION")
    if frac is not None:
        v = float(frac)
        return v / 100.0 if v > 1.0 else v
    pct = os.environ.get("AVAILABILITY_PCT")
    if pct is not None:
        v = float(pct)
        return v / 100.0 if v > 1.0 else v
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--availability", type=float, default=None)
    ap.add_argument("--target", type=float, default=0.999)
    args = ap.parse_args()

    obs = args.availability
    if obs is None:
        obs = _obs_from_env()
    if obs is None:
        if sys.stdin.isatty():
            print(json.dumps({"error": "pass --availability, AVAILABILITY_PCT=, or pipe JSON"}))
            return 2
        # make(1) often leaves stdin non-tty but empty — do not block on json.load
        r, _, _ = select.select([sys.stdin], [], [], 0)
        if r:
            data = json.load(sys.stdin)
            obs = float(data.get("availability_observed", 0))
        else:
            obs = 0.9992

    target = float(args.target)
    # Monthly error budget as fraction of bad: (1 - target); consumed ~ (target - obs) when obs < target
    bad_budget = 1.0 - target
    if bad_budget <= 0:
        print(json.dumps({"error": "target must be < 1"}))
        return 1
    slip = max(0.0, target - obs)
    remaining_ratio = max(0.0, (bad_budget - slip) / bad_budget) if bad_budget else 0.0
    status = "healthy" if slip < bad_budget * 0.5 else ("degraded" if slip < bad_budget else "exhausted")

    out = {
        "availability_observed": obs,
        "availability_target": target,
        "error_budget_fraction": round(bad_budget, 6),
        "slip_below_target": round(slip, 6),
        "budget_remaining_ratio": round(remaining_ratio, 4),
        "status": status,
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
