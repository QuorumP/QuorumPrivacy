pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Proves the treasury is solvent — balance >= threshold — without revealing the balance.
//  private: balance, blinding
//  public:  threshold, commitment (= Poseidon(balance, blinding))
// balance and threshold are each constrained to 64 bits (a u64 token amount), so neither can be
// a field-"negative" value. With both in [0, 2^64), balance − threshold fits 64 bits iff
// balance >= threshold; otherwise it wraps mod p and the proof fails.
// The balance is bound to the real treasury account by the server, which reads it from chain
// and generates this proof itself (src/lib/zk/solvency.server.ts).
template Solvency() {
    signal input balance;
    signal input blinding;
    signal input threshold;
    signal input commitment;

    component balanceBits = Num2Bits(64);
    balanceBits.in <== balance;
    component thresholdBits = Num2Bits(64);
    thresholdBits.in <== threshold;

    component c = Poseidon(2);
    c.inputs[0] <== balance;
    c.inputs[1] <== blinding;
    c.out === commitment;

    signal diff;
    diff <== balance - threshold;
    component bits = Num2Bits(64);
    bits.in <== diff;
}

component main { public [threshold, commitment] } = Solvency();
