import PQueue from "p-queue";
import yargs from "yargs";
import { openDatabase } from "./database";
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
      console.log(result.entry.checksum.toString("hex"));
    },
  })
  .completion()
  .demandCommand()
  .help().argv;
