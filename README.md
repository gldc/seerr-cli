# @gldc/seerr-cli

A fast, agent-optimized command-line interface for **Seerr** — the Overseerr/Jellyseerr-lineage
media request manager ([seerr-team/seerr](https://github.com/seerr-team/seerr)). It wraps the Seerr
REST API in a predictable, JSON-first contract designed to be driven by AI agents and scripts.

> **UNOFFICIAL.** This is a community project. It is **not affiliated with, sponsored by, or endorsed
> by** the Seerr team. "Seerr", "Overseerr", and "Jellyseerr" belong to their respective authors.

## Why

Most CLIs are built for humans at a terminal. `seerr-cli` is built for **AI agents** (and the scripts
that wrap them):

- **JSON-first.** Every command emits a single, stable envelope: `{ ok, data, meta? }` on success and
  `{ ok: false, error }` on failure. No prose to parse, no ANSI to strip.
- **Stable exit codes.** Outcomes map to a small, documented set of exit codes (see below) so an agent
  can branch on results without reading the body.
- **Self-describing.** `seerr describe` returns a machine-readable manifest of every command, its
  arguments, flags, and output shape — an agent can learn the whole surface in one call.
- **Secrets stay out of the transcript.** The API key is **never** accepted as a command-line flag, is
  sent only in a request header, and is redacted from all output. An agent literally cannot echo it.

## Install

Requires [Bun](https://bun.sh) (`>= 1.1.0`).

```bash
# Run without installing
bunx @gldc/seerr-cli status

# Install globally (provides the `seerr` binary)
bun install -g @gldc/seerr-cli
seerr status
```

Or download a prebuilt, self-contained binary for your platform from
[GitHub Releases](https://github.com/gldc/seerr-cli/releases) — no Bun runtime needed at run time.

## Configure

Two settings drive everything. `SEERR_URL` is **required** (there is no default); the API key is
required for any command that talks to your account.

| Setting | Required | Notes |
|---|---|---|
| `SEERR_URL` | yes | Full URL of your Seerr instance, e.g. `http://localhost:5055`. |
| `SEERR_API_KEY` | for authed commands | Seerr → **Settings → General → API Key**. |

Resolution precedence:

- **URL:** `--url` flag → `SEERR_URL` env → config file.
- **API key:** `--api-key-file <path>` → `SEERR_API_KEY` env → config file.

The **preferred** setup is a config file at `~/.config/seerr/config` (respects `XDG_CONFIG_HOME`),
two `KEY=VALUE` lines, locked down to your user:

```bash
mkdir -p ~/.config/seerr
cat > ~/.config/seerr/config <<'EOF'
SEERR_URL=http://localhost:5055
SEERR_API_KEY=paste-your-key-here
EOF
chmod 600 ~/.config/seerr/config
```

The CLI warns on stderr if that file is group- or world-readable. Alternatively, export
`SEERR_API_KEY` in the environment, or — **for local development only** — copy `.env.example` to
`.env` (auto-loaded by `bun run`, ignored by the compiled binary).

> The CLI **never** accepts the API key as a flag value. Use `--api-key-file <path>` to point at a file
> instead. This keeps the key out of `ps`, shell history, and any agent transcript.

## Commands

| Command | Auth | Summary |
|---|---|---|
| `status` | no | Seerr version / update info (no key required). |
| `doctor` | no | Diagnose config & connectivity; reports `apiKey` as set/unset only. |
| `search <query>` | yes | Search movies, TV, and people. |
| `movie <id>` | yes | Movie details by TMDB id. |
| `tv <id>` | yes | TV details (incl. seasons) by TMDB id. |
| `discover [trending\|movies\|tv]` | yes | Browse trending / popular media. |
| `request create <movie\|tv> <id>` | yes | Create a request (optionally `--seasons`, `--is4k`). |
| `request list` | yes | List requests with filters & paging. |
| `request get <id>` | yes | Fetch a single request. |
| `request approve <id>` | yes | Approve a pending request. |
| `request decline <id>` | yes | Decline a pending request. |
| `request delete <id>` | yes | Delete a request (destructive; needs `--yes`). |
| `request retry <id>` | yes | Retry a failed request. |
| `describe` | no | Machine-readable manifest of all commands. |

### Examples

```bash
# 1. Is the server up and current?
seerr status

# 2. Find something, then request it (the typical agent flow)
seerr search "the bear"
# -> note the movie/tv id from results[].id, then:
seerr request create tv 136315 --seasons 1,2

# 3. Request a movie in 4K
seerr request create movie 27205 --is4k

# 4. Review and approve the queue
seerr request list --status pending
seerr request approve 42
```

## Output contract

**Success:**

```json
{ "ok": true, "data": { /* command result */ }, "meta": { /* optional */ } }
```

**Error:**

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "Request 999 does not exist",
    "httpStatus": 404,
    "retryable": false,
    "hint": "List requests with `seerr request list`."
  }
}
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `2` | Usage / validation error (bad arguments). |
| `3` | Auth, config, or permission error (e.g. missing/invalid API key). |
| `4` | Not found. |
| `5` | Upstream / network / timeout (often `retryable: true`). |
| `1` | Other / unexpected error. |

### Global flags

| Flag | Effect |
|---|---|
| `--json` | Force JSON output (default when not a TTY). |
| `--human` | Force human-readable output (default in an interactive TTY). |
| `--raw` | Emit the unmodified upstream Seerr payload (skip trimming). |
| `--data-only` | Print just `data`, without the `{ ok, ... }` envelope. |
| `--yes` | Confirm destructive actions non-interactively (e.g. `request delete`). |
| `--dry-run` | Validate and show what would happen without calling the API. |
| `--url <url>` | Override `SEERR_URL` for this invocation. |
| `--api-key-file <path>` | Read the API key from a file (never the key value itself). |
| `--timeout <ms>` | Per-request timeout in milliseconds. |

## For AI agents

Drop this block into your agent's system prompt:

```text
You can manage media requests through the `seerr` CLI. Rules:

1. Run `seerr describe` ONCE at the start to learn the exact commands, arguments,
   flags, and output shapes. Do not guess command syntax.
2. Every command prints a JSON envelope: { "ok": true, "data": ... } on success,
   or { "ok": false, "error": { code, message, httpStatus, retryable, hint } }.
   Parse this, not prose.
3. Branch on the process EXIT CODE:
     0 = success
     2 = you sent bad arguments — fix and retry
     3 = auth/config/permission — STOP and tell the user; do not retry blindly
     4 = not found
     5 = upstream/network/timeout — safe to retry if error.retryable is true
     1 = other — surface error.message and error.hint to the user
4. Before requesting anything, resolve the title to an id with `seerr search "<title>"`.
   Use results[].id and results[].mediaType ("movie" or "tv"). Never invent ids.
5. Treat the `mediaStatus` field as AVAILABILITY: e.g. "available" means the user
   already has it — do not re-request. Only request items that are not yet available.
6. NEVER pass, print, log, or echo the API key. It is configured out-of-band; you do
   not need it and cannot read it. There is no --api-key flag.
7. `request delete` is destructive — pass `--yes` only when the user has confirmed.
```

## Security

The API key is the asset this tool works hardest to protect — keeping it out of argv, stdout/stderr,
and agent transcripts. See **[SECURITY.md](./SECURITY.md)** for the full threat model, mitigations,
and key-rotation guidance.

## Development

```bash
bun install
bun test                       # run the test suite
bun run src/index.ts <cmd>     # run locally (e.g. `bun run src/index.ts status`)
bun run build                  # compile a standalone binary to dist/seerr
```

## License

[MIT](./LICENSE)
