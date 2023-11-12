import PQueue from "p-queue";
import yargs from "yargs";
import { DbFileType, openDatabase } from "./database";
import { findFolderUpdates } from "./update";
import { cpus } from "os";
import { hashAlgorithms } from "./hashes";

const defaultHashAlgorithm = "SHA256";

yargs
  .scriptName("hashfolder")
  .usage("$0 <cmd> [args]")
  .command({
    command: "show-hash dbFile [path]",
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
      const { dbFile, path, hash } = yargs;
      const db = openDatabase(dbFile!, { readonly: true });
      const result = db.getFileHashes(path);
      db.close();
      for (const row of result) {
        console.log(`${row.algorithm}: ${row.hash.toString("hex")}`);
      }
    },
  })
  .command({
    command: "find-hash dbFile hash",
    describe: "list all files with the given hash",
    builder: (yargs) =>
      yargs
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file",
        })
        .positional("hash", {
          type: "string",
          describe: "hash to look for in the database",
        })
        .option("algorithm", {
          type: "string",
          choices: hashAlgorithms,
          describe: "hash algorithm",
        }),
    handler: async (yargs) => {
      const { dbFile, hash, algorithm } = yargs;
      const buffer = Buffer.from(hash!, "hex");
      const db = openDatabase(dbFile!, { readonly: true });
      const result = algorithm
        ? db.listByChecksumOfAlgorithm(buffer, algorithm)
        : db.listByChecksum(buffer);
      if (result.length > 0) {
        console.log(`Type\tSize\tPath`);
        for (const row of result) {
          console.log(`${row.type}\t${row.size}\t${row.path}`);
        }
      } else {
        console.log("The given hash was not found in the database.");
      }
      db.close();
    },
  })
  .command({
    command: "find-duplicates dbFile",
    describe: "list duplicate files (having the same hash and length)",
    builder: (yargs) =>
      yargs
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file",
        })
        .option("algorithm", {
          type: "string",
          choices: hashAlgorithms,
          describe: "hash algorithm to use",
        }),
    handler: async (yargs) => {
      const { dbFile, algorithm: requestedAlgorithm } = yargs;
      const db = openDatabase(dbFile!, { readonly: true });
      const availableAlgorithms = db.getAvailableHashAlgorithms();
      if (availableAlgorithms.length === 0) {
        throw new Error("The database contains no hash.");
      }
      if (
        requestedAlgorithm &&
        !availableAlgorithms.includes(requestedAlgorithm)
      ) {
        throw new Error(
          "The requested hash algorithm was not included in the database.",
        );
      }
      const hash =
        requestedAlgorithm ??
        (availableAlgorithms.includes(defaultHashAlgorithm)
          ? defaultHashAlgorithm
          : availableAlgorithms[0]);
      const result = db.listDuplicates(hash);
      if (result.length > 0) {
        let duplicateSize = 0;
        let duplicateFiles = 0;
        console.log(`Type\tCopies\tSize\t${hash}`);
        for (let row of result) {
          if (row.type === DbFileType.FILE) {
            const extraFiles = row.count - 1;
            duplicateFiles += extraFiles;
            duplicateSize += extraFiles * row.size;
          }
          console.log(
            `${row.type}\t${row.count}\t${row.size}\t${row.hash.toString(
              "hex",
            )}`,
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
        .option("algorithm", {
          array: true,
          type: "string",
          choices: hashAlgorithms,
          describe: "hash algorithms to use",
        })
        .option("recompute-all", {
          type: "boolean",
          default: false,
          describe:
            "whether to recompute the hash of all files (even if the dates and size did not change)",
        })
        .positional("dbFile", {
          type: "string",
          describe: "sqlite hashfolder database file to update or create",
        })
        .positional("folder", { type: "string", describe: "folder to index" }),
    handler: async (yargs) => {
      const {
        dbFile,
        folder,
        algorithm: requestedAlgorithms,
        concurrency,
        recomputeAll,
      } = yargs;
      const db = openDatabase(dbFile!);
      let hashes = requestedAlgorithms ?? db.getAvailableHashAlgorithms();
      if (hashes.length === 0) {
        hashes = [defaultHashAlgorithm];
      }
      const dbLastCheckTime = Date.now();
      const result = await findFolderUpdates(
        {
          hashes,
          rootPath: folder!,
          dbLastCheckTime,
          db,
          pqueue: new PQueue({ concurrency }),
          recomputeAll,
        },
        ".",
      );
      db.removeOldEntries(dbLastCheckTime);
      db.close();
      for (const algorithm of Object.keys(result.fileHashes)) {
        console.log(
          `${algorithm}: ${result.fileHashes[algorithm].toString("hex")}`,
        );
      }
    },
  })
  .completion()
  .demandCommand()
  .strict()
  .help().argv;
