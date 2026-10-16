import { Collector } from "./collector.mjs";
export class StudyCollector {
  constructor(ctx, env) { this.collector = new Collector(ctx.storage, env); }
  fetch(request) { return this.collector.handle(request); }
  async alarm() { try { await this.collector.archive(); } catch { /* persisted error; retry alarm already set */ } }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !(env.ENVIRONMENT === "synthetic" && ["localhost", "127.0.0.1"].includes(url.hostname))) return new Response("HTTPS required", { status: 426 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.ALLOWED_ORIGIN) return new Response("Origin not allowed", { status: 403 });
    const headers = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Participant, X-Writer", "Vary": "Origin", "Cache-Control": "no-store" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const collector = env.COLLECTOR.get(env.COLLECTOR.idFromName(`og1-${env.ENVIRONMENT}`));
    const response = await collector.fetch(request);
    return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
  },
};
