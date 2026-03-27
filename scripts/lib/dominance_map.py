#!/usr/bin/env python3
"""
Combine QUIC metrics with protocol happiness matrix (or optional transport artifact)
into a small dominance summary for final-transport-artifact.json.
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any, List, Optional


def load_json(p: Path) -> Optional[Any]:
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def matrix_rows(data: Optional[dict]) -> List[dict]:
    if not data or not isinstance(data, dict):
        return []
    r = data.get("rows")
    if isinstance(r, list):
        return [x for x in r if isinstance(x, dict)]
    s = data.get("services")
    if isinstance(s, list):
        return [x for x in s if isinstance(x, dict)]
    return []


def mean_tau_from_rows(rows: List[dict]) -> Optional[float]:
    taus: list[float] = []
    for row in rows:
        t = row.get("transport_gain_tau")
        if t is None and isinstance(row.get("transport_dominance"), dict):
            t = row["transport_dominance"].get("transport_gain_tau_h3_vs_h2")
        if t is None:
            continue
        try:
            taus.append(float(t))
        except (TypeError, ValueError):
            continue
    if not taus:
        return None
    return sum(taus) / len(taus)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quic-metrics", required=True)
    ap.add_argument(
        "--happiness-matrix",
        default="",
        help="protocol-happiness-matrix.json (preferred when no transport artifact yet)",
    )
    ap.add_argument(
        "--transport-artifact",
        default="",
        help="final-transport-artifact.json if it already exists (optional)",
    )
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    qpath = Path(args.quic_metrics)
    q = load_json(qpath)
    if not isinstance(q, dict):
        q = {"error": "missing_or_invalid_quic_metrics"}

    loss = float(q.get("loss_rate_percent") or 0)

    rows: List[dict] = []
    if args.transport_artifact:
        art = load_json(Path(args.transport_artifact))
        if isinstance(art, dict) and isinstance(art.get("per_service"), dict):
            for _svc, block in art["per_service"].items():
                if not isinstance(block, dict):
                    continue
                h = block.get("happiness")
                if isinstance(h, dict):
                    rows.append(h)
    if not rows and args.happiness_matrix:
        data = load_json(Path(args.happiness_matrix))
        if isinstance(data, dict):
            rows = matrix_rows(data)

    mean_tau = mean_tau_from_rows(rows)
    tau_term = 0.0 if mean_tau is None else max(-1.0, min(1.0, mean_tau)) * 0.35
    score = 0.5 + tau_term - (loss / 100.0) * 0.45
    score = max(0.0, min(1.0, round(score, 4)))

    out = {
        "mean_dominance_score": score,
        "quic_loss_rate_percent": loss,
        "protocol_rows_used": len(rows),
        "mean_transport_gain_tau": round(mean_tau, 4) if mean_tau is not None else None,
    }
    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except OSError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
