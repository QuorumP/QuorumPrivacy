// snarkjs ships no type declarations; this covers the Groth16 calls QUORUM makes.
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }>;
    verify(vkey: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
  };
}
