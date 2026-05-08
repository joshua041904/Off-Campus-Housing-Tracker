#!/usr/bin/env python3
"""Bootstrap health score, strict dependency DAG validation, cluster-doctor, drift.

  python3 scripts/cluster_health_dag.py bootstrap --ns NS --repo REPO
      → bench_logs/bootstrap-health.json (includes category_breakdown, deductions, summary_text),
        dependency-dag-validation.json, merges bench_logs/bootstrap-artifact.json.
        Embeds state_contract (workspace + cluster fingerprints) in bootstrap-artifact.json.
        Prints JSON summary + human summary_text. Exit 2 if score < 90 or DAG invalid.

  python3 scripts/cluster_health_dag.py doctor --repo REPO [--strict]
      → bench_logs/cluster-doctor.json; human report.
      CLUSTER_DOCTOR_STRICT=1 or --strict: exit 1 if live score < 95.

  python3 scripts/cluster_health_dag.py drift --repo REPO [--ns NS]
      → bench_logs/drift-detection.json; exit 1 if any drift vs bootstrap-artifact.json.

Env: OCH_EDGE_HOSTNAME (default off-campus-housing.test), HOUSING_NS (doctor, drift).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any

WEIGHTS: dict[str, int] = {
    "control_plane": 20,
    "infra": 20,
    "security": 15,
    "images": 10,
    "deployments": 15,
    "endpoints": 10,
    "edge": 5,
    "kafka_contract": 5,
}


def _kubectl(args: list[str], timeout: float = 60) -> tuple[str, int]:
    try:
        r = subprocess.run(
            ["kubectl", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return (r.stdout or "").strip(), r.returncode
    except (OSError, subprocess.TimeoutExpired) as e:
        return str(e), 1


def _docker_inspect(image: str) -> bool:
    r = subprocess.run(
        ["docker", "image", "inspect", image],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return r.returncode == 0


def _run_make(repo: Path, target: str) -> int:
    r = subprocess.run(
        ["make", "-C", str(repo), target],
        cwd=str(repo),
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=600,
    )
    return r.returncode


def _housing_deployments() -> list[str]:
    return [
        "auth-service",
        "listings-service",
        "booking-service",
        "messaging-service",
        "trust-service",
        "analytics-service",
        "media-service",
        "notification-service",
        "api-gateway",
    ]


def _default_image_services() -> list[str]:
    # scripts/lib/och-housing-docker-services-default.sh + webapp
    return [
        "auth-service",
        "listings-service",
        "booking-service",
        "messaging-service",
        "trust-service",
        "analytics-service",
        "media-service",
        "notification-service",
        "api-gateway",
        "transport-watchdog",
        "webapp",
    ]


def score_control_plane(warnings: list[str]) -> float:
    mx = float(WEIGHTS["control_plane"])
    pts = 0.0
    out, rc = _kubectl(["get", "nodes", "--no-headers"])
    if rc != 0 or not out:
        warnings.append("control_plane: kubectl get nodes failed")
        return 0.0
    lines = [ln for ln in out.splitlines() if ln.strip()]
    if not lines:
        warnings.append("control_plane: no nodes")
        return 0.0
    ready = sum(1 for ln in lines if re.search(r"\bReady\b", ln))
    if ready == len(lines):
        pts += 10.0
    else:
        warnings.append(f"control_plane: only {ready}/{len(lines)} nodes Ready")
        pts += 10.0 * (ready / len(lines))

    out2, rc2 = _kubectl(["get", "pods", "-n", "kube-system", "--no-headers"])
    if rc2 != 0 or not out2.strip():
        warnings.append("control_plane: kube-system pods unreadable")
    else:
        bad = tot = 0
        for ln in out2.splitlines():
            if not ln.strip():
                continue
            parts = ln.split()
            name = parts[0] if parts else ""
            # k3s ServiceLB (svclb-*) often Pending until a LoadBalancer exists — same as bootstrap P2 gate.
            if name.startswith("svclb-"):
                continue
            tot += 1
            st = parts[2] if len(parts) > 2 else ""
            if st not in ("Running", "Completed"):
                bad += 1
        if tot and bad == 0:
            pts += 5.0
        else:
            warnings.append(f"control_plane: kube-system notReady={bad}/{tot}")
            pts += 5.0 * max(0.0, (tot - bad) / max(tot, 1))

    t0 = time.perf_counter()
    _, rc3 = _kubectl(["get", "nodes", "--request-timeout=5s"])
    dt = time.perf_counter() - t0
    if rc3 == 0 and dt < 1.0:
        pts += 5.0
    else:
        warnings.append(f"control_plane: API latency high or error (dt={dt:.2f}s rc={rc3})")
        pts += 2.5 if rc3 == 0 else 0.0

    return min(mx, pts)


def _verify_kafka_tls_sans(repo: Path, ns: str) -> bool:
    script = repo / "scripts" / "verify-kafka-tls-sans.sh"
    if not script.is_file():
        return False
    env = os.environ.copy()
    env["HOUSING_NS"] = ns
    r = subprocess.run(
        ["bash", str(script), ns, "3"],
        cwd=str(repo),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    return r.returncode == 0


def score_infra(ns: str, repo: Path, warnings: list[str]) -> float:
    mx = float(WEIGHTS["infra"])
    pts = 0.0
    ok_b = 0
    for i in range(3):
        out, rc = _kubectl(
            ["get", "pod", f"kafka-{i}", "-n", ns, "-o", "jsonpath={.status.phase}"]
        )
        if rc == 0 and out.strip() == "Running":
            ok_b += 1
    pts += 10.0 * (ok_b / 3.0)
    if ok_b < 3:
        warnings.append(f"infra: kafka brokers Running {ok_b}/3")

    try:
        s = socket.create_connection(("127.0.0.1", 6380), timeout=2)
        s.close()
        pts += 5.0
    except OSError as e:
        warnings.append(f"infra: Redis 127.0.0.1:6380 not reachable ({e})")

    if _verify_kafka_tls_sans(repo, ns):
        pts += 5.0
    else:
        warnings.append("infra: Kafka TLS SAN verify failed (scripts/verify-kafka-tls-sans.sh)")

    return min(mx, pts)


def score_security(ns: str, repo: Path, warnings: list[str]) -> float:
    mx = float(WEIGHTS["security"])
    pts = 0.0
    ca = repo / "certs" / "dev-root.pem"
    leaf_crt = repo / "certs" / "off-campus-housing.test.crt"
    if ca.is_file():
        r = subprocess.run(
            ["openssl", "x509", "-in", str(ca), "-noout", "-subject"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if r.returncode == 0:
            pts += 5.0
        else:
            warnings.append("security: CA openssl parse failed")
    else:
        warnings.append("security: missing certs/dev-root.pem")

    if leaf_crt.is_file():
        r = subprocess.run(
            ["openssl", "x509", "-in", str(leaf_crt), "-noout", "-purpose"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        out = (r.stdout or "") + (r.stderr or "")
        if r.returncode == 0 and re.search(r"SSL\s+server\s*:\s*Yes", out, re.I):
            pts += 5.0
        else:
            warnings.append("security: leaf EKU / sslserver check failed")
    else:
        warnings.append("security: missing leaf cert")

    need = [("app-secrets", ns), ("och-service-tls", ns), ("och-kafka-ssl-secret", ns)]
    ok_s = 0
    for name, nsp in need:
        _, rc = _kubectl(["get", "secret", name, "-n", nsp])
        if rc == 0:
            ok_s += 1
    pts += 5.0 * (ok_s / 3.0)
    if ok_s < 3:
        warnings.append(f"security: secrets present {ok_s}/3")

    return min(mx, pts)


def score_images(repo: Path, warnings: list[str]) -> float:
    mx = float(WEIGHTS["images"])
    names = _default_image_services()
    ok = sum(1 for n in names if _docker_inspect(f"{n}:dev"))
    if ok < len(names):
        missing = [f"{n}:dev" for n in names if not _docker_inspect(f"{n}:dev")]
        warnings.append(f"images: missing {missing}")
    return min(mx, 10.0 * (ok / max(len(names), 1)))


def score_deployments(ns: str, warnings: list[str]) -> float:
    mx = float(WEIGHTS["deployments"])
    names = _housing_deployments()
    ok = 0
    for name in names:
        out, rc = _kubectl(
            [
                "get",
                "deploy",
                name,
                "-n",
                ns,
                "-o",
                'jsonpath={.status.conditions[?(@.type=="Available")].status}',
            ]
        )
        if rc == 0 and out.strip() == "True":
            ok += 1
        elif rc != 0:
            warnings.append(f"deployments: no Deploy/{name} in {ns}")
    return min(mx, 15.0 * (ok / max(len(names), 1)))


def _endpoints_have_addrs(ns: str, svc: str) -> bool:
    out, rc = _kubectl(
        ["get", f"endpoints/{svc}", "-n", ns, "-o", "jsonpath={.subsets[*].addresses[*].ip}"]
    )
    return rc == 0 and bool((out or "").replace(" ", ""))


def score_endpoints(ns: str, warnings: list[str]) -> float:
    mx = float(WEIGHTS["endpoints"])
    ordered = list(dict.fromkeys(_housing_deployments()))
    ok = 0
    for svc in ordered:
        if _endpoints_have_addrs(ns, svc):
            ok += 1
        else:
            warnings.append(f"endpoints: no addresses for {svc}")
    return min(mx, 10.0 * (ok / max(len(ordered), 1)))


def score_edge(repo: Path, warnings: list[str]) -> float:
    mx = float(WEIGHTS["edge"])
    host = os.environ.get("OCH_EDGE_HOSTNAME", "off-campus-housing.test")
    ca = repo / "certs" / "dev-root.pem"
    if not ca.is_file():
        warnings.append("edge: missing CA for curl")
        return 0.0
    attempts = int(os.environ.get("BOOTSTRAP_HEALTH_EDGE_CURL_ATTEMPTS", "12"))
    sleep_s = float(os.environ.get("BOOTSTRAP_HEALTH_EDGE_CURL_SLEEP", "2"))
    last_tail = ""
    suite = os.environ.get("OCH_X_SUITE", "bash")
    for att in range(1, attempts + 1):
        r = subprocess.run(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--connect-timeout",
                "10",
                "--max-time",
                "45",
                "--cacert",
                str(ca),
                "-H",
                "x-traffic-class: infra",
                "-H",
                f"x-suite: {suite}",
                f"https://{host}/api/readyz",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if r.returncode == 0:
            return mx
        last_tail = (r.stderr or r.stdout or "")[:200]
        if att < attempts:
            time.sleep(sleep_s)
    warnings.append(f"edge: curl /api/readyz failed after {attempts} tries ({last_tail})")
    return 0.0


def score_kafka_contract(repo: Path, warnings: list[str]) -> float:
    mx = float(WEIGHTS["kafka_contract"])
    rc = _run_make(repo, "verify-kafka-bootstrap")
    if rc == 0:
        return mx
    warnings.append(f"kafka_contract: make verify-kafka-bootstrap exit {rc}")
    return 0.0


def compute_health(ns: str, repo: Path) -> dict[str, Any]:
    warnings: list[str] = []
    raw: dict[str, float] = {
        "control_plane": score_control_plane(warnings),
        "infra": score_infra(ns, repo, warnings),
        "security": score_security(ns, repo, warnings),
        "images": score_images(repo, warnings),
        "deployments": score_deployments(ns, warnings),
        "endpoints": score_endpoints(ns, warnings),
        "edge": score_edge(repo, warnings),
        "kafka_contract": score_kafka_contract(repo, warnings),
    }
    cats = {k: int(round(float(raw[k]))) for k in raw}
    score = min(100, sum(cats.values()))
    max_score = sum(WEIGHTS.values())
    sum_raw = sum(float(raw[k]) for k in WEIGHTS)
    breakdown: list[dict[str, Any]] = []
    for k, cap in WEIGHTS.items():
        er = float(raw[k])
        earned_int = int(round(er))
        breakdown.append(
            {
                "category": k,
                "weight": cap,
                "earned": earned_int,
                "earned_raw": round(er, 2),
                "lost_vs_weight": round(cap - er, 2),
            }
        )
    breakdown.sort(key=lambda x: -float(x["lost_vs_weight"]))
    rounding_delta = round(score - sum_raw, 2)
    deductions: list[str] = []
    for b in breakdown:
        lv = float(b["lost_vs_weight"])
        if lv >= 0.05:
            deductions.append(
                f"{b['category']}: earned {b['earned']}/{b['weight']} "
                f"(raw {b['earned_raw']}; ~{b['lost_vs_weight']} pt below cap — see warnings for this area)"
            )
    if abs(rounding_delta) >= 0.01:
        deductions.append(
            f"rounding: per-category int sum={score} vs summed raw floats={round(sum_raw, 2)} (Δ={rounding_delta:+.2f})"
        )
    points_below_max = max_score - score
    summary_lines = [
        f"score {score}/{max_score} ({points_below_max} pt below max)",
    ]
    if deductions:
        summary_lines.append("where points went:")
        summary_lines.extend(f"  - {d}" for d in deductions[:12])
    elif points_below_max > 0:
        summary_lines.append(
            "(no single loss ≥0.05 vs its weight; see categories / categories_raw for fractional shortfall)"
        )
    if warnings:
        summary_lines.append(f"warnings ({len(warnings)}):")
        summary_lines.extend(f"  ! {w}" for w in warnings[:20])
        if len(warnings) > 20:
            summary_lines.append(f"  … +{len(warnings) - 20} more (see bootstrap-health.json)")
    summary_text = "\n".join(summary_lines)
    return {
        "state": "BOOTSTRAP_COMPLETE",
        "score": score,
        "max_score": max_score,
        "categories": cats,
        "categories_raw": {k: round(float(raw[k]), 2) for k in raw},
        "category_breakdown": breakdown,
        "points_below_max": points_below_max,
        "sum_categories_raw_float": round(sum_raw, 2),
        "integer_vs_float_score_delta": rounding_delta,
        "deductions": deductions,
        "summary_text": summary_text,
        "warnings": warnings,
        "timestamp": int(time.time()),
        "timestamp_unix": int(time.time()),
        "housing_ns": ns,
    }


def _sha256_file(path: Path) -> str:
    if not path.is_file():
        return ""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _node_version_short() -> str:
    try:
        r = subprocess.run(
            ["node", "-v"], capture_output=True, text=True, timeout=8
        )
        if r.returncode == 0:
            return (r.stdout or "").strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ""


def _kubectl_server_git_version() -> str:
    out, rc = _kubectl(["version", "-o", "json"], timeout=30)
    if rc != 0 or not (out or "").strip():
        return ""
    try:
        d = json.loads(out)
        return str((d.get("serverVersion") or {}).get("gitVersion") or "")
    except json.JSONDecodeError:
        return ""


def _caddy_h3_lb_ip() -> str:
    out, rc = _kubectl(
        [
            "get",
            "svc",
            "-n",
            "ingress-nginx",
            "caddy-h3",
            "-o",
            "jsonpath={.status.loadBalancer.ingress[0].ip}",
        ],
        timeout=25,
    )
    return (out or "").strip() if rc == 0 else ""


def _bootstrap_state_contract(repo: Path, ns: str) -> dict[str, Any]:
    """Serialized invariants at end of bootstrap (constructor contract)."""
    lock = repo / "pnpm-lock.yaml"
    kc = repo / "tools" / "kafka-contract" / "dist" / "index.js"
    lb = _caddy_h3_lb_ip()
    transport = _edge_transport(repo)
    return {
        "state_contract_version": 1,
        "workspace": {
            "node_version": _node_version_short(),
            "pnpm_lock_sha256": _sha256_file(lock),
            "kafka_contract_dist_present": bool(kc.is_file() and kc.stat().st_size > 0),
        },
        "cluster": {
            "kubectl_context": (_kubectl(["config", "current-context"])[0] or "").strip()
            or "unknown",
            "k8s_server_git_version": _kubectl_server_git_version(),
        },
        "infra": {
            "caddy_h3_lb_ip": lb or None,
            "caddy_lb_assigned": bool(lb),
            "edge_http2_ok": bool(transport.get("http2")),
            "edge_http3_ok": bool(transport.get("http3")),
        },
        "kafka": {
            "note": "Broker/replica counts also on bootstrap-artifact top-level fields",
        },
        "databases": {
            "note": "Schema validation is make cold-bootstrap inspect step; not re-run inside P9",
        },
    }


def _load_dag(repo: Path) -> dict[str, Any]:
    path = repo / "scripts" / "lib" / "och-cluster-dependency-dag.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _ns_default(dag: dict[str, Any], node_cfg: dict[str, Any]) -> str:
    return str(node_cfg.get("namespace") or dag.get("housing_ns_default", "off-campus-housing-tracker"))


def _detect_cycles(nodes: dict[str, Any]) -> list[str] | None:
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {n: WHITE for n in nodes}
    stack: list[str] = []

    def visit(u: str) -> list[str] | None:
        color[u] = GRAY
        stack.append(u)
        for v in nodes[u].get("deps") or []:
            if v not in nodes:
                return [f"unknown dependency {v!r} from {u}"]
            if color[v] == GRAY:
                return [f"cycle: {' -> '.join(stack + [v])}"]
            if color[v] == WHITE:
                err = visit(v)
                if err:
                    return err
        stack.pop()
        color[u] = BLACK
        return None

    for n in nodes:
        if color[n] == WHITE:
            err = visit(n)
            if err:
                return err
    return None


def _toposort(nodes: dict[str, Any]) -> list[str] | None:
    deps = {n: list(nodes[n].get("deps") or []) for n in nodes}
    indeg = {n: len(deps[n]) for n in nodes}
    q = deque(sorted([n for n in nodes if indeg[n] == 0]))
    out: list[str] = []
    while q:
        u = q.popleft()
        out.append(u)
        for v in nodes:
            if u in (nodes[v].get("deps") or []):
                indeg[v] -= 1
                if indeg[v] == 0:
                    q.append(v)
    if len(out) != len(nodes):
        return None
    return out


def _deployment_http_health(ns: str, deploy_name: str, port: int, path: str) -> bool:
    """GET http://127.0.0.1:port/path via kubectl exec deploy/… (optional DAG field)."""
    inner = (
        f"wget -qO- --timeout=3 http://127.0.0.1:{port}{path} >/dev/null 2>&1 || "
        f"curl -sf --max-time 3 http://127.0.0.1:{port}{path} >/dev/null"
    )
    r = subprocess.run(
        ["kubectl", "exec", "-n", ns, f"deploy/{deploy_name}", "--", "sh", "-c", inner],
        capture_output=True,
        text=True,
        timeout=45,
    )
    return r.returncode == 0


