import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
for (const path of process.argv.slice(2)) {
  const bundle = JSON.parse(await readFile(path, "utf8"));
  if (bundle.format !== "zendo-private-links-v1") throw new Error("Not a private link bundle.");
  const variant = bundle.links[0]?.variant;
  if (!['adult','child'].includes(variant) || bundle.links.some(link => link.variant !== variant)) throw new Error("Use separate adult and child lists.");
  const title = variant === 'adult' ? 'Adult participant links' : 'Child participant links';
  const rows = bundle.links.map((item, index) => `<tr><td>${index+1}</td><td><a href="${escape(item.link)}" target="_blank" rel="noreferrer">Open participant ${index+1}</a><br><textarea readonly aria-label="Participant ${index+1} link">${escape(item.link)}</textarea></td><td>${escape(item.participant)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:1rem;color:#172433}table{border-collapse:collapse;width:100%}td,th{padding:1rem;border:1px solid #ccd;text-align:left}textarea{width:100%;min-height:4.5rem;margin-top:.5rem;font:13px monospace}td:last-child{font:12px monospace}h1{font-size:1.8rem}</style><h1>${title}</h1><p>PRIVATE researcher list. Give one unused link to each participant. Reuse their same link on the same computer/browser to resume. Do not open these links for demonstrations: use the review page.</p><p>Select the complete link in its box and copy it. Keep any name-to-link allocation list separately. Never publish this page.</p><table><thead><tr><th>No.</th><th>Individual link</th><th>Participant code</th></tr></thead><tbody>${rows}</tbody></table></html>`;
  const output = resolve(path.replace(/\.json$/, '.html'));
  await writeFile(output, html, { flag: 'wx' });
  console.log(`Created private ${variant} link sheet: ${output}`);
}
