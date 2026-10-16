import type { Root } from "react-dom/client";
import { ZendoStudy } from "../../app/components/ZendoStudy";
import type { CollectionTransport } from "../../app/lib/collection-transport";

export function renderReview(root: Root) {
  const params = new URLSearchParams(location.search);
  const variant = params.get("variant") === "child" ? "child" : "adult";
  const stage = params.get("stage") || "full";
  const run = params.get("run") || "default";
  const storageKey = `zendo-og1-ranked-review-collection:${variant}:${run}`;
  const participantCode = localStorage.getItem(`${storageKey}:id`) || crypto.randomUUID().replaceAll("-", "");
  localStorage.setItem(`${storageKey}:id`, participantCode);
  // Supply collection form/identity behaviour without a network transport.
  // ZendoStudy's reviewOnly branch saves drafts locally and never calls save.
  const localReview: CollectionTransport = {
    participantCode, storageKey,
    save: async () => { throw new Error("Review responses cannot be submitted."); },
    acknowledgedRevision: () => 0,
    subscribe: () => () => {},
  };
  const base = (import.meta as unknown as { env: Record<string, string> }).env.BASE_URL.replace(/\/$/, "");
  root.render(<>
    <aside className="review-navigation" aria-label="Review controls">
      <strong>Predogled · odgovori se ne pošiljajo</strong>
      <nav>
        <a href={`?variant=adult&stage=${stage}`}>Odrasli</a>
        <a href={`?variant=child&stage=${stage}`}>Otroci</a>
        {[["full", "Celotna igra"], ["operations", "Operacije"], ["demo", "Vodena vaja"], ["generalisation", "Novi prizori in končno pravilo"], ["fifth", "Peta naloga"], ["results", "Rezultati"], ["questions", "Zaključna vprašanja"]].map(([value, label]) => <a key={value} href={`?variant=${variant}&stage=${value}`} aria-current={stage === value ? "page" : undefined}>{label}</a>)}
        <a href={`?variant=${variant}&stage=full&run=${crypto.randomUUID()}`}>Nov predogled od začetka</a>
      </nav>
    </aside>
    <ZendoStudy variant={variant} language="sl" reviewOnly assetPrefix={base} collection={stage === "full" ? localReview : undefined}
      previewOperations={stage === "operations"} previewDemo={stage === "demo"} previewGeneralisation={stage === "generalisation"}
      previewFifthRule={stage === "fifth"} previewResults={stage === "results"}
      previewFinalQuestions={stage === "questions"} />
  </>);
}
