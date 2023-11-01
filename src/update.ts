import { createHash } from "crypto";
import type { Dirent, Stats } from "fs";
import { createReadStream } from "fs";
import { lstat, readdir, readlink, stat } from "fs/promises";
import { join, posix } from "path";
import { pipeline } from "stream/promises";
import { DbFile, DbFileType, HashfolderDatabase } from "./database";

const naturalCompareFn = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
const dirEntSortFn = (a: Dirent, b: Dirent) => naturalCompareFn(a.name, b.name);

export interface EntryResult {
  entry: DbFile;
  previousEntry: DbFile | undefined;
}

export type UpdateContext = {
  db: HashfolderDatabase;
  dbLastCheckTime: number;
  rootPath: string;
};

type FindUpdatesFunction = (
  context: UpdateContext,
  path: string
) => Promise<EntryResult>;

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

export const findFolderUpdates: FindUpdatesFunction = async (context, path) => {
  const previousEntry = context.db.getFile(path);
  const fullFilePath = join(context.rootPath, path);
  const fileStat = await stat(fullFilePath);
  let size = 0;
  let cTime = fileStat.ctimeMs;
  let mTime = fileStat.mtimeMs;
  const dirEntries = await readdir(fullFilePath, {
    withFileTypes: true,
  });
  dirEntries.sort(dirEntSortFn);
  const content = await Promise.all(
    dirEntries.map(async (dirEntry) => {
      const updateFn = getDirEntryUpdateFunction(dirEntry);
      if (!updateFn) {
        return null;
      }
      const name = dirEntry.name;
      const result = await updateFn(context, posix.join(path, name));
      size += result.entry.size;
      cTime = Math.max(cTime, result.entry.cTime);
      mTime = Math.max(cTime, result.entry.mTime);
      return { name, ...result.entry };
    })
  );
  const hash = createHash("sha256");
  for (const item of content) {
    if (item) {
      hash.write(item.name);
      hash.write("\0");
      hash.write(item.type);
      hash.write("\0");
      hash.write(item.checksum);
      hash.write("\0\0");
    }
  }
  const checksum = hash.digest();
  const entry: DbFile = {
    path,
    type: DbFileType.FOLDER,
    checksum,
    size,
    cTime,
    mTime,
    lastCheckTime: context.dbLastCheckTime,
  };
  context.db.upsertFile(entry);
  return {
    entry,
    previousEntry,
  };
};

export const findLinkUpdates: FindUpdatesFunction = async (context, path) => {
  const previousEntry = context.db.getFile(path);
  const fullFilePath = join(context.rootPath, path);
  const fileStat = await lstat(fullFilePath);

  let size = fileStat.size;
  let checksum: Buffer;
  if (
    previousEntry?.type === DbFileType.LINK &&
    previousEntry.size === fileStat.size &&
    previousEntry.mTime === fileStat.mtimeMs &&
    previousEntry.cTime === fileStat.ctimeMs
  ) {
    checksum = previousEntry.checksum;
  } else {
    const link = await readlink(fullFilePath, { encoding: "buffer" });
    checksum = createHash("sha256").update(link).digest();
  }
  const entry: DbFile = {
    path,
    type: DbFileType.LINK,
    checksum,
    size,
    cTime: fileStat.ctimeMs,
    mTime: fileStat.mtimeMs,
    lastCheckTime: context.dbLastCheckTime,
  };
  context.db.upsertFile(entry);
  return {
    entry,
    previousEntry,
  };
};

export const findFileUpdates: FindUpdatesFunction = async (context, path) => {
  const previousEntry = context.db.getFile(path);
  const fullFilePath = join(context.rootPath, path);
  const fileStat = await stat(fullFilePath);
  let size = fileStat.size;
  let checksum: Buffer;
  if (
    previousEntry?.type === DbFileType.FILE &&
    previousEntry.size === fileStat.size &&
    previousEntry.mTime === fileStat.mtimeMs &&
    previousEntry.cTime === fileStat.ctimeMs
  ) {
    checksum = previousEntry.checksum;
  } else {
    const readStream = createReadStream(fullFilePath);
    const hash = createHash("sha256");
    await pipeline(readStream, hash);
    checksum = hash.digest();
    size = readStream.bytesRead;
  }
  const entry: DbFile = {
    path,
    type: DbFileType.FILE,
    checksum,
    size,
    cTime: fileStat.ctimeMs,
    mTime: fileStat.mtimeMs,
    lastCheckTime: context.dbLastCheckTime,
  };
  context.db.upsertFile(entry);
  return {
    entry,
    previousEntry,
  };
};
