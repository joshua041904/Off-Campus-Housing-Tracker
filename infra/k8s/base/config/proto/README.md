# Proto files for K8s ConfigMap

These files are **synced from the repo root [proto/](../../../../proto/)**. The source of truth is the root `proto/` directory.

After changing any `.proto` in the repo root, update this folder so the `proto-files` ConfigMap stays in sync:

```bash
# From repo root
cp proto/common.proto proto/health.proto proto/auth.proto proto/listings.proto \
   proto/booking.proto proto/messaging.proto proto/notification.proto proto/trust.proto \
   proto/analytics.proto infra/k8s/base/config/proto/
```

Then re-apply the config (e.g. `kubectl apply -k infra/k8s/base/config` or your overlay).
