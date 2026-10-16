export const participantPattern = /^[a-f0-9]{32}$/;
export const tokenPattern = /^[a-f0-9]{64}$/;

export function parseLink(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const route = parts.at(-1);
  if (!["odrasli", "otroci"].includes(route)) throw new Error("Odprite osebno povezavo, ki ste jo prejeli od raziskovalca.");
  const hash = new URLSearchParams(parsed.hash.slice(1));
  const participantCode = hash.get("p") ?? "";
  const token = hash.get("t") ?? "";
  if (!participantPattern.test(participantCode) || !tokenPattern.test(token)) throw new Error("Osebna povezava ni veljavna. Prosimo, obvestite raziskovalca.");
  return { participantCode, token, variant: route === "odrasli" ? "adult" : "child" };
}

// Called only while holding the participant's Web Lock. Both drafts and the
// immutable upload queue are scoped to a random participant identity.
export class CollectorClient {
  constructor({ participantCode, token, variant, endpoint, storage, fetcher = (...args) => globalThis.fetch(...args) }) {
    this.participantCode = participantCode;
    this.token = token;
    this.variant = variant;
    this.endpoint = endpoint.replace(/\/$/, "");
    this.storage = storage;
    this.fetcher = fetcher;
    this.storageKey = `zendo-og1-ranked-collection-v1:${participantCode}:${variant}`;
    const writerKey = `${this.storageKey}:writer`;
    this.writer = storage.getItem(writerKey) || crypto.randomUUID();
    storage.setItem(writerKey, this.writer);
    this.chain = Promise.resolve();
    this.listeners = new Set();
    this.status = "checking";
    this.lastReceipt = null;
  }
  acknowledgedRevision() { return Number(this.storage.getItem(`${this.storageKey}:ack`) || 0); }
  subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  queue() { return JSON.parse(this.storage.getItem(`${this.storageKey}:outbox`) || "[]"); }
  setQueue(queue) { this.storage.setItem(`${this.storageKey}:outbox`, JSON.stringify(queue)); }
  signal(status) { this.status = status; for (const listener of this.listeners) listener(status); }
  async request(path, data) {
    const response = await this.fetcher(`${this.endpoint}${path}`, {
      method: data ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.token}`, "X-Participant": this.participantCode, "X-Writer": this.writer, ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({ error: "Strežnik je vrnil neveljavno potrdilo." }));
    if (!response.ok) { const error = new Error(result.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return result;
  }
  async initialise() {
    const state = await this.request("/participant");
    if (state.variant !== this.variant) throw new Error("Ta povezava je namenjena drugi različici igre.");
    // A completed participation needs no draft or writer recovery. The entry
    // renders only the completion notice; it never permits a new session.
    if (state.status === "complete" && !this.storage.getItem(this.storageKey)) {
      this.lastReceipt = state;
      return state;
    }
    if (state.writer && state.writer !== this.writer) throw new Error("Seja je shranjena v drugem brskalniku. Prosimo, obvestite raziskovalca.");
    if (state.session_id && state.status !== "complete" && !this.storage.getItem(this.storageKey)) throw new Error("V tem brskalniku ni shranjenega nadaljevanja. Prosimo, obvestite raziskovalca; ne začenjajte nove seje.");
    this.lastReceipt = state;
    await this.flush();
    return state;
  }
  async save(request) {
    if (request.session.participant_code !== this.participantCode || request.session.variant !== this.variant) throw new Error("Identiteta se ne ujema.");
    const queue = this.queue();
    if (!queue.some(item => item.checkpoint_id === request.checkpoint_id)) {
      queue.push(structuredClone(request));
      this.setQueue(queue); // Durable before attempting the network.
    }
    return this.flush();
  }
  flush() {
    const job = async () => {
      try {
        while (this.queue().length) {
          this.signal("sending");
          const head = this.queue()[0];
          const receipt = await this.request("/checkpoint", head);
          if (receipt.checkpoint_id !== head.checkpoint_id || receipt.session_id !== head.session.session_id || receipt.revision !== head.checkpoint_revision || receipt.received !== true) throw new Error("Strežnik ni potrdil tega zapisa.");
          this.storage.setItem(`${this.storageKey}:ack`, String(head.checkpoint_revision));
          this.setQueue(this.queue().filter(item => item.checkpoint_id !== head.checkpoint_id));
          this.lastReceipt = receipt;
        }
        this.signal(this.acknowledgedRevision() ? "received" : "ready");
      } catch (error) { this.signal("offline"); throw error; }
    };
    this.chain = this.chain.catch(() => {}).then(job);
    return this.chain;
  }
}
