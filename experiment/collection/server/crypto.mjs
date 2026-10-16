const encoder = new TextEncoder();
export function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function unbase64(text) { return Uint8Array.from(atob(text), character => character.charCodeAt(0)); }
export async function sha256(text) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map(value => value.toString(16).padStart(2, "0")).join(""); }
export async function encryptArchive(records, keyBase64, metadata) {
  const bytes = unbase64(keyBase64);
  if (bytes.length !== 32) throw new Error("Archive key must be 256 bits.");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = { format: "zendo-og1-ranked-encrypted-v1", algorithm: "AES-256-GCM", ...metadata };
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(JSON.stringify(header)) }, key, encoder.encode(JSON.stringify(records)));
  return { header, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}
export async function decryptArchive(envelope, keyBase64) {
  if (envelope.header?.format !== "zendo-og1-ranked-encrypted-v1" || envelope.header.algorithm !== "AES-256-GCM") throw new Error("Unknown archive format.");
  const key = await crypto.subtle.importKey("raw", unbase64(keyBase64), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(envelope.iv), additionalData: encoder.encode(JSON.stringify(envelope.header)) }, key, unbase64(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
