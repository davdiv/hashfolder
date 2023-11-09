import { createHash, getHashes, getCiphers, Hash } from "crypto";
import { Writable } from "stream";

export const isGitAlgorithm = (algorithm: string) =>
  algorithm.startsWith("GIT-");

const rawHashAlgorithms = getHashes()
  .map((hash) => hash.toUpperCase())
  .filter(
    (hash) =>
      !hash.startsWith("RSA-") &&
      !hash.startsWith("ID-RSASSA-") &&
      !hash.startsWith("SSL3-") &&
      !hash.endsWith("WITHRSAENCRYPTION") &&
      !hash.endsWith("WITHRSA"),
  );

export const hashAlgorithms = [
  ...rawHashAlgorithms,
  ...rawHashAlgorithms.map((hash) => `GIT-${hash}`),
];

const createHashObject = (
  algorithm: string,
  gitInit: (hash: Hash, algorithm: string) => void,
) => {
  const useGit = isGitAlgorithm(algorithm);
  const rawAlgorithm = useGit ? algorithm.substring(4) : algorithm;
  const res = createHash(rawAlgorithm);
  if (useGit) {
    gitInit(res, algorithm);
  }
  return res;
};

export const createHashObjects = (
  algorithms: string[],
  gitInit: (hash: Hash, algorithm: string) => void,
) => {
  const hashes = new Map<string, Hash>();
  for (const algorithm of algorithms) {
    hashes.set(algorithm, createHashObject(algorithm, gitInit));
  }
  return hashes;
};

export const digest = (hashes: Map<string, Hash>) => {
  const res: Record<string, Buffer> = {};
  for (const [name, hash] of hashes.entries()) {
    res[name] = hash.digest();
  }
  return res;
};

export class MultiHashes extends Writable {
  #hashes: Map<string, Hash> = new Map<string, Hash>();

  constructor(algorithms: string[], gitInitBuffer: Buffer) {
    super({
      objectMode: false,
      write: (chunk, encoding, callback) => {
        if (!(chunk instanceof Buffer)) {
          chunk = Buffer.from(chunk, encoding);
        }
        this.update(chunk);
        callback();
      },
    });
    this.#hashes = createHashObjects(algorithms, (hash: Hash) => {
      hash.update(gitInitBuffer);
    });
  }

  update(chunk: Buffer) {
    for (const [name, hash] of this.#hashes.entries()) {
      hash.update(chunk);
    }
  }

  digest(): Record<string, Buffer> {
    return digest(this.#hashes);
  }
}
