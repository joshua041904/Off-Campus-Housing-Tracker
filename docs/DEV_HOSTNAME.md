# Dev hostname: `off-campus-housing.test`

The platform uses **`https://off-campus-housing.test`** for the public edge (Caddy SNI, leaf cert SAN, k6/curl strict TLS, WebAuthn `rp.id`).

## Why `.test` and not `.local`?

- **`.local`** is special on macOS (mDNS / Bonjour). Name resolution and Go’s resolver can behave inconsistently for load generators and browsers.
- **`.test`** is reserved (RFC 6761) and resolves only via DNS you control — typically **`/etc/hosts`** — so behavior is predictable.

## `/etc/hosts` (MetalLB VIP)

After you know the MetalLB IP for `caddy-h3` (e.g. `192.168.64.240`):

```text
192.168.64.240 off-campus-housing.test
```

Re-run after the VIP changes (e.g. new Colima/k3s bring-up).

## Regenerating TLS material

If you still have leaf files named `off-campus-housing.local.*`, regenerate so SANs match:

```bash
./scripts/dev-generate-certs.sh
# or your full reissue path: ./scripts/reissue-ca-and-leaf-load-all-services.sh
```

Then sync secrets / Caddy mounts per `docs/TLS-AND-EDGE-SETUP.md`.
