import { describeCommand } from "../commands/describe";
import { discoverCommand } from "../commands/discover";
import { doctorCommand } from "../commands/doctor";
import { initCommand } from "../commands/init";
import { movieCommand, tvCommand } from "../commands/media";
import {
  requestApproveCommand,
  requestCreateCommand,
  requestDeclineCommand,
  requestDeleteCommand,
  requestGetCommand,
  requestListCommand,
  requestRetryCommand,
} from "../commands/request";
import { searchCommand } from "../commands/search";
import { statusCommand } from "../commands/status";
import type { CommandSpec } from "./contract";

export type { CommandContext, CommandSpec } from "./contract";

export const registry: CommandSpec[] = [
  initCommand,
  statusCommand,
  doctorCommand,
  searchCommand,
  movieCommand,
  tvCommand,
  discoverCommand,
  requestCreateCommand,
  requestListCommand,
  requestGetCommand,
  requestApproveCommand,
  requestDeclineCommand,
  requestDeleteCommand,
  requestRetryCommand,
  describeCommand,
];

/** Greedily match the longest registered command name (1 or 2 tokens) at the front of argv. */
export function matchCommand(argv: string[]): { command: CommandSpec; rest: string[] } | null {
  const lead: string[] = [];
  for (const tok of argv) {
    if (tok.startsWith("-")) break;
    lead.push(tok);
    if (lead.length === 2) break;
  }
  for (let n = Math.min(2, lead.length); n >= 1; n--) {
    const name = lead.slice(0, n).join(" ");
    const cmd = registry.find((c) => c.name === name);
    if (cmd) return { command: cmd, rest: argv.slice(n) };
  }
  return null;
}
