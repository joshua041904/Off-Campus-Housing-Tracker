#!/usr/bin/env python3
"""
Compare two transport_ceiling_report.json runs and detect performance regression.
Used by CLI --compare OLD_REPORT.json to exit 1 if regression detected.
"""
from __future__ import annotations


def compare_reports(old: dict, new: dict) -> tuple[dict, bool]:
    """
    Compare old and new reports. Returns (deltas_dict, regression_detected).
    Regression: h3_max_rps drops >5% or loss increases >0.02.
    """
    deltas: dict = {}
    tv_old = old.get("transport_validation") or {}
    tv_new = new.get("transport_validation") or {}
    perf_old = old.get("performance") or {}
    perf_new = new.get("performance") or {}

    old_rps = perf_old.get("h3_max_rps")
    new_rps = perf_new.get("h3_max_rps")
    if old_rps is not None and new_rps is not None and old_rps > 0:
        delta_pct = (new_rps - old_rps) / old_rps * 100
        deltas["h3_max_rps_delta_percent"] = round(delta_pct, 2)

    old_loss = tv_old.get("quic_loss_rate_estimated")
    new_loss = tv_new.get("quic_loss_rate_estimated")
    if old_loss is not None and new_loss is not None:
        deltas["loss_delta"] = round(new_loss - old_loss, 6)

    regression_detected = False
    if deltas.get("h3_max_rps_delta_percent") is not None and deltas["h3_max_rps_delta_percent"] < -5:
        regression_detected = True
    if deltas.get("loss_delta") is not None and deltas["loss_delta"] > 0.02:
        regression_detected = True

    return deltas, regression_detected
