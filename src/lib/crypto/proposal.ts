// Client-side sealed proposal (commit-reveal). The body is AES-GCM encrypted; only the
// ciphertext + a salted sha256 commitment leave the browser. The random salt stops anyone
// confirming a guessable proposal ("Increase quorum to 10%") against the public commitment. The author keeps the plaintext locally
// to reveal later — the server never sees it until then.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 0x sha256(salt || plaintext); salt "" reproduces legacy unsalted commitments. */
export async function proposalCommit(plaintext: string, salt = ""): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + plaintext));
  return "0x" + hex(new Uint8Array(digest));
}

export async function sealProposal(plaintext: string): Promise<{ encPayload: string; commitHash: string; salt: string }> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  // key is kept by the author (localStorage), NOT sent to the server
  const encPayload = `${b64(iv)}.${b64(ct)}`;
  const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { encPayload, commitHash: await proposalCommit(plaintext, salt), salt };
}
