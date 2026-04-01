/**
 * ${ENV_PREFIX}.user.lifecycle.v1 — EventEnvelope + UserAccountDeletedV1 (proto/events).
 */
import protobuf from "protobufjs";
import { ochKafkaTopicIsolationSuffix } from "./kafka.js";
import { resolveProtoPath } from "./proto.js";

export const USER_ACCOUNT_DELETED_V1 = "user.account.deleted.v1";

let rootSingleton: protobuf.Root | null = null;

function getProtoRoot(): protobuf.Root {
  if (!rootSingleton) {
    rootSingleton = protobuf.loadSync([
      resolveProtoPath("events/envelope.proto"),
      resolveProtoPath("events/auth.proto"),
    ]) as protobuf.Root;
  }
  return rootSingleton;
}

export function userLifecycleV1Topic(): string {
  const override = process.env.USER_LIFECYCLE_TOPIC?.trim();
  if (override) return override;
  const p = process.env.ENV_PREFIX || "dev";
  return `${p}.user.lifecycle.v1${ochKafkaTopicIsolationSuffix()}`;
}

export type UserAccountDeletedPayload = {
  userId: string;
  deletionMode: string;
  gdprErasure: boolean;
  requestedBy: string;
  deletedAtIso: string;
  reason: string;
};

export function encodeUserAccountDeletedEnvelope(params: {
  eventId: string;
  payload: UserAccountDeletedPayload;
}): Buffer {
  const root = getProtoRoot();
  const UserAccountDeletedV1 = root.lookupType("events.auth.UserAccountDeletedV1");
  const EventEnvelope = root.lookupType("events.EventEnvelope");
  const p = params.payload;
  const inner = UserAccountDeletedV1.encode({
    user_id: p.userId,
    deletion_mode: p.deletionMode,
    gdpr_erasure: p.gdprErasure,
    requested_by: p.requestedBy,
    deleted_at: p.deletedAtIso,
    reason: p.reason,
  }).finish();
  const envBytes = EventEnvelope.encode({
    event_id: params.eventId,
    type: USER_ACCOUNT_DELETED_V1,
    version: 1,
    source: "auth-service",
    entity_id: p.userId,
    timestamp: p.deletedAtIso,
    payload: Buffer.from(inner),
  }).finish();
  return Buffer.from(envBytes);
}

export type DecodedUserAccountDeleted = {
  eventId: string;
  type: string;
  entityId: string;
  timestamp: string;
  userId: string;
  deletionMode: string;
  gdprErasure: boolean;
  requestedBy: string;
  deletedAt: string;
  reason: string;
};

/** Returns null if buffer is not a valid EventEnvelope or not user.account.deleted.v1. */
export function tryDecodeUserAccountDeletedEnvelope(buf: Buffer): DecodedUserAccountDeleted | null {
  try {
    const root = getProtoRoot();
    const EventEnvelope = root.lookupType("events.EventEnvelope");
    const UserAccountDeletedV1 = root.lookupType("events.auth.UserAccountDeletedV1");
    const decoded = EventEnvelope.decode(buf) as protobuf.Message & {
      event_id: string;
      type: string;
      entity_id: string;
      timestamp: string;
      payload: Uint8Array;
    };
    if (decoded.type !== USER_ACCOUNT_DELETED_V1) return null;
    const inner = UserAccountDeletedV1.decode(decoded.payload) as protobuf.Message & {
      user_id: string;
      deletion_mode: string;
      gdpr_erasure: boolean;
      requested_by: string;
      deleted_at: string;
      reason: string;
    };
    return {
      eventId: decoded.event_id,
      type: decoded.type,
      entityId: decoded.entity_id,
      timestamp: decoded.timestamp,
      userId: inner.user_id,
      deletionMode: inner.deletion_mode,
      gdprErasure: inner.gdpr_erasure,
      requestedBy: inner.requested_by,
      deletedAt: inner.deleted_at,
      reason: inner.reason,
    };
  } catch {
    return null;
  }
}
