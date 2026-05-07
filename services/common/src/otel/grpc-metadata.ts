import type { TextMapGetter, TextMapSetter } from "@opentelemetry/api";
import type * as grpc from "@grpc/grpc-js";

export function grpcMetadataGetter(): TextMapGetter<grpc.Metadata> {
  return {
    get(carrier, key) {
      const values = carrier.get(key);
      if (!values.length) return undefined;
      return values
        .map((v) => (typeof v === "string" ? v : Buffer.isBuffer(v) ? v.toString("utf8") : String(v)))
        .join(",");
    },
    keys(carrier) {
      return Object.keys(carrier.getMap());
    },
  };
}

export function grpcMetadataSetter(): TextMapSetter<grpc.Metadata> {
  return {
    set(carrier, key, value) {
      carrier.set(key, value);
    },
  };
}
