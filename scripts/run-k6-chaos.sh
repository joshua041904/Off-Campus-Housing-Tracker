#!/usr/bin/env bash
set -euo pipefail

NS="k6-load"
JOB_PREFIX="k6-chaos"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# CRITICAL: No QUIC connection reuse during rotation — avoids "context deadline exceeded" when Caddy pod restarts and k6 reuses stale QUIC sessions.
export K6_HTTP3_NO_REUSE="${K6_HTTP3_NO_REUSE:-1}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }

# Colima: host kubectl cannot reach 127.0.0.1:6443; use colima ssh so job/ns/configmap work.
# k3d: use host kubectl; k6 image must be imported into cluster (see image load below).
# Piping to "kubectl apply -f -" is consumed by shim's first (host) attempt, so write to file and apply -f file or pipe only when Colima.
ctx=$(kubectl config current-context 2>/dev/null || echo "")
_kubectl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || true
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || true
  fi
}

case "${1:-}" in
  start)
    _kubectl get ns "$NS" >/dev/null 2>&1 || _kubectl create ns "$NS" >/dev/null

    # Optional CPU/memory guardrail: avoid starting chaos when node is already saturated (single-node Colima).
    if [[ "${CHAOS_CPU_GUARDRAIL:-0}" == "1" ]]; then
      _node="$(_kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
      if [[ -n "$_node" ]]; then
        _top="$(_kubectl top node "$_node" --no-headers 2>/dev/null)"
        if [[ -n "$_top" ]]; then
          _cpu_pct="$(echo "$_top" | awk '{gsub(/%/,""); print $2}')"
          _mem_pct="$(echo "$_top" | awk '{gsub(/%/,""); print $4}')"
          if [[ -n "${_cpu_pct:-}" ]] && [[ "${_cpu_pct:-0}" -gt "${CHAOS_CPU_GUARDRAIL_PCT:-80}" ]]; then
            say "Node $_node CPU ${_cpu_pct}% > ${CHAOS_CPU_GUARDRAIL_PCT:-80}% — skipping chaos start (set CHAOS_CPU_GUARDRAIL=0 to override)"
            exit 0
          fi
          if [[ -n "${_mem_pct:-}" ]] && [[ "${_mem_pct:-0}" -gt "${CHAOS_MEM_GUARDRAIL_PCT:-85}" ]]; then
            say "Node $_node memory ${_mem_pct}% > ${CHAOS_MEM_GUARDRAIL_PCT:-85}% — skipping chaos start (set CHAOS_CPU_GUARDRAIL=0 to override)"
            exit 0
          fi
        fi
      fi
    fi

    # Build custom k6 image if it doesn't exist
    if ! docker images k6-custom:latest | grep -q k6-custom; then
      say "Building custom k6 image with debugging tools..."
      "$SCRIPT_DIR/build-k6-image.sh" || true
    fi

    # Cluster runs in a different environment than host Docker; make k6 image available so the job pod can run (avoids Pending).
    # Colima: cluster in VM; load image into VM. Uses docker when runtime=docker, nerdctl when runtime=containerd.
    # k3d: cluster in Docker nodes; import image into k3d so nodes can run it.
    if docker images k6-custom:latest 2>/dev/null | grep -q k6-custom; then
      if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
        say "Loading k6-custom:latest into Colima so the k6 job can run..."
        if docker save k6-custom:latest | colima ssh -- docker load 2>/dev/null; then
          : # loaded via docker (Colima runtime=docker)
        elif docker save k6-custom:latest | colima ssh -- sudo nerdctl load 2>/dev/null; then
          : # loaded via nerdctl (Colima runtime=containerd)
        else
          say "WARNING: Failed to load k6-custom:latest into Colima; k6 job may stay Pending."
        fi
      elif [[ "$ctx" == *"k3d"* ]] && command -v k3d >/dev/null 2>&1; then
        K3D_CLUSTER="${ctx#k3d-}"
        printf '\033[1mImporting k6-custom:latest into k3d cluster %s…\033[0m\n' "$K3D_CLUSTER" >&2
        if ! k3d image import k6-custom:latest -c "$K3D_CLUSTER"; then
          echo "ERROR: k3d image import failed; k6 job will stay Pending. Check: k3d cluster list; docker images k6-custom:latest" >&2
          exit 1
        fi
      fi
    else
      if [[ "$ctx" == *"k3d"* ]] || [[ "$ctx" == *"colima"* ]]; then
        echo "ERROR: k6-custom:latest not found on host; cluster cannot run the job (pod will stay Pending). Run: $SCRIPT_DIR/build-k6-image.sh" >&2
        exit 1
      fi
    fi

    # Script: K6_HTTP2_ONLY=1 = no xk6-http3 (avoids exit 107 when image lacks extension).
    # K6_USE_JSLIB=1 = jslib (requires egress to jslib.k6.io).
    if [[ "${K6_HTTP2_ONLY:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/k6-chaos-http2-only.js" ]]; then
      K6_SCRIPT="$SCRIPT_DIR/k6-chaos-http2-only.js"
      K6_SCRIPT_NAME="k6-chaos-http2-only.js"
      say "Using HTTP/2-only script (K6_HTTP2_ONLY=1; no xk6-http3)"
    elif [[ "${K6_USE_JSLIB:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/k6-chaos-test-jslib.js" ]]; then
      K6_SCRIPT="$SCRIPT_DIR/k6-chaos-test-jslib.js"
      K6_SCRIPT_NAME="k6-chaos-test-jslib.js"
      say "Using jslib summary (K6_USE_JSLIB=1; pod needs egress to jslib.k6.io)"
    else
      K6_SCRIPT="$SCRIPT_DIR/k6-chaos-test.js"
      K6_SCRIPT_NAME="k6-chaos-test.js"
    fi
    _kubectl -n "$NS" create configmap k6-chaos-script \
      --from-file="$K6_SCRIPT_NAME=$K6_SCRIPT" \
      --dry-run=client -o yaml | _kubectl -n "$NS" apply -f - >/dev/null 2>&1

    # Ensure pods mount fresh script: verify ConfigMap contains current logic (empty-proto guard for H3)
    if [[ "$K6_SCRIPT_NAME" == "k6-chaos-test.js" ]]; then
      if ! _kubectl -n "$NS" get configmap k6-chaos-script -o yaml 2>/dev/null | grep -q 'empty proto'; then
        say "WARNING: ConfigMap k6-chaos-script may not have current script (no 'empty proto' guard). Delete and re-run: kubectl -n $NS delete configmap k6-chaos-script; kubectl -n $NS delete job --all; then ./run-k6-chaos.sh start"
      else
        say "Script version OK (ConfigMap contains 'empty proto' guard)"
      fi
    fi

    TS=$(date +%s)
    JOB="$JOB_PREFIX-$TS"
    SCRIPT_HASH=""
    if command -v sha256sum >/dev/null 2>&1; then
      SCRIPT_HASH="$(sha256sum "$K6_SCRIPT" 2>/dev/null | cut -d' ' -f1 | cut -c1-12)"
    elif command -v shasum >/dev/null 2>&1; then
      SCRIPT_HASH="$(shasum -a 256 "$K6_SCRIPT" 2>/dev/null | cut -d' ' -f1 | cut -c1-12)"
    fi

    # Mount CA certificate for strict TLS verification
    # The CA ConfigMap is created by the rotation/caller script BEFORE calling this script
    # CRITICAL: After CA rotation, ConfigMap MUST be updated from the NEW CA (certs/dev-root.pem)
    # or k6 will fail with x509 "certificate signed by unknown authority" before sending any requests (exit 99, 0 requests)
    CA_CONFIGMAP="${CA_CONFIGMAP:-k6-ca-cert}"

    # Pre-flight: verify CA ConfigMap exists and has ca.crt data (avoids Job starting then failing immediately)
    if ! _kubectl -n "$NS" get configmap "$CA_CONFIGMAP" -o jsonpath='{.data.ca\.crt}' 2>/dev/null | grep -q 'BEGIN CERTIFICATE'; then
      echo "ERROR: ConfigMap $CA_CONFIGMAP missing or ca.crt empty/invalid. Create from rotated CA:" >&2
      echo "  kubectl -n $NS create configmap $CA_CONFIGMAP --from-file=ca.crt=certs/dev-root.pem --dry-run=client -o yaml | kubectl apply -f -" >&2
      echo "After CA rotation, the caller MUST update k6-ca-cert from the NEW certs/dev-root.pem." >&2
      exit 1
    fi
    say "CA ConfigMap $CA_CONFIGMAP OK (PEM verified)"

    # Single-node Colima: lower starting rate (200 combined) to avoid control-plane saturation; set CHAOS_LOW_START_RATE=1.
    if [[ "${CHAOS_LOW_START_RATE:-0}" == "1" ]]; then
      H2_RATE="${H2_RATE:-120}"
      H3_RATE="${H3_RATE:-80}"
    else
      H2_RATE="${H2_RATE:-80}"
      H3_RATE="${H3_RATE:-40}"
    fi

    # Write job YAML to temp file so Colima path can cat file | colima ssh kubectl apply -f -
    # (piping to kubectl is consumed by shim's first attempt on host, leaving colima ssh with empty stdin)
    JOB_YAML=$(mktemp)
    trap 'rm -f "$JOB_YAML"' EXIT
    cat <<EOF > "$JOB_YAML"
