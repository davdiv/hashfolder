# hashfolder

[![npm](https://img.shields.io/npm/v/hashfolder)](https://www.npmjs.com/package/hashfolder)

Simple command line tool that can create/update an sqlite database that contains the hash (by default SHA256) of all files inside a specified root folder.

- Install globally:

```sh
npm install -g hashfolder
```

- For the purpose of this tutorial, create a simple folder with some files, including a duplicate file:

```sh
mkdir myRootFolder
echo "content" > myRootFolder/myIndividualFile
cp myRootFolder/myIndividualFile myRootFolder/myIndividualFile2
```

- Create or update the database of file hashes:

```sh
hashfolder update myDb.db myRootFolder
```

This also prints the hash of the whole content:

```
SHA256: b1413456f4c52e05a3db19fa3c7ac819766be08a70b6069af911507a92622057
```

It is possible to configure which hash algorithms are used with the --algorithm parameter (possibly repeated to compute multiple hashes).

Note that hashfolder supports the GIT-SHA1 and GIT-SHA256 algorithms that [git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) uses to compute the hash of blob and tree objects (i.e. files and directories).

- Show the hash of the whole content from the previously created database:

```sh
hashfolder show-hash myDb.db .
```

- Show the hash of an individual file from the previously created database:

```sh
hashfolder show-hash myDb.db myIndividualFile
```

```
SHA256: 434728a410a78f56fc1b5899c3593436e61ab0c731e9072d95e96db290205e53
```

It should display the same checksum as running:

```sh
sha256sum myRootFolder/myIndividualFile
```

- Find duplicates:

```sh
hashfolder find-duplicates myDb.db
```

It displays something like this:

```
Type    Copies  Size    SHA256
file    2       8       434728a410a78f56fc1b5899c3593436e61ab0c731e9072d95e96db290205e53
1 duplicate file(s), 8 bytes
```

- Find all files/folders with the given checksum:

```sh
hashfolder find-hash myDb.db 434728a410a78f56fc1b5899c3593436e61ab0c731e9072d95e96db290205e53
```

It displays something like this:

```
Type    Size    Path
file    8       myIndividualFile
file    8       myIndividualFile2
```
