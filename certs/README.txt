# TLS certs (place or generate here)
# - dev-root.pem, dev-root.key (CA)
# - off-campus-housing.local.crt, off-campus-housing.local.key (leaf for ingress)
# - envoy-client.crt, envoy-client.key (Envoy mTLS to backends)
# Kafka mTLS: run scripts/kafka-ssl-from-dev-root.sh (after reissue). Output: certs/kafka-ssl/ (keystore, truststore, ca-cert.pem). Creates kafka-ssl-secret in cluster.
