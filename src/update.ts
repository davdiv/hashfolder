import { createHash } from "crypto";
import type { Dirent, Stats } from "fs";
import { createReadStream } from "fs";
import { lstat, readdir, readlink, stat } from "fs/promises";
import type PQueue from "p-queue";
import { join, posix } from "path";
import { pipeline } from "stream/promises";
import { DbFile, DbFileHash, DbFileType, HashfolderDatabase } from "./database";
import {
  MultiHashes,
  createHashObjects,
  digest,
  isGitAlgorithm,
} from "./hashes";

const naturalCompareFn = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
const withSlashForDirectory = (a: Dirent) =>
  a.isDirectory() ? `${a.name}/` : a.name;
const dirEntSortFn = (a: Dirent, b: Dirent) =>
  naturalCompareFn(withSlashForDirectory(a), withSlashForDirectory(b));

export interface UpdateContext {
  db: HashfolderDatabase;
  hashes: string[];
  dbLastCheckTime: number;
  rootPath: string;
  pqueue: PQueue;
  recomputeAll: boolean;
}

export interface UpdateResult {
  file: DbFile;
  fileHashes: Record<string, Buffer>;
}

type FindUpdatesFunction = (
  context: UpdateContext,
  path: string,
) => Promise<UpdateResult>;

const fromDbFileHashes = (dbFileHashes: DbFileHash[]) => {
  const hashes: Record<string, Buffer> = {};
  for (const { algorithm: type, hash } of dbFileHashes) {
    hashes[type] = hash;
  }
  return hashes;
};

const checkHasAllHashes = (
  expectedHashes: string[],
  fileHashes: Record<string, Buffer>,
) => expectedHashes.every((hash) => Object.hasOwn(fileHashes, hash));

export const getDirEntryUpdateFunction = (dirEntry: Dirent | Stats) => {
  // TODO: handle special file types ?
  if (dirEntry.isDirectory()) {
    return findFolderUpdates;
  } else if (dirEntry.isSymbolicLink()) {
    return findLinkUpdates;
  } else if (dirEntry.isFile()) {
    return findFileUpdates;
  }
  return null;
};

const gitMode = (entry: DbFile) => {
  switch (entry.type) {
    case DbFileType.FOLDER:
      return "40000";
    case DbFileType.LINK:
      return "120000";
    case DbFileType.FILE:
      if (entry.mode & 0o100) {
        // executable file
        return "100755";
      }
      return "100644";
  }
};

export const findFolderUpdates: FindUpdatesFunction = async (context, path) => {
  const fullFilePath = join(context.rootPath, path);
  const fileStat = await stat(fullFilePath);
  let size = 0;
  let cTime = fileStat.ctimeMs;
  let mTime = fileStat.mtimeMs;
  const dirEntries = (await context.pqueue.add(
    async () =>
      await readdir(fullFilePath, {
        withFileTypes: true,
      }),
  )) as Dirent[];
  dirEntries.sort(dirEntSortFn);
  const gitTreeSizes = new Map<string, number>();
  context.hashes
    .filter(isGitAlgorithm)
    .forEach((algorithm) => gitTreeSizes.set(algorithm, 0));
  const content = await Promise.all(
    dirEntries.map(async (dirEntry) => {
      const updateFn = getDirEntryUpdateFunction(dirEntry);
      if (!updateFn) {
        return null;
      }
      const name = dirEntry.name;
      const result = await updateFn(context, posix.join(path, name));
      size += result.file.size;
      cTime = Math.max(cTime, result.file.cTime);
      mTime = Math.max(cTime, result.file.mTime);
      const gitEntry = Buffer.from(
        `${gitMode(result.file)} ${name}\u0000`,
        "utf8",
      );
      for (const [algorithm, previousSize] of gitTreeSizes.entries()) {
        gitTreeSizes.set(
          algorithm,
          previousSize + gitEntry.length + result.fileHashes[algorithm].length,
        );
      }
      return {
        gitEntry,
        stdEntry: Buffer.from(`${result.file.type} ${name}\u0000`, "utf8"),
        hashes: result.fileHashes,
      };
    }),
  );
  const hashObjects = createHashObjects(context.hashes, (hash, algorithm) => {
    hash.update(
      Buffer.from(`tree ${gitTreeSizes.get(algorithm)}\u0000`, "utf8"),
    );
  });
  for (const item of content) {
    if (item) {
      for (const [algorithm, hash] of hashObjects.entries()) {
        hash.update(isGitAlgorithm(algorithm) ? item.gitEntry : item.stdEntry);
        hash.update(item.hashes[algorithm]);
      }
    }
  }
  const fileHashes = digest(hashObjects);

  const file: DbFile = {
    path,
    type: DbFileType.FOLDER,
    mode: fileStat.mode,
    size,
    cTime,
    mTime,
    lastCheckTime: context.dbLastCheckTime,
  };
  context.db.deleteFileHashes(path);
  context.db.upsertFile(file);
  for (const type of Object.keys(fileHashes)) {
    context.db.upsertFileHash({
      path,
      algorithm: type,
      hash: fileHashes[type],
    });
  }
  return {
    file,
    fileHashes,
  };
};

const findFileOrLinksUpdates =
  (
    type: DbFileType,
    streamContent: (fullFilePath: string, hash: MultiHashes) => Promise<void>,
  ): FindUpdatesFunction =>
  async (context, path) => {
    const previousFile = context.recomputeAll
      ? undefined
      : context.db.getFile(path);
    const fullFilePath = join(context.rootPath, path);
    const fileStat = await lstat(fullFilePath);
    const size = fileStat.size;
    let reusePreviousHashes =
      previousFile?.type === type &&
      previousFile.size === fileStat.size &&
      previousFile.mode === fileStat.mode &&
      previousFile.mTime === fileStat.mtimeMs &&
      previousFile.cTime === fileStat.ctimeMs;
    let fileHashes!: Record<string, Buffer>;
    if (reusePreviousHashes) {
      fileHashes = fromDbFileHashes(context.db.getFileHashes(path));
      reusePreviousHashes = checkHasAllHashes(context.hashes, fileHashes);
    }
    if (!reusePreviousHashes) {
      fileHashes = (await context.pqueue.add(async () => {
        const hash = new MultiHashes(
          context.hashes,
          Buffer.from(`blob ${size}\u0000`, "utf8"),
        );
        await streamContent(fullFilePath, hash);
        return hash.digest();
      }))!;
    }
    const file: DbFile = {
      path,
      type,
      size,
      mode: fileStat.mode,
      cTime: fileStat.ctimeMs,
      mTime: fileStat.mtimeMs,
      lastCheckTime: context.dbLastCheckTime,
    };
    if (!reusePreviousHashes) {
      context.db.deleteFileHashes(path);
    }
    context.db.upsertFile(file);
    for (const type of Object.keys(fileHashes)) {
      context.db.upsertFileHash({
        path,
        algorithm: type,
        hash: fileHashes[type],
      });
    }
    return {
      file,
      fileHashes,
    };
  };

export const findLinkUpdates = findFileOrLinksUpdates(
  DbFileType.LINK,
  async (fullFilePath, hash) => {
    const link = await readlink(fullFilePath, { encoding: "buffer" });
    hash.update(link);
  },
);

export const findFileUpdates = findFileOrLinksUpdates(
  DbFileType.FILE,
  async (fullFilePath, hash) => {
    const readStream = createReadStream(fullFilePath);
    await pipeline(readStream, hash);
  },
);
