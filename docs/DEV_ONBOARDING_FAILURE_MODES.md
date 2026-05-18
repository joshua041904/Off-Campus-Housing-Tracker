# Dev onboard — failure mode matrix

When **`make dev-onboard`** (or **`make setup`**) exits non-zero, use this table. Edge checks use **curl/TLS**, not ICMP (ping may fail on macOS even when QUIC works).

| Phase / symptom | Likely cause | Recovery |
|-----------------|--------------|----------|
| **`apply-metallb-pool-colima.sh`** (during **`make up`**, strict) | Wrong subnet, API unreachable | Fix Colima/kubeconfig; run **`./scripts/colima-fix-kubeconfig-localhost.sh`**; set **`METALLB_POOL`** on VM subnet if auto-detect wrong |
| **`kafka-refresh-tls-from-lb` / wait-for-kafka-external-lb-ips** | MetalLB pending, missing Service | **`kubectl get svc -n off-campus-housing-tracker`**; **`make kafka-onboarding-reset`** then **`make apply-kafka-kraft`** |
| **`verify-kafka-dns`** | Stale EndpointSlice vs pod IP | **`make kafka-onboarding-reset`** → **`make apply-kafka-kraft`** |
| **`verify-kafka-cluster` — cluster.id mismatch** | Mixed PVC / split metadata | **`KAFKA_CLEAN_SLATE_CONFIRM=YES make kafka-clean-slate`** then **`make dev-onboard`** |
| **`verify-kafka-cluster` — leadership churn** | Unstable quorum, listener/TLS drift | **`make kafka-refresh-tls-from-lb`** → **`make apply-kafka-kraft`**; if persists see runbooks |
| **`verify-kafka-cluster` — TLS SAN** | LB IP rotated without refresh | Should be auto-fixed by staged apply; re-run **`make apply-kafka-kraft`** |
| **`wait-for-caddy-ip`** | **`caddy-h3`** not LoadBalancer or MetalLB stuck | **`kubectl -n ingress-nginx get svc caddy-h3`**; finish **`deploy-dev`** or fix pool |
| **`ensure-edge-hosts` (STRICT)** | Sudo denied, or resolver ≠ Caddy IP | Approve sudo; check **`dscacheutil` / DNS** overrides; set **`EXTERNAL_IP=`** if needed |
| **`verify-preflight-edge-routing`** | Ingress paths, app not Ready, bad TLS | **`kubectl get pods -n off-campus-housing-tracker`**; **`SKIP_STRICT_ENVELOPE=1 make deploy-dev`** |
| **Many Deployments `ImagePullBackOff`** (`*:dev` not on Docker Hub) | Images never built/loaded into the Colima VM after prune, or only a subset was built | From repo root: **`./scripts/rebuild-och-images-and-rollout.sh`** (or **`make images`** then **`kubectl rollout restart deployment/<name> -n off-campus-housing-tracker`** for each missing service). Same list as **`HOUSING_DOCKER_SERVICES_DEFAULT`** in **`scripts/lib/och-housing-docker-services-default.sh`**. |
| **Many app Deployments `CrashLoopBackOff`** (listings, booking, auth, …) while **Compose Postgres** is healthy | Pods use **`host.docker.internal`** / **`POSTGRES_URL_*`** to reach the host; on **Colima** that name must map to the **VM gateway** | **`docker compose up -d`** for DBs; then **`./scripts/colima-apply-host-aliases.sh`** (Colima kube context). Verify: **`./scripts/diagnose-502-and-analytics.sh`** |
| **`nginx` CrashLoop** (`unexpected "{"` in **`nginx.conf`**) | Unescaped **`{36}`** in a **`map`** regex (nginx 1.27 lexer) | Fixed in repo: **`infra/k8s/base/nginx/nginx.conf`** — use **`\\{36\\}`** in the map pattern; **`kubectl apply -k infra/k8s/base/nginx`**, then **`kubectl rollout restart deployment/nginx -n off-campus-housing-tracker`** |
| **`nginx` CrashLoop** (other) / **`nginx-exporter` Error** | OOM, bad config, or exporter init cannot reach **`nginx:8080/nginx_status`** | **`kubectl logs -n off-campus-housing-tracker deploy/nginx --tail=200`**; bump nginx memory in **`infra/k8s/base/nginx/deploy.yaml`** if OOM; after nginx is healthy, **`kubectl rollout restart deployment/nginx-exporter`** (delete stuck **`Error`** pods if needed) |
| **Phase 10 — PKIX / `SSL handshake failed` / one broker `CrashLoopBackOff`** | Mixed **`kafka.truststore.jks`** after partial broker restart | **`make kafka-heal-inter-broker-tls`** or see **`Runbook.md`** § Kafka KRaft inter-broker TLS |
| **`dev-onboard-lite` (CI)** | Script syntax, invalid kustomize, Makefile order drift | Fix PR; run **`make dev-onboard-lite`** locally |
| **`certify-production`** | Same as individual targets (transport lab / envelope need artifacts) | Run after perf lab data exists; see target chain in Makefile |

Related: **`docs/DEV_ONBOARDING.md`**, **`make diagnose`**, **`make verify`**.
