# envoy-with-tcpdump

Envoy image with **tcpdump** for packet capture (rotation-suite, standalone capture, protocol tests). Same Envoy binary and config as the default image; only tcpdump is added.

## Build

From repo root:

```bash
docker build -t envoy-with-tcpdump:dev -f docker/envoy-with-tcpdump/Dockerfile .
```

k3d: load into cluster after build:

```bash
k3d image import envoy-with-tcpdump:dev -c off-campus-housing-tracker
```

## Deploy

After applying Envoy (`kubectl apply -k infra/k8s/base/envoy-test`), patch the deployment to use this image:

```bash
kubectl set image deployment/envoy-test -n envoy-test envoy=envoy-with-tcpdump:dev
kubectl patch deployment envoy-test -n envoy-test --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
```

Or run the one-shot setup (builds and patches Caddy + Envoy):

```bash
./scripts/setup-tls-and-edge.sh
```

## Why

The default `envoyproxy/envoy` image doesn’t include tcpdump. Packet-capture and rotation tests can install it at runtime, but that can time out. Using this image avoids runtime installs and keeps capture reliable.
