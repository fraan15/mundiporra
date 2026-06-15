import fs from "node:fs";
import path from "node:path";
import { normalizeWorldCupReference } from "../backend/src/services/worldcupReference.js";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Indica la ruta del JSON de origen.");

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const output = normalizeWorldCupReference(source, { generatedFrom: path.basename(sourcePath) });
fs.writeFileSync(
  path.join(root, "backend/data/catalog/worldcup.matches.es.json"),
  `${JSON.stringify(output, null, 2)}\n`
);
