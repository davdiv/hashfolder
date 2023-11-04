import PQueue from "p-queue";
import yargs from "yargs";
import { DbFileType, openDatabase } from "./database";
import { findFolderUpdates } from "./update";
import { cpus } from "os";

yargs
  .scriptName("hashfolder")
  .usage("$0 <cmd> [args]")
  .command({
    command: "show dbFile [path]",
    describe: "show the hash of the given file in the database",
    builder: (yargs) =>
      yargs
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file",
        })
        .positional("path", {
          type: "string",
          describe: "path of the file or folder",
          default: ".",
        }),
    handler: async (yargs) => {
      const { dbFile, path } = yargs;
      const db = openDatabase(dbFile!, { readonly: true });
      const result = db.getFile(path);
      db.close();
      console.log(result?.checksum.toString("hex"));
    },
  })
  .command({
    command: "find-checksum dbFile checksum",
    describe: "list all files with the given checksum",
    builder: (yargs) =>
      yargs
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file",
        })
        .positional("checksum", {
          type: "string",
          describe: "checksum to look for in the database",
        }),
    handler: async (yargs) => {
      const { dbFile, checksum } = yargs;
      const buffer = Buffer.from(checksum!, "hex");
      const db = openDatabase(dbFile!, { readonly: true });
      const result = db.listByChecksum(buffer);
      if (result.length > 0) {
        console.log(`Type\tSize\tPath`);
        for (const row of result) {
          console.log(`${row.type}\t${row.size}\t${row.path}`);
        }
      } else {
        console.log("The given checksum was not found in the database.");
      }
      db.close();
    },
  })
  .command({
    command: "find-duplicates dbFile",
    describe: "list duplicate files (having the same hash and length)",
    builder: (yargs) =>
      yargs.positional("dbFile", {
        type: "string",
        describe: "sqlite hashfolder database file",
      }),
    handler: async (yargs) => {
      const { dbFile } = yargs;
      const db = openDatabase(dbFile!, { readonly: true });
      const result = db.listDuplicates();
      if (result.length > 0) {
        let duplicateSize = 0;
        let duplicateFiles = 0;
        console.log(`Checksum${" ".repeat(56)}\tType\tCopies\tSize`);
        for (let row of result) {
          if (row.type === DbFileType.FILE) {
            const extraFiles = row.count - 1;
            duplicateFiles += extraFiles;
            duplicateSize += extraFiles * row.size;
          }
          console.log(
            `${row.checksum.toString("hex")}\t${row.type}\t${row.count}\t${
              row.size
            }`,
          );
        }
        console.log(
          `${duplicateFiles} duplicate file(s), ${duplicateSize} bytes`,
        );
      } else {
        console.log("There is no duplicate file.");
      }
      db.close();
    },
  })
  .command({
    command: "update dbFile folder",
    describe:
      "update (or create) dbFile to contain the list of files from folder, and shows the hash of the full folder content",
    builder: (yargs) =>
      yargs
        .option("concurrency", {
          type: "number",
          describe: "maximum number of files/folders to open in parallel",
          default: cpus().length,
        })
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file to update or create",
        })
        .positional("folder", { type: "string", describe: "folder to index" }),
    handler: async (yargs) => {
      const { dbFile, folder, concurrency } = yargs;
      const db = openDatabase(dbFile!);
      const dbLastCheckTime = Date.now();
      const result = await findFolderUpdates(
        {
          rootPath: folder!,
          dbLastCheckTime,
          db,
          pqueue: new PQueue({ concurrency }),
        },
        ".",
      );
      db.removeOldEntries(dbLastCheckTime);
      db.close();
      console.log(result.checksum.toString("hex"));
    },
  })
  .completion()
  .demandCommand()
  .strict()
  .help().argv;
