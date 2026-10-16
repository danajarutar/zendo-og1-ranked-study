import type { OperationId } from "../lib/experiment";

// Small recognition cues always accompanied by the operation's written name.
export function OperationIcon({ operation }: { operation: OperationId }) {
  return <svg className="operation-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {operation === "necessity" ? <><circle cx="11" cy="11" r="6" /><path d="m15 15 12 12m-7-7 3-3m1 7 3-3" /></> : null}
    {operation === "sufficiency" ? <><path d="M4 6h24l-9 10v9l-6 3V16Z" /><path d="M13 21h6" /></> : null}
    {operation === "role_filler" ? <><circle cx="8" cy="10" r="4" /><circle cx="24" cy="10" r="4" /><path d="M12 10h8M5 24h6m10 0h6M8 14v6m16-6v6M13 23h6m-6 4h6" /></> : null}
    {operation === "counterexample" ? <><circle cx="13" cy="13" r="9" /><path d="m20 20 8 8m-18-18 6 6m0-6-6 6" /></> : null}
    {operation === "discovery" ? <><circle cx="16" cy="16" r="12" /><path d="m21 11-3 7-7 3 3-7ZM16 4v3m12 9h-3M16 28v-3M4 16h3" /></> : null}
    {operation === "other" ? <><circle cx="6" cy="16" r="2" /><circle cx="16" cy="16" r="2" /><circle cx="26" cy="16" r="2" /></> : null}
  </svg>;
}
