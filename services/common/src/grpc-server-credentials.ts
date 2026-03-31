/**
 * OCH strict mTLS: gRPC server always uses TLS + required client certificates.
 * Mounts: /etc/certs/tls.crt (leaf only), tls.key, ca.crt (issuing CA / dev-root).
 * No plaintext fallback — missing files fail fast at startup.
 */
import * as fs from "fs";
import * as grpc from "@grpc/grpc-js";

const defaultKey = "/etc/certs/tls.key";
const defaultCert = "/etc/certs/tls.crt";
const defaultCa = "/etc/certs/ca.crt";

/**
 * Production: strict mTLS (same as {@link createOchStrictMtlsServerCredentials}).
 * Local/CI integration: if **OCH_GRPC_INSECURE_TEST_BIND=1** and **NODE_ENV** is not **production**,
 * binds with **grpc.ServerCredentials.createInsecure()** so `@grpc/grpc-js` clients can call the real
 * proto surface without mounting `/etc/certs`. Never set the env flag in real clusters.
 */
export function createOchGrpcServerCredentialsForBind(label: string): grpc.ServerCredentials {
  const on =
    process.env.OCH_GRPC_INSECURE_TEST_BIND === "1" ||
    process.env.OCH_GRPC_INSECURE_TEST_BIND === "true";
  if (on && process.env.NODE_ENV !== "production") {
    console.warn(
      `[${label}] OCH_GRPC_INSECURE_TEST_BIND: insecure gRPC bind (tests only; NODE_ENV=${process.env.NODE_ENV ?? "(unset)"})`,
    );
    return grpc.ServerCredentials.createInsecure();
  }
  const creds = createOchStrictMtlsServerCredentials(label);
  console.log(`[${label}] strict mTLS (client cert required)`);
  return creds;
}

export function createOchStrictMtlsServerCredentials(
  label = "gRPC"
): grpc.ServerCredentials {
  const keyPath = process.env.TLS_KEY_PATH || defaultKey;
  const certPath = process.env.TLS_CERT_PATH || defaultCert;
  const caPath =
    process.env.TLS_CA_PATH || process.env.GRPC_CA_CERT || defaultCa;

  for (const [name, p] of [
    ["TLS_KEY_PATH", keyPath],
    ["TLS_CERT_PATH", certPath],
    ["TLS_CA_PATH", caPath],
  ] as const) {
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      throw new Error(
        `[${label}] Strict mTLS requires non-empty ${name} file at ${p} (no insecure fallback)`
      );
    }
  }

  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  const rootCerts = fs.readFileSync(caPath);

  return grpc.ServerCredentials.createSsl(
    rootCerts,
    [{ private_key: key, cert_chain: cert }],
    true
  );
}
