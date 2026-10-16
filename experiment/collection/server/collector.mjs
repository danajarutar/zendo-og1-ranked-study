import { validateCheckpointRequest, validateSessionProgression, MAX_CHECKPOINT_BODY_BYTES } from "../../app/lib/checkpoint-contract.ts";
import { COLLECTION_EXPERIMENT_VERSION } from "../../app/lib/experiment.ts";
import { participantPattern, tokenPattern } from "../src/client.mjs";
import { encryptArchive, sha256, base64 } from "./crypto.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const checkpointKey = sequence => `checkpoint:${String(sequence).padStart(12, "0")}`;

export class Collector {
  constructor(storage, env, fetcher = (...args) => globalThis.fetch(...args)) { this.storage = storage; this.env = env; this.fetcher = fetcher; }
  async readBody(request, maximum = MAX_CHECKPOINT_BODY_BYTES) {
    if (Number(request.headers.get("Content-Length")) > maximum) fail("Zapis je prevelik.", 413);
    const reader = request.body?.getReader();
    if (!reader) fail("Manjka vsebina.");
    let total = 0;
    const chunks = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); fail("Zapis je prevelik.", 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(body);
  }
  async authenticate(request) {
    const participant = request.headers.get("X-Participant") || "";
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
    if (!participantPattern.test(participant) || !tokenPattern.test(token)) fail("Neveljavna osebna povezava.", 401);
    const registration = await this.storage.get(`participant:${participant}`);
    if (!registration || registration.token_hash !== await sha256(token) || registration.revoked) fail("Osebna povezava ni aktivna.", 401);
    return { participant, registration };
  }
  async handle(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/admin/")) {
        const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
        if (!this.env.ADMIN_TOKEN || !supplied || await sha256(supplied) !== await sha256(this.env.ADMIN_TOKEN)) fail("Unauthorized", 401);
        return await this.admin(request, url);
      }
      const { participant, registration } = await this.authenticate(request);
      const state = await this.storage.get(`session:${participant}`);
      if (request.method === "GET" && url.pathname === "/participant") return json({ variant: registration.variant, session_id: state?.session.session_id ?? null, writer: state?.writer ?? null, revision: state?.revision ?? 0, status: state?.session.status ?? "new", archived_revision: state?.archived_revision ?? 0 });
      if (request.method !== "POST" || url.pathname !== "/checkpoint") return json({ error: "Not found" }, 404);
      const writer = request.headers.get("X-Writer") || "";
      if (!/^[a-f0-9-]{36}$/.test(writer)) fail("Neveljaven brskalnik.");
      const raw = await this.readBody(request);
      let checkpoint;
      try { checkpoint = validateCheckpointRequest(JSON.parse(raw)); }
      catch { fail("Neveljaven zapis odgovorov.", 422); }
      if (checkpoint.session.experiment_version !== COLLECTION_EXPERIMENT_VERSION || checkpoint.session.participant_code !== participant || checkpoint.session.variant !== registration.variant || checkpoint.session.language !== "sl") fail("Identiteta se ne ujema.", 403);
      const digest = await sha256(raw);
      const receipt = await this.storage.transaction(async tx => {
        const duplicate = await tx.get(`id:${checkpoint.checkpoint_id}`);
        if (duplicate) {
          if (duplicate.digest !== digest || duplicate.participant !== participant) fail("Nasprotujoč ponovljen zapis.", 409);
          return duplicate.receipt;
        }
        const previous = await tx.get(`session:${participant}`);
        if (previous) {
          if (previous.writer !== writer || previous.session.session_id !== checkpoint.session.session_id) fail("Povezava že pripada drugi seji ali brskalniku.", 409);
          if (checkpoint.checkpoint_revision !== previous.revision + 1) fail("Napačen vrstni red shranjevanja.", 409);
          try { validateSessionProgression(previous.session, checkpoint.session); }
          catch { fail("Zapis bi spremenil že shranjene odgovore.", 409); }
        } else if (checkpoint.checkpoint_type !== "session_started" || checkpoint.checkpoint_revision !== 1) fail("Manjka začetni zapis.", 409);
        const sequence = (await tx.get("sequence") || 0) + 1;
        const result = { received: true, checkpoint_id: checkpoint.checkpoint_id, session_id: checkpoint.session.session_id, revision: checkpoint.checkpoint_revision, received_at: new Date().toISOString(), archived: false };
        await tx.put("sequence", sequence);
        await tx.put(checkpointKey(sequence), { sequence, received_at: result.received_at, checkpoint });
        await tx.put(`id:${checkpoint.checkpoint_id}`, { digest, participant, receipt: result });
        await tx.put(`session:${participant}`, { session: checkpoint.session, revision: checkpoint.checkpoint_revision, writer, archived_revision: previous?.archived_revision ?? 0 });
        return result;
      });
      if (!await this.storage.getAlarm()) await this.storage.setAlarm(Date.now() + 60_000);
      return json(receipt);
    } catch (error) { return json({ error: error.status ? error.message : "Sprejem trenutno ni na voljo. Poskusite znova." }, error.status || 503); }
  }
  async admin(request, url) {
    if (request.method === "POST" && url.pathname === "/admin/register") {
      const body = JSON.parse(await this.readBody(request));
      if (!Array.isArray(body.participants) || body.participants.length > 200 || !body.participants.length) fail("Expected 1–200 participants.");
      for (const record of body.participants) if (!participantPattern.test(record.participant) || !tokenPattern.test(record.token_hash) || !["adult", "child"].includes(record.variant)) fail("Invalid registration.");
      await this.storage.transaction(async tx => {
        for (const record of body.participants) {
          const key = `participant:${record.participant}`;
          const existing = await tx.get(key);
          if (existing && JSON.stringify(existing) !== JSON.stringify(record)) fail("Participant already exists.", 409);
          await tx.put(key, record);
        }
      });
      return json({ registered: body.participants.length });
    }
    if (request.method === "GET" && url.pathname === "/admin/status") {
      const sessions = await this.storage.list({ prefix: "session:" });
      return json({ environment: this.env.ENVIRONMENT, received_checkpoints: await this.storage.get("sequence") || 0, archived_through: await this.storage.get("archivedThrough") || 0, archive_error: await this.storage.get("archiveError") || null, sessions: [...sessions.values()].map(value => ({ participant: value.session.participant_code, session_id: value.session.session_id, status: value.session.status, received_revision: value.revision, archived_revision: value.archived_revision })) });
    }
    if (request.method === "GET" && url.pathname === "/admin/export") {
      const maximum = await this.storage.get("sequence") || 0;
      const snapshot = url.searchParams.has("snapshot") ? Number(url.searchParams.get("snapshot")) : maximum;
      const after = Number(url.searchParams.get("after") || 0);
      if (!Number.isSafeInteger(snapshot) || !Number.isSafeInteger(after) || after < 0 || snapshot < after || snapshot > maximum) fail("Invalid export cursor.");
      const rows = await this.storage.list({ prefix: "checkpoint:", startAfter: checkpointKey(after), end: checkpointKey(snapshot + 1), limit: 10 });
      const records = [...rows.values()];
      const cursor = records.at(-1)?.sequence ?? after;
      return json({ format: "zendo-og1-ranked-checkpoints-v1", environment: this.env.ENVIRONMENT, snapshot, records, next: cursor < snapshot ? cursor : null });
    }
    if (request.method === "POST" && url.pathname === "/admin/archive") { await this.archive(); return json({ archived_through: await this.storage.get("archivedThrough") || 0 }); }
    return json({ error: "Not found" }, 404);
  }
  async github(path, options = {}) {
    const response = await this.fetcher(`https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}${path}`, { ...options, headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "zendo-og1-ranked-collector", ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
    if ([403, 429].includes(response.status)) {
      const retrySeconds = Number(response.headers.get("Retry-After"));
      const reset = response.headers.get("X-RateLimit-Remaining") === "0" ? Number(response.headers.get("X-RateLimit-Reset")) * 1000 : 0;
      const error = new Error(`GitHub access/rate limit (${response.status}); archive retained for retry.`);
      error.retryAt = Math.max(Date.now() + 60_000, reset || 0, Date.now() + (Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0));
      throw error;
    }
    return response;
  }
  async archive() {
    if (this.archiving) return this.archiving;
    this.archiving = this.archiveOnce().finally(() => { this.archiving = null; });
    return this.archiving;
  }
  async archiveOnce() {
    const retryAt = await this.storage.get("archiveRetryAt");
    if (retryAt && retryAt > Date.now()) { await this.storage.setAlarm(retryAt); return; }
    try {
      if (!this.env.ARCHIVE_KEY || !this.env.ARCHIVE_KEY_ID || !this.env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(this.env.GITHUB_REPOSITORY || "") || !["synthetic", "production"].includes(this.env.ENVIRONMENT)) throw new Error("Archive configuration incomplete.");
      // Check privacy on every batch. Never upload responses into a public repo.
      const repositoryResponse = await this.github("");
      if (!repositoryResponse.ok || (await repositoryResponse.json()).private !== true) throw new Error("Archive repository must be private and accessible.");
      let pending = await this.storage.get("archivePending");
      if (!pending) {
        const after = await this.storage.get("archivedThrough") || 0;
        const rows = await this.storage.list({ prefix: "checkpoint:", startAfter: checkpointKey(after), limit: 40 });
        const records = [];
        let size = 0;
        for (const row of rows.values()) {
          const length = JSON.stringify(row).length;
          if (records.length && size + length > 4_000_000) break;
          records.push(row); size += length;
        }
        if (!records.length) return;
        const batch = crypto.randomUUID();
        const envelope = await encryptArchive(records, this.env.ARCHIVE_KEY, { key_id: this.env.ARCHIVE_KEY_ID, environment: this.env.ENVIRONMENT, batch_id: batch });
        const content = JSON.stringify(envelope);
        const parts = [];
        for (let offset = 0; offset < content.length; offset += 500_000) parts.push(content.slice(offset, offset + 500_000));
        pending = { path: `${this.env.ENVIRONMENT}/${batch}.json`, parts: parts.length, through: records.at(-1).sequence, sessions: records.map(row => ({ participant: row.checkpoint.session.participant_code, revision: row.checkpoint.checkpoint_revision })) };
        // Retain identical ciphertext and path across lost acknowledgements.
        await this.storage.transaction(async tx => {
          for (let index = 0; index < parts.length; index++) await tx.put(`archivePart:${index}`, parts[index]);
          await tx.put("archivePending", pending);
        });
      }
      let content = "";
      for (let index = 0; index < pending.parts; index++) content += await this.storage.get(`archivePart:${index}`);
      const endpoint = `/contents/${pending.path}`;
      const expected = base64(new TextEncoder().encode(content));
      const upload = await this.github(endpoint, { method: "PUT", body: JSON.stringify({ message: "Archive encrypted study checkpoints", content: expected }), headers: { "Content-Type": "application/json" } });
      if (!upload.ok) {
        // A failed/lost PUT response may still have committed the exact batch.
        const read = await this.github(endpoint, { headers: { Accept: "application/vnd.github.raw+json" } });
        if (!read.ok || await read.text() !== content) throw new Error(`GitHub archive pending (${upload.status}).`);
      }
      await this.storage.transaction(async tx => {
        await tx.put("archivedThrough", pending.through);
        for (const item of pending.sessions) {
          const key = `session:${item.participant}`;
          const state = await tx.get(key);
          if (state) await tx.put(key, { ...state, archived_revision: Math.max(state.archived_revision, item.revision) });
        }
        await tx.delete("archivePending");
        for (let index = 0; index < pending.parts; index++) await tx.delete(`archivePart:${index}`);
        await tx.delete("archiveError");
        await tx.delete("archiveRetryAt");
      });
    } catch (error) {
      await this.storage.put("archiveError", { message: error.message, at: new Date().toISOString() });
      if (error.retryAt) await this.storage.put("archiveRetryAt", error.retryAt);
      throw error;
    } finally {
      if ((await this.storage.get("sequence") || 0) > (await this.storage.get("archivedThrough") || 0)) await this.storage.setAlarm(Math.max(Date.now() + 60_000, await this.storage.get("archiveRetryAt") || 0));
    }
  }
}
