#!/usr/bin/env python3
"""
Collect experiment metadata for transport validation runs.
Used so every run records git commit, cluster config, sysctl, k6 version, timestamp for reproducibility.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def _run(cmd: list[str], cwd: Path | None = None, timeout: int = 10) -> str | None:
    try:
        r = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        if r.returncode == 0 and r.stdout:
            return r.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    return None


def git_commit(repo_root: Path) -> str | None:
    return _run(["git", "rev-parse", "HEAD"], cwd=repo_root)


def git_branch(repo_root: Path) -> str | None:
    return _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root)


def k6_version(k6_bin: str | Path) -> str | None:
    p = Path(k6_bin).expanduser()
    if not p.is_absolute() or not p.exists():
        return None
    out = _run([str(p), "version"], timeout=5)
    if out:
        return out.split("\n")[0].strip()
    return None


def cluster_summary() -> dict | None:
    """Minimal cluster info: node count, ready count, k8s server version (if kubectl available)."""
    try:
        nodes = _run(["kubectl", "get", "nodes", "--no-headers"], timeout=5)
        if not nodes:
            return None
        lines = [l for l in nodes.splitlines() if l.strip()]
        ready = sum(1 for l in lines if " Ready " in l)
        version = _run(["kubectl", "version", "-o", "json"], timeout=5)
        server = None
        if version:
            try:
                d = json.loads(version)
                sv = d.get("serverVersion") or {}
                server = sv.get("gitVersion")
            except json.JSONDecodeError:
                pass
        return {
            "node_count": len(lines),
            "ready_count": ready,
            "server_version": server,
        }
    except Exception:
        return None


def sysctl_quic_relevant() -> dict:
    """Relevant sysctls for QUIC/CC (when run inside VM or on host)."""
    keys = [
        "net.ipv4.tcp_congestion_control",
        "net.core.default_qdisc",
        "net.ipv4.tcp_slow_start_after_idle",
    ]
    out: dict[str, str | None] = {}
    for key in keys:
        r = _run(["sysctl", "-n", key], timeout=2)
        out[key] = r if r else None
    return out


def collect(
    repo_root: Path,
    k6_bin: Path | str | None = None,
    experiment_uuid: str | None = None,
    reproducibility_hash: str | None = None,
) -> dict:
    """Build experiment metadata dict."""
    repo = Path(repo_root).resolve()
    ts = datetime.now(timezone.utc).isoformat()
    meta: dict = {
        "timestamp_utc": ts,
        "git_commit": git_commit(repo),
        "git_branch": git_branch(repo),
        "k6_version": None,
        "cluster": cluster_summary(),
        "sysctl": sysctl_quic_relevant(),
        "config_file": None,
        "experiment_uuid": experiment_uuid,
        "reproducibility_hash": reproducibility_hash,
    }
    cfg = repo / "transport-config.yaml"
    if cfg.exists():
        meta["config_file"] = str(cfg)
    if k6_bin:
        k6_abs = (repo / k6_bin) if not Path(str(k6_bin)).is_absolute() else Path(k6_bin)
        if k6_abs.exists():
            meta["k6_version"] = k6_version(str(k6_abs.resolve()))
    return meta


def main() -> None:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    k6_bin = sys.argv[2] if len(sys.argv) > 2 else None
    meta = collect(root, Path(k6_bin) if k6_bin else None)
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else root / "experiment_metadata.json"
    with open(out, "w") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta, indent=2))
    print(f"Wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
