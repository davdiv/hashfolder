import type { Database, RunResult } from "better-sqlite3";
import SQLiteDB from "better-sqlite3";
import { existsSync } from "fs";

const DB_VERSION = "hashfolder-v0";

const schema = `
CREATE TABLE files (path TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, mode INT NOT NULL, size INT NOT NULL, cTime INT NOT NULL, mTime INT NOT NULL, lastCheckTime INT NOT NULL);
CREATE TABLE fileHashes (path TEXT NOT NULL, algorithm TEXT NOT NULL, hash BLOB NOT NULL, PRIMARY KEY (path, algorithm), FOREIGN KEY (path) REFERENCES files (path) ON DELETE CASCADE);
CREATE TABLE version (hashfolder_version TEXT PRIMARY KEY);
INSERT INTO version (hashfolder_version) VALUES ('${DB_VERSION}');
`;

export interface DbFileHash {
  path: string;
  algorithm: string;
  hash: Buffer;
}

export const enum DbFileType {
  FILE = "file",
  FOLDER = "folder",
  LINK = "link",
}

export interface DbFile {
  path: string;
  type: DbFileType;
  mode: number;
  size: number;
  cTime: number;
  mTime: number;
  lastCheckTime: number;
}

const createGet = <T extends {} | unknown[], U>(
  db: Database,
  source: string,
) => {
  const res = db.prepare<T>(source);
  return res.get.bind(res) as T extends unknown[]
    ? (...input: T) => U | undefined
    : (input: T) => U | undefined;
};

const createGetAll = <T extends {} | unknown[], U>(
  db: Database,
  source: string,
) => {
  const res = db.prepare<T>(source);
  return res.all.bind(res) as T extends unknown[]
    ? (...input: T) => U[]
    : (input: T) => U[];
};

const createRun = <T extends {} | unknown[]>(db: Database, source: string) => {
  const res = db.prepare<T>(source);
  return res.run.bind(res) as T extends unknown[]
    ? (...input: T) => RunResult
    : (input: T) => RunResult;
};

export const openDatabase = (
  fileName: string,
  { fileMustExist = false, readonly = false } = {},
) => {
  if (!fileMustExist) {
    fileMustExist = readonly || existsSync(fileName);
  }
  const db = new SQLiteDB(fileName, { fileMustExist, readonly });
  db.pragma("journal_mode = WAL");
  if (fileMustExist) {
    let result: undefined | { hashfolder_version: string };
    try {
      result = db
        .prepare("SELECT hashfolder_version FROM version")
        .get() as any;
    } catch (error) {
      throw new Error(
        `File '${fileName}' does not contain a hashfolder database.`,
      );
    }
    if (result?.hashfolder_version != DB_VERSION) {
      throw new Error(
        `File '${fileName}' contains an incompatible version of a hashfolder database, expected ${DB_VERSION}, found ${result?.hashfolder_version}`,
      );
    }
  } else {
    db.exec(schema);
  }

  const getFileHashes = createGetAll<[string], DbFileHash>(
    db,
    "SELECT * FROM fileHashes WHERE path=?",
  );

  return {
    close: () => {
      db.close();
    },
    getAvailableHashAlgorithms: () =>
      getFileHashes(".").map((fileHash) => fileHash.algorithm),
    getFile: createGet<[string], DbFile>(
      db,
      "SELECT * FROM files WHERE path=?",
    ),
    getFileHash: createGet<[string, string], DbFileHash>(
      db,
      "SELECT * FROM fileHashes WHERE path=? AND algorithm=?",
    ),
    getFileHashes,
    upsertFile: createRun<DbFile>(
      db,
      "INSERT INTO files (path,type,mode,size,cTime,mTime,lastCheckTime) VALUES (@path,@type,@mode,@size,@cTime,@mTime,@lastCheckTime) ON CONFLICT (path) DO UPDATE SET type=excluded.type,mode=excluded.mode,size=excluded.size,cTime=excluded.cTime,mTime=excluded.mTime,lastCheckTime=excluded.lastCheckTime",
    ),
    upsertFileHash: createRun<DbFileHash>(
      db,
      "INSERT INTO fileHashes (path,algorithm,hash) VALUES (@path,@algorithm,@hash) ON CONFLICT (path,algorithm) DO UPDATE SET hash=excluded.hash",
    ),
    deleteFileHashes: createRun<string>(
      db,
      "DELETE FROM fileHashes WHERE path=?",
    ),
    removeOldEntries: createRun<number>(
      db,
      "DELETE FROM files WHERE lastCheckTime<>?",
    ),
    listDuplicates: createGetAll<
      [string],
      Pick<DbFile & DbFileHash, "type" | "hash" | "size"> & { count: number }
    >(
      db,
      "SELECT type, hash, size, COUNT(*) as count FROM files INNER JOIN fileHashes ON files.path = fileHashes.path WHERE fileHashes.algorithm=? GROUP BY hash, size, type HAVING count > 1 ORDER BY type, count, size, hash",
    ),
    listByChecksum: createGetAll<[Buffer], DbFile>(
      db,
      "SELECT * FROM files INNER JOIN fileHashes ON files.path = fileHashes.path WHERE fileHashes.hash=?",
    ),
    listByChecksumOfAlgorithm: createGetAll<[Buffer, string], DbFile>(
      db,
      "SELECT * FROM files INNER JOIN fileHashes ON files.path = fileHashes.path WHERE fileHashes.hash=? AND fileHashes.algorithm=?",
    ),
  };
};

export type HashfolderDatabase = ReturnType<typeof openDatabase>;
