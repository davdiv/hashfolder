# hashfolder

Simple command line tool that can create/update an sqlite database that contains the sha256 hash of all files inside a specified root folder.

- Install globally:

```sh
npm install -g hashfolder
```

- Create or update the database of file hashes:

```sh
hashfolder update myDb.db myRootFolder
```

This also prints the hash of the whole content.

- Show the hash of the whole content from the previously created database:

```sh
hashfolder show myDb.db .
```

- Show the hash of an individual file from the previously created database:

```sh
hashfolder show myDb.db myIndividualFile
```

It should display the same thing as:

```sh
sha256sum myRootFolder/myIndividualFile
```
