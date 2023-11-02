import type { Database, RunResult } from "better-sqlite3";
import SQLiteDB from "better-sqlite3";
import { existsSync } from "fs";

const DB_VERSION = "hashfolder-v0";

const schema = `
CREATE TABLE files (path TEXT PRIMARY KEY, type TEXT NOT NULL, checksum BLOB NOT NULL, size INT NOT NULL, cTime INT NOT NULL, mTime INT NOT NULL, lastCheckTime INT NOT NULL);
CREATE TABLE version (hashfolder_version TEXT PRIMARY KEY);
INSERT INTO version (hashfolder_version) VALUES ('${DB_VERSION}');
`;

export const enum DbFileType {
  FILE = "file",
  FOLDER = "folder",
  LINK = "link",
}

export interface DbFile {
  path: string;
  type: DbFileType;
  checksum: Buffer;
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

  return {
    close: () => {
      db.close();
    },
    getFile: createGet<[string], DbFile>(
      db,
      "SELECT * FROM files WHERE path=?",
    ),
    upsertFile: createRun<DbFile>(
      db,
      "INSERT INTO files (path,type,checksum,size,cTime,mTime,lastCheckTime) VALUES (@path,@type,@checksum,@size,@cTime,@mTime,@lastCheckTime) ON CONFLICT (path) DO UPDATE SET type=excluded.type,checksum=excluded.checksum,size=excluded.size,cTime=excluded.cTime,mTime=excluded.mTime,lastCheckTime=excluded.lastCheckTime",
    ),
    removeOldEntries: createRun<number>(
      db,
      "DELETE FROM files WHERE lastCheckTime<>?;",
    ),
  };
};

export type HashfolderDatabase = ReturnType<typeof openDatabase>;
