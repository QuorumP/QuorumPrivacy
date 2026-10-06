// On-chain Groth16 (BN254) verifier using Solana's alt_bn128 syscalls.
// Verifies a snarkjs Groth16 proof against the embedded verifying key (solvency circuit,
// 2 public inputs). The client sends proof_a already negated (so the pairing product is 1
// when the proof is valid). Byte format: G1 = x||y (64B, big-endian); G2 = x_c1||x_c0||y_c1||y_c0
// (128B); scalars = 32B big-endian.
use solana_bn254::prelude::{alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing};

#[path = "groth16_vk.rs"]
mod vk;

/// 32-byte big-endian "1" — the pairing output when the proof is valid.
const PAIRING_TRUE: [u8; 32] = {
    let mut a = [0u8; 32];
    a[31] = 1;
    a
};

/// BN254 scalar field modulus r, 32-byte big-endian.
const R: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Verify a Groth16 proof (proof_a pre-negated) over `pubs` public inputs.
/// Returns true iff every input is a canonical field element (< r) and the pairing
/// e(A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) == 1.
pub fn verify(proof_a: &[u8; 64], proof_b: &[u8; 128], proof_c: &[u8; 64], pubs: &[[u8; 32]]) -> bool {
    // vk_x = IC[0] + Σ pubs[i] · IC[i+1]
    if pubs.len() + 1 != vk::IC.len() {
        return false;
    }
    // The syscall multiplies by the raw 256-bit scalar, so t and t + r give the same point:
    // without this check a valid proof for t also "verifies" an absurd threshold t + r.
    // Big-endian byte arrays compare lexicographically = numerically.
    if pubs.iter().any(|p| *p >= R) {
        return false;
    }
    let mut vk_x = vk::IC[0].to_vec();
    for (i, s) in pubs.iter().enumerate() {
        // G1 scalar multiplication: input = point(64) || scalar(32)
        let mut mul_in = Vec::with_capacity(96);
        mul_in.extend_from_slice(&vk::IC[i + 1]);
        mul_in.extend_from_slice(s);
        let term = match alt_bn128_multiplication(&mul_in) {
            Ok(t) => t,
            Err(_) => return false,
        };
        // G1 addition: input = a(64) || b(64)
        let mut add_in = Vec::with_capacity(128);
        add_in.extend_from_slice(&vk_x);
        add_in.extend_from_slice(&term);
        vk_x = match alt_bn128_addition(&add_in) {
            Ok(s) => s,
            Err(_) => return false,
        };
    }

    // pairing product: (A,B) (α,β) (vk_x,γ) (C,δ) — each pair G1(64)||G2(128)
    let mut pin = Vec::with_capacity(4 * 192);
    pin.extend_from_slice(proof_a);
    pin.extend_from_slice(proof_b);
    pin.extend_from_slice(&vk::ALPHA_G1);
    pin.extend_from_slice(&vk::BETA_G2);
    pin.extend_from_slice(&vk_x);
    pin.extend_from_slice(&vk::GAMMA_G2);
    pin.extend_from_slice(proof_c);
    pin.extend_from_slice(&vk::DELTA_G2);

    match alt_bn128_pairing(&pin) {
        Ok(res) => res == PAIRING_TRUE,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Absolute include: a relative #[path] here resolves through src/groth16/tests/, which
    // doesn't exist — Windows collapses the "..", Linux (CI) does not.
    mod tv {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/test_vector.rs"));
    }

    #[test]
    fn valid_solvency_proof_verifies() {
        assert!(verify(&tv::PROOF_A, &tv::PROOF_B, &tv::PROOF_C, &[tv::PUB0, tv::PUB1]));
    }

    #[test]
    fn tampered_public_input_fails() {
        let mut bad = tv::PUB0;
        bad[31] ^= 1; // flip a bit in the threshold
        assert!(!verify(&tv::PROOF_A, &tv::PROOF_B, &tv::PROOF_C, &[bad, tv::PUB1]));
    }

    /// pub + r (big-endian 256-bit add) — the same field element, non-canonical encoding.
    fn plus_r(x: [u8; 32]) -> [u8; 32] {
        let mut out = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let v = x[i] as u16 + R[i] as u16 + carry;
            out[i] = v as u8;
            carry = v >> 8;
        }
        assert_eq!(carry, 0, "test input must stay below 2^256");
        out
    }

    #[test]
    fn aliased_public_input_fails() {
        // Without the range check this verified (the syscall reduces the scalar mod r).
        assert!(!verify(&tv::PROOF_A, &tv::PROOF_B, &tv::PROOF_C, &[plus_r(tv::PUB0), tv::PUB1]));
        assert!(!verify(&tv::PROOF_A, &tv::PROOF_B, &tv::PROOF_C, &[tv::PUB0, plus_r(tv::PUB1)]));
    }
}
