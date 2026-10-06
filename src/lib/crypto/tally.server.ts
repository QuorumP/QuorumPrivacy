// Server-side confidential tally: homomorphically sum the encrypted ballots per option and
// decrypt only the totals. Prefers (t,n) THRESHOLD decryption (no single party holds the
// secret) when TALLY_SHARES is set; falls back to single-key TALLY_SECRET otherwise.
// Production would collect the t partial decryptions from physically separate tally nodes;
// here the shares live in server env, which is operationally single-host but cryptographically
// threshold (Phase 4 / Arcium moves the partial decryptions off-box).
import { addCiphertexts, decrypt, type Ciphertext } from "./elgamal";
import {
  partialDecrypt, thresholdDecrypt, partialDecryptWithProof, verifyTallyCorrectness,
  type Share, type PartialProof,
} from "./threshold";

export const tallyConfigured = (): boolean =>
  !!process.env.TALLY_SHARES || !!process.env.TALLY_SECRET;

// One option's verifiable-tally transcript: the summed ciphertext, the decrypted total, and the
// t partial decryptions each with a DLEQ correctness proof + verification key.
export type OptionProof = { option: string; ct: Ciphertext; total: number; partials: PartialProof[] };
export type TallyTranscript = { pubkey: string; options: OptionProof[] };

function decryptSum(sum: Ciphertext): number {
  const sharesJson = process.env.TALLY_SHARES;
  if (sharesJson) {
    const { t, shares } = JSON.parse(sharesJson) as { t: number; n: number; shares: Share[] };
    const chosen = shares.slice(0, t); // any t shares suffice
    const partials = chosen.map((s) => ({ index: s.index, point: partialDecrypt(s, sum) }));
    return thresholdDecrypt(partials, sum);
  }
  return decrypt(BigInt(process.env.TALLY_SECRET as string), sum);
}

export function tallyBallots(
  encChoices: string[],
  options: string[] = ["yes", "no", "abstain"],
): { options: string[]; counts: number[]; tallied: number; mode: "threshold" | "single" } {
  if (!tallyConfigured()) throw new Error("TALLY_NOT_CONFIGURED");

  const parsed = encChoices
    .map((e) => { try { return JSON.parse(e) as Ciphertext[]; } catch { return null; } })
    .filter((c): c is Ciphertext[] => Array.isArray(c) && c.length === options.length);

  const counts = options.map((_, i) => {
    const col = parsed.map((b) => b[i]);
    return col.length ? decryptSum(addCiphertexts(col)) : 0;
  });
  return { options, counts, tallied: parsed.length, mode: process.env.TALLY_SHARES ? "threshold" : "single" };
}

/**
 * Threshold-mode tally that ALSO emits a DLEQ correctness transcript so anyone can verify the
 * announced totals are the honest decryption of the sealed ballots (no trust in the server).
 * Returns null in single-key mode (nothing to prove).
 */
export function tallyCorrectnessTranscript(
  encChoices: string[],
  options: string[] = ["yes", "no", "abstain"],
): TallyTranscript | null {
  const sharesJson = process.env.TALLY_SHARES;
  const pubkey = process.env.TALLY_PUBKEY;
  if (!sharesJson || !pubkey) return null;
  const { t, shares } = JSON.parse(sharesJson) as { t: number; n: number; shares: Share[] };
  const chosen = shares.slice(0, t);

  const parsed = encChoices
    .map((e) => { try { return JSON.parse(e) as Ciphertext[]; } catch { return null; } })
    .filter((c): c is Ciphertext[] => Array.isArray(c) && c.length === options.length);

  const out: OptionProof[] = options.map((option, i) => {
    const sum = addCiphertexts(parsed.map((b) => b[i]));
    const partials = chosen.map((s) => partialDecryptWithProof(s, sum));
    const total = thresholdDecrypt(partials.map((p) => ({ index: p.index, point: p.point })), sum);
    return { option, ct: sum, total, partials };
  });
  return { pubkey, options: out };
}

/** Re-verify a stored tally transcript against its committed group key. */
export function verifyTranscript(transcript: TallyTranscript): boolean {
  return transcript.options.every((o) =>
    verifyTallyCorrectness(transcript.pubkey, o.ct, o.partials, o.total));
}
