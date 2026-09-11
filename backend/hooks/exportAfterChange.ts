// backend/hooks/exportAfterChange.ts — dark-launched per-host export trigger.
//
// Registered as an `afterChange` hook on every content collection + global. On a
// save it schedules a debounced (single shared timer) re-export of this host's
// Payload DB to data/db/<host>-payload.json (EJSON), so DB edits become
// git-trackable (issue #153). WRITE-ONLY: it never commits, pushes, or merges —
// that stays the operator's deliberate act.
//
// DARK LAUNCH: inert unless the marker file /root/.aoin-export-hook-on exists.
// Deploy with the marker absent (zero behaviour change); activate per-host with
// `touch /root/.aoin-export-hook-on`, rollback with `rm` of the same file.

import { exec } from "child_process";
import { existsSync, mkdirSync } from "fs";
import * as os from "os";
import * as path from "path";
import { AfterChangeHook } from "payload/types";

const MARKER = "/root/.aoin-export-hook-on";
const DEBOUNCE_MS = 3000;

// Single shared timer across ALL collections/globals — rapid saves (even across
// collections) collapse into one export write. Module-level = singleton per
// Payload process.
let timer: NodeJS.Timeout | null = null;

// Derive the host label from the LAN IP's last octet (245/246/247), matching the
// cron's export-commit-push.sh logic.
export function hostLabel(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && /^192\.168\./.test(iface.address)) {
        return iface.address.split(".").pop() || "unknown";
      }
    }
  }
  return "unknown";
}

function runExport(): void {
  const label = hostLabel();
  const repoRoot = path.resolve(__dirname, "../..");
  const script = path.join(repoRoot, "scripts", "export-payload.js");
  const dbDir = path.join(repoRoot, "data", "db");
  const out = path.join(dbDir, `${label}-payload.json`);
  try {
    mkdirSync(dbDir, { recursive: true });
  } catch (e) {
    console.warn("[export-afterChange] mkdir failed:", e);
  }
  const cmd = `AOIN_HOST_LABEL=${label} mongosh --quiet "${script}" > "${out}" 2>/dev/null`;
  exec(cmd, (err) => {
    if (err) console.warn("[export-afterChange] export failed:", err.message);
  });
}

export const exportAfterChange: AfterChangeHook = async () => {
  if (!existsSync(MARKER)) return; // dark launch: inert without the marker
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runExport();
  }, DEBOUNCE_MS);
};