def _dep_ready(
    dag: dict[str, Any],
    nodes: dict[str, Any],
    dep: str,
    cache: dict[str, tuple[bool, str]],
) -> tuple[bool, str]:
    if dep in cache:
        return cache[dep]
    cfg = nodes[dep]
    kind = cfg.get("kind", "deployment")
    ns = _ns_default(dag, cfg)
    name = str(cfg.get("name", dep))

    if kind == "external":
        tcp = str(cfg.get("tcp", "127.0.0.1:5441"))
        host, _, port_s = tcp.partition(":")
        port_s = port_s.lstrip(":")
        try:
            s = socket.create_connection((host, int(port_s)), timeout=3)
            s.close()
            cache[dep] = (True, "")
            return cache[dep]
        except OSError as e:
            cache[dep] = (False, f"{dep}: tcp {tcp} ({e})")
            return cache[dep]

    if kind == "statefulset":
        out, rc = _kubectl(
            [
                "get",
                "sts",
                name,
                "-n",
                ns,
                "-o",
                "jsonpath={.status.readyReplicas}/{.spec.replicas}",
            ]
        )
        if rc != 0:
            cache[dep] = (False, f"{dep}: sts/{name} missing in {ns}")
            return cache[dep]
        parts = out.split("/")
        if len(parts) == 2 and parts[0] == parts[1] and parts[0] not in ("", "0"):
            cache[dep] = (True, "")
            return cache[dep]
        cache[dep] = (False, f"{dep}: sts/{name} not fully ready ({out!r})")
        return cache[dep]

    # deployment
    out, rc = _kubectl(
        [
            "get",
            "deploy",
            name,
            "-n",
            ns,
            "-o",
            'jsonpath={.status.conditions[?(@.type=="Available")].status}',
        ]
    )
    if rc != 0 or out.strip() != "True":
        cache[dep] = (False, f"{dep}: Deploy/{name} not Available in {ns}")
        return cache[dep]
    if not _endpoints_have_addrs(ns, name):
        cache[dep] = (False, f"{dep}: Endpoints/{name} no addresses in {ns}")
        return cache[dep]
    hc = cfg.get("health")
    if isinstance(hc, dict):
        port = int(hc.get("port", 8080))
        hpath = str(hc.get("path", "/healthz"))
        if not _deployment_http_health(ns, name, port, hpath):
            cache[dep] = (False, f"{dep}: health HTTP not 200 ({hpath})")
            return cache[dep]
    cache[dep] = (True, "")
    return cache[dep]


