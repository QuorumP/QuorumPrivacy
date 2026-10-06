pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// Proves the treasury is solvent — balance >= threshold — without revealing the balance.
//  private: balance, blinding
//  public:  threshold, commitment (= Poseidon(balance, blinding))
// balance − threshold is constrained to a 64-bit non-negative range; if balance < threshold
// the difference wraps mod p and cannot fit 64 bits, so the proof fails.
template Solvency() {
    signal input balance;
    signal input blinding;
    signal input threshold;
    signal input commitment;

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
