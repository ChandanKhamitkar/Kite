#!/usr/bin/env node
import { existsSync } from "node:fs";

const entry = new URL("../dist/main.js", import.meta.url);
if (!existsSync(entry)) {
  console.error(
    "kite is not built yet. Run `npm run build` first (or `npm run dev` from a checkout).",
  );
  process.exit(1);
}
await import(entry.href);
