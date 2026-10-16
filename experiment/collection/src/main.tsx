import { createRoot } from "react-dom/client";
import { ZendoStudy } from "../../app/components/ZendoStudy";
import { CollectorClient, parseLink } from "./client.mjs";
import "../../app/globals.css";
import "./status.css";

const root = createRoot(document.getElementById("root")!);
const message = (text: string) => root.render(<main className="content-shell"><section className="paper-card" role="alert"><h1>Zendo</h1><p>{text}</p><button className="button button--secondary" onClick={() => location.reload()}>Poskusi znova</button></section></main>);
async function start() {
  const link = parseLink(location.href);
  const endpoint = (import.meta as unknown as { env: Record<string, string> }).env.VITE_COLLECTOR_URL;
  if (!endpoint || !(endpoint.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1):/.test(endpoint))) throw new Error("Zbiranje odgovorov še ni nastavljeno. Prosimo, obvestite raziskovalca.");
  if (!navigator.locks) throw new Error("Prosimo, uporabite posodobljen Chrome ali Edge.");
  await navigator.locks.request(`zendo-participant:${link.participantCode}`, { ifAvailable: true }, async lock => {
    if (!lock) { message("Ta povezava je že odprta v drugem zavihku. Zaprite drugi zavihek in nato poskusite znova."); return; }
    const client = new CollectorClient({ ...link, endpoint, storage: localStorage });
    message("Preverjam povezavo in shranjeno sejo …");
    try {
      const state = await client.initialise();
      if (state.status === "complete" && !localStorage.getItem(client.storageKey)) {
        message("Ta udeležba je že zaključena. Hvala!"); return;
      }
    }
    catch (error) {
      // Network errors may resume an existing local draft. Identity conflicts
      // and other server rejections must never be bypassed as offline mode.
      const status = (error as { status?: number }).status ?? 0;
      if (!(error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError") || status >= 500 || [408,429].includes(status)) || !localStorage.getItem(client.storageKey)) throw error;
      client.signal("offline");
    }
    const banner = document.createElement("aside");
    banner.className = "collection-save-status";
    banner.setAttribute("role", "status");
    const label = document.createElement("span");
    const retry = document.createElement("button");
    retry.textContent = "Ponovi shranjevanje";
    retry.onclick = () => { void client.flush().then(() => location.reload()).catch(() => {}); };
    banner.append(label, retry);
    document.body.append(banner);
    const update = () => {
      label.textContent = client.status === "ready" ? "Povezava je pripravljena." : client.status === "received" ? "Odgovori so prejeti na strežniku." : client.status === "sending" ? "Pošiljam odgovore …" : "Odgovori čakajo v tem brskalniku. Preverite povezavo.";
      if ((import.meta as unknown as { env: Record<string, string> }).env.VITE_SYNTHETIC === "true" || ["localhost", "127.0.0.1"].includes(location.hostname)) label.textContent = `Preizkusna različica — uporabite izmišljene podatke. ${label.textContent}`;
      retry.hidden = client.status !== "offline";
    };
    client.listeners.add(update); update();
    window.addEventListener("online", () => { void client.flush().catch(() => {}); });
    window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
    const timer = window.setInterval(() => { if (client.queue().length) void client.flush().catch(() => {}); }, 10000);
    window.addEventListener("beforeunload", event => { if (client.queue().length) { event.preventDefault(); event.returnValue = ""; } });
    root.render(<ZendoStudy variant={link.variant as "adult" | "child"} language="sl" collection={client} assetPrefix={(import.meta as unknown as { env: Record<string, string> }).env.BASE_URL.replace(/\/$/, "")} />);
    await new Promise<void>(resolve => window.addEventListener("pagehide", () => { clearInterval(timer); resolve(); }, { once: true }));
  });
}
if ((import.meta as unknown as { env: Record<string, string> }).env.VITE_REVIEW === "true") {
  void import("./review").then(({ renderReview }) => renderReview(root));
} else {
  void start().catch(error => message(error instanceof Error ? error.message : "Povezava ni na voljo."));
}
