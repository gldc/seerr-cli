import type { SeerrClient } from "../client/seerr";
import type { ResolvedConfig } from "../config";
import type { ArgSpec, FlagSpec, GlobalFlags, HandlerResult } from "../types";
import type { Input } from "./parse";

export interface CommandContext {
  client: SeerrClient;
  config: ResolvedConfig;
  global: GlobalFlags;
}

export interface CommandSpec {
  /** Space-separated command path, e.g. "request create". */
  name: string;
  summary: string;
  args?: ArgSpec[];
  flags?: Record<string, FlagSpec>;
  examples?: string[];
  /** Human description of the trimmed output shape (surfaced in `describe`). */
  output?: string;
  /** Destructive verbs require an explicit --yes (never an interactive prompt). */
  destructive?: boolean;
  /** Defaults to true. When true, a missing API key fails fast with exit 3. */
  requiresAuth?: boolean;
  /**
   * Defaults to true. When false, the command needs no Seerr connection at all,
   * so the runner skips URL/key resolution (e.g. `describe`, for agent
   * self-discovery before any config exists).
   */
  requiresClient?: boolean;
  /**
   * Human-only interactive command (e.g. `init`). The runner runs a dedicated
   * prompt flow instead of the JSON handler, and refuses when there's no TTY.
   */
  interactive?: boolean;
  handler: (ctx: CommandContext, input: Input) => Promise<HandlerResult>;
}