apiVersion: batch/v1
kind: Job
metadata:
  name: $JOB
  annotations:
    script: "$K6_SCRIPT_NAME"
    script-hash: "${SCRIPT_HASH:-unknown}"
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: k6
        image: k6-custom:latest
        imagePullPolicy: Never
        # Fail fast if CA missing (exit 98) vs TLS/script errors (99). k6 uses SSL_CERT_FILE for strict TLS.
        # Exit 98 = mount/config; 99 = k6 threshold or script; 107 = OOM or module load.
        command: ["/bin/sh", "-c", "set -e; echo '=== k6 CA preflight ==='; ls -la \$SSL_CERT_FILE 2>/dev/null || { echo 'FATAL: CA file not found - check k6-ca-cert ConfigMap and volumeMount subPath:ca.crt'; exit 98; }; test -s \$SSL_CERT_FILE || { echo 'FATAL: CA file empty'; exit 98; }; head -1 \$SSL_CERT_FILE | grep -q 'BEGIN CERTIFICATE' || { echo 'FATAL: CA not valid PEM'; exit 98; }; echo 'CA OK, starting k6...'; exec k6 run /scripts/$K6_SCRIPT_NAME"]
        resources:
          requests: { memory: "256Mi", cpu: "100m" }
          limits:   { memory: "1Gi",   cpu: "1000m" }
        env:
        - name: HOST
          value: "${HOST:-off-campus-housing.local}"
        - name: DURATION
          value: "${DURATION:-180s}"
        - name: SSL_CERT_FILE
          value: "/etc/ssl/certs/ca.crt"
        - name: H2_RATE
          value: "$H2_RATE"
        - name: H2_PRE_VUS
          value: "${H2_PRE_VUS:-20}"
        - name: H2_MAX_VUS
          value: "${H2_MAX_VUS:-160}"
        - name: H3_RATE
          value: "$H3_RATE"
        - name: H3_PRE_VUS
          value: "${H3_PRE_VUS:-10}"
        - name: H3_MAX_VUS
          value: "${H3_MAX_VUS:-100}"
        - name: DB_HOST
          value: "${DB_HOST:-host.docker.internal}"
        - name: DB_PORT
          value: "${DB_PORT:-5433}"
        - name: DB_USER
          value: "${DB_USER:-postgres}"
        - name: DB_PASSWORD
          value: "${DB_PASSWORD:-postgres}"
        - name: DB_NAME
          value: "${DB_NAME:-records}"
        - name: K6_HTTP3_NO_REUSE
          value: "${K6_HTTP3_NO_REUSE:-1}"
        - name: K6_H3_TIMEOUT
          value: "${K6_H3_TIMEOUT:-30s}"
        - name: K6_SUMMARY_PATH
          value: "${K6_SUMMARY_PATH:-/tmp/transport-summary.json}"
        volumeMounts:
        - name: scripts
          mountPath: /scripts
        - name: ca-cert
          mountPath: /etc/ssl/certs/ca.crt
          subPath: ca.crt
          readOnly: true
      volumes:
      - name: scripts
        configMap:
          name: k6-chaos-script
      - name: ca-cert
        configMap:
          name: $CA_CONFIGMAP
