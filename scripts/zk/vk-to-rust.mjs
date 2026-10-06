import { readFileSync, writeFileSync } from 'node:fs';
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const vk = JSON.parse(readFileSync('src/lib/zk/solvency_vkey.json','utf8'));
const tv = JSON.parse(readFileSync('_testvec.json','utf8'));

const be32 = (dec) => { let h = BigInt(dec).toString(16).padStart(64,'0'); return h; };
const g1 = (p) => be32(p[0]) + be32(p[1]);                       // x||y  (64B)
const g1neg = (p) => be32(p[0]) + be32(((P - (BigInt(p[1]) % P)) % P).toString()); // (x, -y)
const g2 = (p) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]); // x_c1||x_c0||y_c1||y_c0 (128B)
const hexToRust = (h) => '[' + h.match(/../g).map(b=>'0x'+b).join(', ') + ']';

// VK constants (permanent, embedded in program)
let out = '// AUTO-GENERATED from solvency_vkey.json — Solana alt_bn128 byte format. Do not edit.\n';
out += `pub const ALPHA_G1: [u8; 64] = ${hexToRust(g1(vk.vk_alpha_1))};\n`;
out += `pub const BETA_G2: [u8; 128] = ${hexToRust(g2(vk.vk_beta_2))};\n`;
out += `pub const GAMMA_G2: [u8; 128] = ${hexToRust(g2(vk.vk_gamma_2))};\n`;
out += `pub const DELTA_G2: [u8; 128] = ${hexToRust(g2(vk.vk_delta_2))};\n`;
out += `pub const IC: [[u8; 64]; ${vk.IC.length}] = [\n`;
for (const ic of vk.IC) out += `  ${hexToRust(g1(ic))},\n`;
out += '];\n';
writeFileSync('onchain/programs/quorum_anchor/src/groth16_vk.rs', out);

// Test vector (for the #[test], not committed to the program logic)
let t = '// AUTO-GENERATED test vector from a real solvency proof.\n';
t += `pub const PROOF_A: [u8; 64] = ${hexToRust(g1neg(tv.proof.pi_a))};  // negated for pairing\n`;
t += `pub const PROOF_B: [u8; 128] = ${hexToRust(g2(tv.proof.pi_b))};\n`;
t += `pub const PROOF_C: [u8; 64] = ${hexToRust(g1(tv.proof.pi_c))};\n`;
t += `pub const PUB0: [u8; 32] = ${hexToRust(be32(tv.publicSignals[0]))};\n`;
t += `pub const PUB1: [u8; 32] = ${hexToRust(be32(tv.publicSignals[1]))};\n`;
writeFileSync('onchain/programs/quorum_anchor/src/test_vector.rs', t);
console.log('wrote groth16_vk.rs (IC len', vk.IC.length, ') + test_vector.rs');