def validate_dependency_dag(ns: str, repo: Path) -> dict[str, Any]:
    dag = _load_dag(repo)
    nodes: dict[str, Any] = dag["nodes"]
    violations: list[str] = []

    for n, cfg in nodes.items():
        for d in cfg.get("deps") or []:
            if d not in nodes:
                violations.append(f"node {n}: unknown dependency {d!r}")

    cyc = _detect_cycles(nodes)
    if cyc:
        return {
            "valid": False,
            "topological_order": [],
            "violations": violations + cyc,
            "formal": {
                "acyclic": False,
                "topological_sort_algorithm": "Kahn",
                "dependency_graph_nodes": len(nodes),
                "readiness_checked_in_topological_order": False,
            },
            "timestamp": int(time.time()),
            "housing_ns": ns,
        }

    order = _toposort(nodes)
    if order is None:
        return {
            "valid": False,
            "topological_order": [],
            "violations": violations + ["topological_sort_failed (cycle?)}"],
            "formal": {
                "acyclic": False,
                "topological_sort_algorithm": "Kahn",
                "dependency_graph_nodes": len(nodes),
                "readiness_checked_in_topological_order": False,
            },
            "timestamp": int(time.time()),
            "housing_ns": ns,
        }

    cache: dict[str, tuple[bool, str]] = {}
    for u in order:
        for d in nodes[u].get("deps") or []:
            ok, msg = _dep_ready(dag, nodes, d, cache)
            if not ok:
                violations.append(f"Dependency violation: {u} depends on {d} — {msg}")
        ok_u, msg_u = _dep_ready(dag, nodes, u, cache)
        if not ok_u:
            violations.append(f"Node not ready: {u} — {msg_u}")

    valid = len(violations) == 0
    formal = {
        "acyclic": valid,
        "topological_sort_algorithm": "Kahn",
        "dependency_graph_nodes": len(nodes),
        "readiness_checked_in_topological_order": valid,
    }
    return {
        "valid": valid,
        "topological_order": order,
        "violations": violations,
        "formal": formal,
        "timestamp": int(time.time()),
        "housing_ns": ns,
    }


