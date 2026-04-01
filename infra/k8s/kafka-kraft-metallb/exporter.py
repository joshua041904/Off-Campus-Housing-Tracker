#!/usr/bin/env python3
"""Expose kafka_metallb_advertised_lb_drift (0/1) by comparing kafka-N-external LB IP to EXTERNAL advert."""
from __future__ import annotations

import os
import re
import time

from kubernetes import client, config
from kubernetes.stream import stream
from prometheus_client import Gauge, start_http_server

NS = os.environ.get("HOUSING_NS", "off-campus-housing-tracker")
REPLICAS = int(os.environ.get("KAFKA_BROKER_REPLICAS", "3"))
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9108"))
INTERVAL = float(os.environ.get("KAFKA_ALIGNMENT_SCRAPE_INTERVAL_SEC", "30"))

g_match = Gauge(
    "kafka_external_listener_matches_lb",
    "1 if broker EXTERNAL advertised IPv4 equals kafka-N-external LoadBalancer IP",
    ["broker"],
)
g_drift = Gauge(
    "kafka_metallb_advertised_lb_drift",
    "1 if any broker has LB IPv4 set and it does not match EXTERNAL in advertised.listeners",
)
g_runtime_drift = Gauge(
    "kafka_runtime_config_drift",
    "1 if broker LB IPv4 missing, EXTERNAL advert missing, or LB != EXTERNAL (per broker)",
    ["broker"],
)


def external_ip_from_advertised(line: str) -> str:
    m = re.search(r"EXTERNAL://([0-9]+(?:\.[0-9]+){3}):9094", line)
    return m.group(1) if m else ""


def main() -> None:
    config.load_incluster_config()
    v1 = client.CoreV1Api()
    start_http_server(METRICS_PORT)
    while True:
        drift = 0
        for i in range(REPLICAS):
            svc_name = f"kafka-{i}-external"
            pod_name = f"kafka-{i}"
            lb_ip = ""
            try:
                s = v1.read_namespaced_service(name=svc_name, namespace=NS)
                ing = (s.status.load_balancer and s.status.load_balancer.ingress) or []
                if ing:
                    lb_ip = (ing[0].ip or "").strip()
            except client.exceptions.ApiException:
                pass

            adv_line = ""
            try:
                adv_line = stream(
                    v1.connect_get_namespaced_pod_exec,
                    pod_name,
                    NS,
                    container="kafka",
                    command=[
                        "grep",
                        "^advertised.listeners=",
                        "/etc/kafka/kafka.properties",
                    ],
                    stderr=True,
                    stdin=False,
                    stdout=True,
                    tty=False,
                )
            except client.exceptions.ApiException:
                adv_line = ""

            ext_ip = external_ip_from_advertised(adv_line or "")
            match = 0
            runtime_drift = 1
            if lb_ip and ext_ip and re.match(r"^[0-9.]+$", lb_ip):
                match = 1 if lb_ip == ext_ip else 0
                runtime_drift = 0 if lb_ip == ext_ip else 1
            elif not lb_ip or not re.match(r"^[0-9.]+$", lb_ip or ""):
                runtime_drift = 1
            elif not ext_ip:
                runtime_drift = 1
            if lb_ip and ext_ip and lb_ip != ext_ip:
                drift = 1
            g_match.labels(str(i)).set(match)
            g_runtime_drift.labels(str(i)).set(runtime_drift)

        g_drift.set(drift)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
