pragma circom 2.1.9;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// Proves Merkle inclusion of `leaf` under `root` given a path, using Poseidon(2) nodes.
// pathIndices[i] == 0  -> current hash is the LEFT child
// pathIndices[i] == 1  -> current hash is the RIGHT child
template MerkleProof(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    component mux[depth];
    signal hashes[depth + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // enforce boolean path index
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        mux[i] = MultiMux1(2);
        // when s == 0: (left, right) = (hash, element)
        mux[i].c[0][0] <== hashes[i];
        mux[i].c[1][0] <== pathElements[i];
        // when s == 1: (left, right) = (element, hash)
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][1] <== hashes[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[depth];
}

// Confidential eligibility:
//  - private: identitySecret (the member's secret), Merkle path to the eligibility root
//  - public:  root (eligibility snapshot), voteId
//  - output:  nullifierHash = Poseidon(identitySecret, voteId)  (public)
//
// Proves "I am one of the eligible members (a leaf = Poseidon(identitySecret) is in the
// tree with this root)" and binds a unique per-vote nullifier — without revealing which
// member or any balance. The nullifier prevents double-voting; it cannot be linked back
// to the identity.
template Eligibility(depth) {
    signal input identitySecret;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input root;
    signal input voteId;
    signal output nullifierHash;

    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== identitySecret;

    component mp = MerkleProof(depth);
    mp.leaf <== leafHasher.out;
    for (var i = 0; i < depth; i++) {
        mp.pathElements[i] <== pathElements[i];
        mp.pathIndices[i] <== pathIndices[i];
    }
    mp.root === root;

    component nh = Poseidon(2);
    nh.inputs[0] <== identitySecret;
    nh.inputs[1] <== voteId;
    nullifierHash <== nh.out;
}

component main { public [root, voteId] } = Eligibility(16);
