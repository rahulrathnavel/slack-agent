import path from "node:path";
import { config } from "../config.js";
import { writeManifestFile } from "./app.js";

const target = process.argv[2] || path.join(config.projectRoot, "slack.manifest.json");
await writeManifestFile(target);
console.log(`Wrote ${target}`);