EOF
    APPLY_ERR=$(mktemp)
    if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
      cat "$JOB_YAML" | colima ssh -- kubectl -n "$NS" apply -f - >/dev/null 2>"$APPLY_ERR"
    else
      kubectl -n "$NS" apply -f "$JOB_YAML" >/dev/null 2>"$APPLY_ERR"
    fi
    APPLY_RC=$?
    if [[ $APPLY_RC -ne 0 ]]; then
      echo "kubectl apply failed (exit $APPLY_RC):" >&2
      [[ -s "$APPLY_ERR" ]] && cat "$APPLY_ERR" >&2
      rm -f "$APPLY_ERR"
      exit 1
    fi
    rm -f "$APPLY_ERR"

    # Wait for pod to be Ready so CA mount is available before k6 runs (avoids race: ConfigMap created but mount not ready).
    # Jobs: pod gets label job-name=$JOB. Ready implies container started and volumes mounted.
    say "Waiting for k6 pod to be Ready (CA mount)…"
    if _kubectl -n "$NS" wait --for=condition=Ready pod -l "job-name=$JOB" --timeout=60s 2>/dev/null; then
      : # pod ready, proceed
    else
      say "Pod wait skipped or timed out; k6 may fail if CA not mounted (check: kubectl -n $NS describe pod -l job-name=$JOB)"
    fi

    # Output ONLY the job name (no extra text)
    echo "$JOB"
    ;;

  wait)
    JOB="${2:?missing job name}"
    TIMEOUT="${3:-480s}"

    say "Waiting for job $JOB to complete (timeout $TIMEOUT)…"

    _kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout="$TIMEOUT"

    ;;

  collect)
    JOB="${2:?missing job name}"
    OUT="/tmp/${JOB}-results.json"

    _kubectl -n "$NS" logs "job/$JOB" > "$OUT"

    echo "$OUT"
    ;;

  local)
    # Run k6 on host with SSLKEYLOGFILE (for ROTATION_H2_KEYLOG=1 → decrypted HTTP/2 frames in tshark)
    # Prefer xk6-built binary (.k6-build/k6-http3 or .xk6-build) with HTTP/3; fallback to HTTP/2-only script
    # Exports ROTATION_SSLKEYLOG for verify-k6-protocols.sh
    REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
    CA="$REPO_ROOT/certs/dev-root.pem"
    [[ ! -f "$CA" ]] && { echo "ERROR: CA not found: $CA (k6 strict TLS requires certs/dev-root.pem — run rotation or preflight sync)" >&2; exit 1; }
    [[ ! -s "$CA" ]] && { echo "ERROR: CA file empty: $CA" >&2; exit 1; }
    grep -q 'BEGIN CERTIFICATE' "$CA" 2>/dev/null || { echo "ERROR: CA not valid PEM: $CA" >&2; exit 1; }
    # Resolve to absolute path
    CA="$(cd "$(dirname "$CA")" && pwd)/$(basename "$CA")"
    # macOS: Go ignores SSL_CERT_FILE; k6 uses Keychain for cert verification. Must add CA to keychain.
    if [[ "$(uname -s)" == "Darwin" ]] && [[ -f "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" ]]; then
      if ! "$SCRIPT_DIR/lib/trust-dev-root-ca-macos.sh" "$CA"; then
        echo "ERROR: On macOS, k6 cannot verify off-campus-housing.local without the CA in the keychain (Go ignores SSL_CERT_FILE)." >&2
        echo "  Run once: ./scripts/lib/trust-dev-root-ca-macos.sh" >&2
        echo "  Or: ROTATION_H2_KEYLOG=0 to use in-cluster k6 (no SSLKEYLOGFILE for wire decryption)." >&2
        exit 1
      fi
    fi
    # Prefer xk6-built k6 with HTTP/3 extension
    K6_BIN=""
    for cand in "${ROTATION_K6_BIN:-}" "${K6_BIN:-}" "$REPO_ROOT/.k6-build/k6-http3" "$REPO_ROOT/.k6-build/bin/k6-http3" "$REPO_ROOT/.xk6-build/k6-http3" "$REPO_ROOT/.xk6-build/bin/k6-http3"; do
      [[ -z "$cand" ]] && continue
      if [[ -x "$cand" ]]; then K6_BIN="$cand"; break; fi
    done
    [[ -z "$K6_BIN" ]] && K6_BIN="k6"  # fallback to PATH
    KEYLOG="${ROTATION_SSLKEYLOG:-/tmp/rotation-sslkey-$$.log}"
    export ROTATION_SSLKEYLOG="$KEYLOG"
    [[ ! -f "$KEYLOG" ]] && : > "$KEYLOG"  # Create once; subsequent iterations append
    say "Running k6 locally with SSLKEYLOGFILE=$KEYLOG (for decrypted HTTP/2 frames)"
    H2_RATE="${H2_RATE:-320}"
    H3_RATE="${H3_RATE:-180}"
    DURATION="${DURATION:-90s}"
    K6_TARGET="${K6_TARGET_URL:-https://off-campus-housing.local:30443/_caddy/healthz}"
    export HOST H2_RATE H3_RATE DURATION K6_TARGET_URL="$K6_TARGET" \
      K6_RESOLVE K6_LB_IP \
      SSL_CERT_FILE="$CA" SSLKEYLOGFILE="$KEYLOG" \
      H2_PRE_VUS="${H2_PRE_VUS:-80}" H2_MAX_VUS="${H2_MAX_VUS:-300}" \
      H3_PRE_VUS="${H3_PRE_VUS:-200}" H3_MAX_VUS="${H3_MAX_VUS:-600}"
    if [[ "$K6_BIN" == "k6" ]] && ! command -v k6 >/dev/null 2>&1; then
      echo "ERROR: k6 not in PATH. Build xk6-http3: ./scripts/build-k6-http3.sh (produces .k6-build/k6-http3)" >&2
      exit 1
    fi
    # Full script (H2+H3) when xk6 binary; else HTTP/2-only for vanilla k6
    # K6_HTTP2_ONLY=1: use h2-only (e.g. NodePort fallback — HTTP/3 requires MetalLB)
    K6_SCRIPT="${2:-$SCRIPT_DIR/k6-chaos-test.js}"
    if [[ "${K6_HTTP2_ONLY:-0}" == "1" ]] && [[ -f "$SCRIPT_DIR/k6-chaos-http2-only.js" ]]; then
      K6_SCRIPT="$SCRIPT_DIR/k6-chaos-http2-only.js"
      say "Using HTTP/2-only (K6_HTTP2_ONLY=1; no MetalLB LB IP for H3)"
    elif [[ "$K6_BIN" == "k6" ]]; then
      K6_SCRIPT="$SCRIPT_DIR/k6-chaos-http2-only.js"
    fi
    [[ ! -f "$K6_SCRIPT" ]] && K6_SCRIPT="$SCRIPT_DIR/k6-chaos-test.js"
    [[ ! -f "$K6_SCRIPT" ]] && K6_SCRIPT="$SCRIPT_DIR/k6-chaos-http2-only.js"
    [[ ! -f "$K6_SCRIPT" ]] && { echo "ERROR: k6 script not found" >&2; exit 1; }
    [[ "$K6_BIN" != "k6" ]] && say "Using xk6-built k6: $K6_BIN"
    "$K6_BIN" run "$K6_SCRIPT" || exit $?
    echo "ROTATION_SSLKEYLOG=$KEYLOG"
    ;;

  *)
    echo "Usage: $0 {start|wait|collect|local}"
    exit 1
    ;;
esac
