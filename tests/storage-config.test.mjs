import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { DATA_FILES, prepareDataDirectory, resolveDataDirectory } from "../storage-config.mjs";

const base = await fsp.mkdtemp(path.join(os.tmpdir(), "class-routine-storage-"));
const source = path.join(base, "source"), target = path.join(base, "target");
assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())), "Test cleanup must stay inside the OS temp directory.");
await fsp.mkdir(source, { recursive: true });
await fsp.writeFile(path.join(source, DATA_FILES.timetable), "source timetable", "utf8");
await fsp.mkdir(target, { recursive: true });
await fsp.writeFile(path.join(target, DATA_FILES.roster), "keep existing roster", "utf8");
process.env.CLASS_ROUTINE_DATA_DIR = target;

assert.equal(resolveDataDirectory(), path.resolve(target));
const result = await prepareDataDirectory(source);
assert.equal(result.dataDirectory, path.resolve(target));
assert.deepEqual(result.migrated, [DATA_FILES.timetable]);
assert.equal(await fsp.readFile(path.join(target, DATA_FILES.timetable), "utf8"), "source timetable");
assert.equal(await fsp.readFile(path.join(target, DATA_FILES.roster), "utf8"), "keep existing roster", "Existing data must never be overwritten by migration.");
assert.equal(DATA_FILES.integrations, "외부연동설정.json");

await fsp.rm(base, { recursive: true, force: true });
console.log("storage-config: unified path, non-destructive migration, and fixed filenames OK");
