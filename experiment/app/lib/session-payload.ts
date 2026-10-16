/**
 * Lossless database/export JSON helpers. Payloads are deliberately not
 * migrated here so records from earlier experiment versions remain readable.
 */
function assertLosslessJsonValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`${path} contains a number that JSON cannot preserve.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains a non-JSON value.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-plain object.`);
    }
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
      throw new TypeError(`${path} contains a symbol key.`);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    assertLosslessJsonValue(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function serializeStudySessionPayload(session: unknown): string {
  assertLosslessJsonValue(session, "session", new WeakSet());
  return JSON.stringify(session);
}

export function parseStudySessionPayload(payloadJson: string): unknown {
  return JSON.parse(payloadJson) as unknown;
}