def _artifact_drift_markers(ns: str, repo: Path) -> dict[str, Any]:
    """Fingerprint fields for cluster-doctor drift vs prior bootstrap."""
    out: dict[str, Any] = {}
    leaf_crt = repo / "certs" / "off-campus-housing.test.crt"
    if leaf_crt.is_file():
        r = subprocess.run(
            ["openssl", "x509", "-in", str(leaf_crt), "-noout", "-enddate"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if r.returncode == 0:
            line = (r.stdout or "").strip()
            m = re.search(r"notAfter=(.+)", line)
            out["leaf_not_after"] = m.group(1).strip() if m else line
    for sec_name in ("app-secrets", "och-service-tls", "och-kafka-ssl-secret"):
        rv, rc = _kubectl(
            ["get", "secret", sec_name, "-n", ns, "-o", "jsonpath={.metadata.resourceVersion}"]
        )
        if rc == 0 and (rv or "").strip():
            out[f"secret_rv_{sec_name}"] = rv.strip()
    return out


def _bootstrap_artifact_fields(ns: str, repo: Path) -> dict[str, Any]:
    ctx, _ = _kubectl(["config", "current-context"])
    rn, _ = _kubectl(["get", "nodes", "--no-headers"])
    node_lines = [x for x in (rn or "").splitlines() if x.strip()]
    kb = ready_rep = 0
    rk, rc = _kubectl(
        ["get", "sts", "kafka", "-n", ns, "-o", "jsonpath={.status.readyReplicas}/{.spec.replicas}"]
    )
    if rc == 0 and rk:
        parts = rk.split("/")
        if len(parts) >= 2 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
            ready_rep = int(parts[0].strip())
            kb = int(parts[1].strip())
        elif parts and parts[0].strip().isdigit():
            kb = int(parts[0].strip())
    colima_ip = None
    try:
        cs = subprocess.run(
            ["colima", "status"],
            capture_output=True,
            text=True,
            timeout=25,
        )
        if cs.returncode == 0:
            m = re.search(r"address:\s*([0-9.]+)", cs.stdout or "", re.I)
            if m:
                colima_ip = m.group(1)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {
        "kubectl_context": ctx or "unknown",
        "k8s_nodes": len(node_lines),
        "kafka_brokers": kb,
        "kafka_sts_ready_replicas": ready_rep,
        "colima_ip": colima_ip,
        "images_verified": True,
    }


def cmd_bootstrap(ns: str, repo: Path) -> int:
    bench = repo / "bench_logs"
    bench.mkdir(parents=True, exist_ok=True)
    health = compute_health(ns, repo)
    dag = validate_dependency_dag(ns, repo)

    (bench / "bootstrap-health.json").write_text(
        json.dumps(health, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (bench / "dependency-dag-validation.json").write_text(
        json.dumps(dag, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    art_path = bench / "bootstrap-artifact.json"
    art: dict[str, Any] = {}
    if art_path.is_file():
        try:
            art = json.loads(art_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            art = {}
    art.update(
        {
            "state": "BOOTSTRAP_COMPLETE",
            "housing_ns": ns,
            "bootstrap_health_score": health["score"],
            "bootstrap_health_max": health["max_score"],
            "dependency_dag_valid": dag["valid"],
            "timestamp_unix": health["timestamp_unix"],
        }
    )
    art.update(_bootstrap_artifact_fields(ns, repo))
    art.update(_artifact_drift_markers(ns, repo))
    art["state_contract"] = _bootstrap_state_contract(repo, ns)
    art_path.write_text(json.dumps(art, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    summary = {
        "bootstrap_health": health["score"],
        "bootstrap_health_max": health["max_score"],
        "dag_valid": dag["valid"],
        "points_below_max": health["points_below_max"],
        "deductions": health["deductions"],
        "integer_vs_float_score_delta": health["integer_vs_float_score_delta"],
        "sum_categories_raw_float": health["sum_categories_raw_float"],
        "warnings": health["warnings"],
        "category_breakdown": health["category_breakdown"],
    }
    print(json.dumps(summary, indent=2))
    print("", flush=True)
    print(health["summary_text"], flush=True)
    if not dag["valid"]:
        print("DAG violations:", flush=True)
        for v in dag.get("violations") or []:
            print(f"  - {v}", flush=True)
    if health["score"] < 90:
        print("❌ bootstrap-health: score < 90 — failing bootstrap", file=sys.stderr)
        return 2
    if not dag["valid"]:
        print("❌ dependency DAG invalid — failing bootstrap (violations listed above)", file=sys.stderr)
        return 2
    return 0


def _curl_edge(repo: Path, extra_args: list[str]) -> bool:
    host = os.environ.get("OCH_EDGE_HOSTNAME", "off-campus-housing.test")
    suite = os.environ.get("OCH_X_SUITE", "bash")
    ca = repo / "certs" / "dev-root.pem"
    if not ca.is_file():
        return False
    r = subprocess.run(
        [
            "curl",
            *extra_args,
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "8",
            "--max-time",
            "30",
            "--cacert",
            str(ca),
            "-H",
            "x-traffic-class: infra",
            "-H",
            f"x-suite: {suite}",
            f"https://{host}/api/readyz",
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    return r.returncode == 0


def _edge_http3_probe(repo: Path) -> bool:
    """Prefer scripts/verify-http3.sh (curl --http3 + http_version, alt-svc h3 fallback). Avoid --http3-only false negatives."""
    script = repo / "scripts" / "verify-http3.sh"
    if script.is_file():
        r = subprocess.run(
            ["bash", str(script)],
            cwd=str(repo),
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=120,
        )
        return r.returncode == 0
    return _curl_edge(repo, ["--http3"])


def _edge_transport(repo: Path) -> dict[str, Any]:
    return {
        "http2": _curl_edge(repo, ["--http2"]),
        "http3": _edge_http3_probe(repo),
    }


def _artifact_workspace_drift(repo: Path, art_prev: dict[str, Any]) -> list[str]:
    """Drift vs state_contract.workspace / infra captured at bootstrap."""
    drifts: list[str] = []
    sc = art_prev.get("state_contract")
    if not isinstance(sc, dict):
        return drifts
    ws = sc.get("workspace")
    if not isinstance(ws, dict):
        ws = {}
    lock = repo / "pnpm-lock.yaml"
    cur_hash = _sha256_file(lock) if lock.is_file() else ""
    art_hash = str(ws.get("pnpm_lock_sha256") or "")
    if art_hash and cur_hash and art_hash != cur_hash:
        drifts.append(
            f"workspace.pnpm_lock_sha256: artifact={art_hash[:14]}… live={cur_hash[:14]}…"
        )
    nv = _node_version_short()
    art_nv = str(ws.get("node_version") or "")
    if art_nv and nv and art_nv != nv:
        drifts.append(f"workspace.node_version: artifact={art_nv} live={nv}")
    kc = repo / "tools" / "kafka-contract" / "dist" / "index.js"
    present = kc.is_file() and kc.stat().st_size > 0
    if ws.get("kafka_contract_dist_present") is True and not present:
        drifts.append(
            "workspace.kafka_contract_dist_present: true at bootstrap, dist missing now"
        )
    ic = sc.get("infra")
    if isinstance(ic, dict):
        art_lb = str(ic.get("caddy_h3_lb_ip") or "")
        live_lb = _caddy_h3_lb_ip()
        if art_lb and live_lb and art_lb != live_lb:
            drifts.append(f"infra.caddy_h3_lb_ip: artifact={art_lb} live={live_lb}")
    return drifts


def _artifact_cluster_drift(ns: str, repo: Path, art_prev: dict[str, Any]) -> list[str]:
    """Drift vs top-level bootstrap-artifact cluster fingerprints."""
    drifts: list[str] = []
    rn, _ = _kubectl(["get", "nodes", "--no-headers"])
    live_nodes = len([x for x in (rn or "").splitlines() if x.strip()])
    stored_nodes = int(art_prev.get("k8s_nodes") or 0)
    if stored_nodes and live_nodes != stored_nodes:
        drifts.append(f"k8s_nodes: artifact={stored_nodes} live={live_nodes}")
    rk, rc = _kubectl(
        ["get", "sts", "kafka", "-n", ns, "-o", "jsonpath={.status.readyReplicas}"]
    )
    live_kb = int(rk.strip()) if rc == 0 and (rk or "").strip().isdigit() else -1
    stored_ready = int(art_prev.get("kafka_sts_ready_replicas") or art_prev.get("kafka_brokers") or 0)
    if stored_ready and live_kb >= 0 and live_kb != stored_ready:
        drifts.append(
            f"kafka_ready_replicas: artifact={stored_ready} live_sts_readyReplicas={live_kb}"
        )
    for sec_name in ("app-secrets", "och-service-tls", "och-kafka-ssl-secret"):
        h1, _ = _kubectl(
            ["get", "secret", sec_name, "-n", ns, "-o", "jsonpath={.metadata.resourceVersion}"]
        )
        h1 = (h1 or "").strip()
        key = f"secret_rv_{sec_name}"
        old_rv = str(art_prev.get(key) or "")
        if old_rv and h1 and old_rv != h1:
            drifts.append(f"secrets: {sec_name} resourceVersion changed ({old_rv} → {h1})")
        elif old_rv and not h1:
            drifts.append(f"secrets: {sec_name} missing (was rv {old_rv})")

    leaf_crt = repo / "certs" / "off-campus-housing.test.crt"
    if leaf_crt.is_file():
        r = subprocess.run(
            ["openssl", "x509", "-in", str(leaf_crt), "-noout", "-enddate"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if r.returncode == 0:
            line = (r.stdout or "").strip()
            exp = str(art_prev.get("leaf_not_after") or "")
            m = re.search(r"notAfter=(.+)", line)
            cur = m.group(1).strip() if m else line
            if exp and cur != exp:
                drifts.append(f"leaf_cert_expiry: artifact={exp!r} live={cur!r}")
    return drifts


def cmd_drift(ns: str, repo: Path) -> int:
    bench = repo / "bench_logs"
    bench.mkdir(parents=True, exist_ok=True)
    apath = bench / "bootstrap-artifact.json"
    if not apath.is_file():
        rep: dict[str, Any] = {
            "drift_detected": True,
            "drift_items": ["missing bench_logs/bootstrap-artifact.json"],
            "severity": "high",
            "timestamp_unix": int(time.time()),
        }
        (bench / "drift-detection.json").write_text(
            json.dumps(rep, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(json.dumps(rep, indent=2))
        return 1
    try:
        art_prev = json.loads(apath.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        rep = {
            "drift_detected": True,
            "drift_items": ["bootstrap-artifact.json is not valid JSON"],
            "severity": "high",
            "timestamp_unix": int(time.time()),
        }
        (bench / "drift-detection.json").write_text(
            json.dumps(rep, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(json.dumps(rep, indent=2))
        return 1

    items: list[str] = []
    if str(art_prev.get("state") or "") != "BOOTSTRAP_COMPLETE":
        items.append(
            f"artifact.state: expected BOOTSTRAP_COMPLETE got {art_prev.get('state')!r}"
        )
    items.extend(_artifact_workspace_drift(repo, art_prev))
    items.extend(_artifact_cluster_drift(ns, repo, art_prev))

    live_ctx = (_kubectl(["config", "current-context"])[0] or "").strip()
    stored_ctx = str(art_prev.get("kubectl_context") or "")
    if stored_ctx and live_ctx and stored_ctx != live_ctx:
        items.append(f"kubectl_context: artifact={stored_ctx} live={live_ctx}")

    sc = art_prev.get("state_contract")
    if isinstance(sc, dict):
        cl = sc.get("cluster")
        if isinstance(cl, dict):
            sg = str(cl.get("k8s_server_git_version") or "")
            live_sg = _kubectl_server_git_version()
            if sg and live_sg and sg != live_sg:
                items.append(
                    f"cluster.k8s_server_git_version: artifact={sg} live={live_sg}"
                )

    detected = len(items) > 0
    sev = "none"
    if detected:
        sev = (
            "high"
            if any("missing" in x or "secrets:" in x for x in items)
            else "medium"
        )
    rep = {
        "drift_detected": detected,
        "drift_items": items,
        "severity": sev,
        "bootstrap_artifact_timestamp": art_prev.get("timestamp_unix"),
        "timestamp_unix": int(time.time()),
    }
    (bench / "drift-detection.json").write_text(
        json.dumps(rep, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(rep, indent=2))
    if os.environ.get("DRIFT_WARN_ONLY", "") == "1":
        return 0
    return 1 if detected else 0


def cmd_doctor(repo: Path, strict: bool) -> int:
    bench = repo / "bench_logs"
    bench.mkdir(parents=True, exist_ok=True)
    ns = os.environ.get("HOUSING_NS", "off-campus-housing-tracker")

    prev: dict[str, Any] | None = None
    hp = bench / "bootstrap-health.json"
    if hp.is_file():
        try:
            prev = json.loads(hp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prev = None

    art_prev: dict[str, Any] | None = None
    apath = bench / "bootstrap-artifact.json"
    if apath.is_file():
        try:
            art_prev = json.loads(apath.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            art_prev = None

    live = compute_health(ns, repo)
    dag = validate_dependency_dag(ns, repo)
    transport = _edge_transport(repo)

    drift: list[str] = []
    if prev is not None:
        ps = int(prev.get("score", 0))
        if live["score"] != ps:
            drift.append(f"health_score: stored={ps} live={live['score']}")
        pc = prev.get("categories") or {}
        lc = live.get("categories") or {}
        if isinstance(pc, dict) and isinstance(lc, dict):
            for k in WEIGHTS:
                if pc.get(k) != lc.get(k):
                    drift.append(f"category[{k}]: stored={pc.get(k)} live={lc.get(k)}")

    if art_prev:
        drift.extend(_artifact_workspace_drift(repo, art_prev))
        drift.extend(_artifact_cluster_drift(ns, repo, art_prev))

    restart_warn: list[str] = []
    out, rc = _kubectl(["get", "pods", "-n", ns, "-o", "json"])
    if rc == 0:
        try:
            data = json.loads(out)
            for po in data.get("items") or []:
                name = po.get("metadata", {}).get("name", "")
                cnt = 0
                for cs in po.get("status", {}).get("containerStatuses") or []:
                    cnt = max(cnt, int(cs.get("restartCount", 0)))
                if cnt > 5:
                    restart_warn.append(f"{name}: restarts={cnt}")
        except json.JSONDecodeError:
            pass

    report = {
        "live_health": live,
        "previous_bootstrap_health": prev,
        "dependency_dag": dag,
        "drift": drift,
        "restart_warnings": restart_warn,
        "edge_transport": transport,
        "timestamp": int(time.time()),
    }
    (bench / "cluster-doctor.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    def line_ok(cat: str) -> str:
        mx = WEIGHTS[cat]
        v = int((live.get("categories") or {}).get(cat, 0))
        return "OK" if v >= mx else "DEGRADED"

    print("Cluster Doctor Report", flush=True)
    print("----------------------", flush=True)
    print(f"Housing NS: {ns}", flush=True)
    if prev:
        print(f"Stored bootstrap score: {prev.get('score', '?')}", flush=True)
    print(f"Live health score: {live['score']} / {live['max_score']}", flush=True)
    print(f"Control Plane: {line_ok('control_plane')}", flush=True)
    print(f"Kafka Quorum: {line_ok('infra')}", flush=True)
    print(f"Secrets: {line_ok('security')}", flush=True)
    img_mx = WEIGHTS["images"]
    img_v = int((live.get("categories") or {}).get("images", 0))
    if img_v >= img_mx:
        print("Images: OK", flush=True)
    else:
        miss = [f"{s}:dev" for s in _default_image_services() if not _docker_inspect(f"{s}:dev")]
        print(f"Images: MISSING {', '.join(miss) if miss else 'unknown'}", flush=True)
    print(f"Deployments: {line_ok('deployments')}", flush=True)
    print(f"Endpoints: {line_ok('endpoints')}", flush=True)
    h2 = "OK" if transport["http2"] else "FAIL"
    h3 = "OK" if transport["http3"] else "FAIL"
    print(f"Edge: HTTP/2 {h2}, HTTP/3 {h3}", flush=True)
    if restart_warn:
        print(f"Restarts: {len(restart_warn)} pods > 5 restarts (warning)", flush=True)
        for r in restart_warn[:10]:
            print(f"  - {r}", flush=True)
    print(f"DAG valid: {dag['valid']}", flush=True)
    if dag.get("violations"):
        for v in dag["violations"]:
            print(f"  - {v}", flush=True)
    if drift:
        print("Drift:", flush=True)
        for d in drift:
            print(f"  - {d}", flush=True)
    print(f"Overall Health: {live['score']} / {live['max_score']}", flush=True)

    if strict and live["score"] < 95:
        print("❌ CLUSTER_DOCTOR_STRICT: live score < 95", flush=True)
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("bootstrap", help="Health score + DAG; write artifacts")
    b.add_argument("--ns", default=os.environ.get("HOUSING_NS", "off-campus-housing-tracker"))
    b.add_argument("--repo", required=True)

    d = sub.add_parser("doctor", help="Cluster doctor (non-destructive)")
    d.add_argument("--repo", required=True)
    d.add_argument(
        "--strict",
        action="store_true",
        help="Exit 1 if live score < 95 (or CLUSTER_DOCTOR_STRICT=1)",
    )

    dr = sub.add_parser("drift", help="Compare live vs bench_logs/bootstrap-artifact.json")
    dr.add_argument("--repo", required=True)
    dr.add_argument("--ns", default=os.environ.get("HOUSING_NS", "off-campus-housing-tracker"))

    args = ap.parse_args()
    repo = Path(args.repo).resolve()

    if args.cmd == "bootstrap":
        return cmd_bootstrap(args.ns, repo)
    if args.cmd == "doctor":
        strict = args.strict or os.environ.get("CLUSTER_DOCTOR_STRICT", "") == "1"
        return cmd_doctor(repo, strict)
    if args.cmd == "drift":
        return cmd_drift(args.ns, repo)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
