import path from "node:path";
import { fileURLToPath } from "node:url";
import { startClassRoutineServer } from "./local-server.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const instance = await startClassRoutineServer({
  rootDirectory: root,
  port,
  liveReload: true,
  watchFiles: true
});

console.log(`ClassRoutine dev server: ${instance.url}`);
console.log(`ClassRoutine data: ${instance.dataDirectory}`);
if (instance.migrated.length) console.log(`Migrated without deleting originals: ${instance.migrated.join(", ")}`);

async function shutdown() {
  await instance.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
