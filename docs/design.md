# seerr-cli — Design & Spec

`seerr-cli` is an unofficial, **agent-optimized** command-line client for Seerr
(the Overseerr / Jellyseerr lineage media-request manager). It is built with
**Bun + TypeScript (ESM)** and ships with **zero runtime dependencies** — only
Bun/Node builtins.

The guiding constraint: every command is safe to put in front of an autonomous
agent. Output is a small, stable JSON envelope; exit codes are deterministic;
the API key can never reach the command line, the process list, shell history,
or a transcript.

---

## 1. Scope

The CLI covers the **core request workflow**, not the entire Seerr surface:

- **Connectivity / auth** — check the server, validate the key.
- **Discovery** — search and browse trending / popular media.
- **Lookup** — fetch movie and TV details (including current library status).
- **Requests** — create, list, inspect, approve, decline, delete, and retry.
- **Self-description** — emit a machine-readable manifest of the whole CLI.

Explicitly **out of scope** (for now): user/admin management, settings,
notifications, issues, Sonarr/Radarr server configuration, and any bulk
mutation. These can be added later without changing the architecture.

---

## 2. Architecture

A single **declarative command registry** is the source of truth. Each command
is a `CommandSpec` value (name, summary, args, flags, examples, output shape,
flags like `destructive`/`requiresAuth`, and an async `handler`). That one
array feeds three consumers:

1. **Dispatch** — `matchCommand` greedily matches the longest registered name
   (one or two leading tokens, e.g. `request create`) and routes to the handler.
2. **Help** — top-level `--help` lists `{name, summary}` for every command;
   per-command `--help` echoes that command's args/flags/examples/output.
3. **`describe`** — serializes the registry to a stable JSON manifest so an
   agent can learn the entire interface in one call, no docs scraping.

### Layers (one-directional)

```
config            resolve URL + key, normalize/security-check the base URL
  ↓
SeerrClient       thin typed HTTP wrapper: X-Api-Key, timeouts, retries, error mapping
  ↓
commands          declarative specs + handlers; pure transforms of client data
  ↓
output            { ok, data, meta } envelope, redaction, exit-code mapping
```

Lower layers never import upper layers. `types` is a pure leaf (enums +
decoders + spec types) that imports nothing from the app.

### Tokenizing

Argument parsing is intentionally tiny. The runner peels **global** flags
(`--json`, `--human`, `--raw`, `--url`, `--timeout`, …) off the front, then the
`parse` layer validates the remaining command-specific args/flags against the
command's `CommandSpec` (built on `node:util.parseArgs` semantics). Validation
errors become a `usage`/`validation` `SeerrError` before the handler runs, so
handlers receive already-typed, already-checked input (`Input.int`, `.bool`,
`.seasons`, …).

### Zero runtime deps

Everything is a builtin: `fetch` + `AbortController` for HTTP, `node:fs` for the
config file, `node:os`/`node:path` for paths, `JSON` for I/O, `bun:test` for
tests. A CI guard fails the build if `package.json` ever gains a runtime
dependency.

---

## 3. Command surface

| Command | Auth | Mutates | Summary |
|---|---|---|---|
| `status` | no | no | Server version / update info (`/status`, unauthenticated). |
| `doctor` | no | no | Resolve config, ping `/status`, then validate the key via `/auth/me`. |
| `search <query>` | yes | no | Search movies/TV/people; `--type` filters client-side. |
| `movie <id>` | yes | no | Movie details incl. library status (TMDB id). |
| `tv <id>` | yes | no | TV details incl. seasons and library status (TMDB id). |
| `discover <kind>` | yes | no | Browse `trending` / `movies` / `tv`. |
| `request create` | yes | **yes** | Create a request for a movie or TV show. |
| `request list` | yes | no | List requests with filters + pagination. |
| `request get <id>` | yes | no | Inspect one request. |
| `request approve <id>` | yes | **yes** | Approve a pending request. |
| `request decline <id>` | yes | **yes** | Decline a pending request. |
| `request delete <id>` | yes | **yes**, destructive | Delete a request. |
| `request retry <id>` | yes | **yes** | Re-send a failed request to the downstream service. |
| `describe` | no | no | Machine-readable manifest of every command. |

Notes:

- IDs passed to `movie`/`tv`/`request create` are **TMDB** ids (Seerr's native
  identifier), not internal request ids.
- `request create` takes `--seasons` as a comma list (`1,2,3`) or the literal
  `all`; ignored for movies.
- Destructive commands honor the global `--yes` / `--dry-run` flags.

---

## 4. Output contract

Every invocation prints **exactly one** JSON document and nothing else.

**Success**

```json
{ "ok": true, "data": <payload>, "meta": { ... } }
```

`meta` is optional and carries pagination or context (e.g. `page`,
`totalResults`, `dryRun`). Handlers return `{ data, meta? }`; the runner wraps it.

**Error**

```json
{ "ok": false, "error": { "code", "message", "httpStatus?", "retryable", "hint?" } }
```

Errors go to **stderr**, success to **stdout**, so a caller can separate them by
stream as well as by the `ok` flag.

### Modifiers

- `--human` — pretty-print (2-space indent). Auto-on when stdout is a TTY.
- `--json` — force compact single-line JSON (the agent/pipe default).
- `--raw` / `--data-only` — print just `data`, dropping the envelope, for piping
  into `jq` without unwrapping.
- `--quiet` — suppress non-essential chatter (warnings still go to stderr).

### Exit codes (stable)

| Code | Meaning | Maps from `error.code` |
|---|---|---|
| 0 | success | — |
| 2 | usage / validation | `usage`, `validation` |
| 3 | auth / config / permission | `auth`, `forbidden`, `config` |
| 4 | not found | `not_found` |
| 5 | upstream / network / timeout | `upstream`, `network`, `timeout` |
| 1 | other / unexpected | everything else |

An agent can branch on the exit code without parsing JSON: e.g. `5` is
retryable (transient), `2`/`3` are not (fix the request or the credentials).

---

## 5. Auth & secret handling

The threat model treats the **transcript and process table as hostile**.

- **Config-file-first.** The key is read from (in precedence order):
  `--api-key-file <path>` → `SEERR_API_KEY` env → the config file
  (`$XDG_CONFIG_HOME/seerr/config`, default `~/.config/seerr/config`).
- **No `--api-key` value flag — ever.** Only a *path* (`--api-key-file`) is
  accepted, so the secret can't land in shell history, `ps`, or an agent log.
- **Header only.** The key is sent solely as the `X-Api-Key` header; it never
  goes in the URL or query string. URLs containing `user:pass@` are rejected.
- **Central redaction.** All stdout/stderr passes through one `redact()` pass
  that replaces the exact resolved key with `***` and scrubs stray
  `api_key=…` / `x-api-key: …` patterns. Redaction is scoped to the exact
  secret — it never blanket-masks hex, so commit hashes etc. survive.
- **Errors carry no request context.** `SeerrError` never holds the request
  init, headers, or auth — only a code, message, optional hint, and a parsed
  (already-safe) response body.
- **http-to-public is refused.** Sending the key over plaintext `http://` to a
  non-private host throws a `config` error; `--insecure` overrides it only for
  RFC1918 / `localhost` / `.local` hosts on a trusted LAN.
- **File-mode nudge.** If the config file is group/world-readable, the CLI warns
  to `chmod 600` it.
- **Binary doesn't auto-load `.env`.** Compiled with
  `--no-compile-autoload-dotenv` so a stray `.env` in the CWD can't silently
  inject a key (the `.env.example` convenience is dev-only, via `bun run`).

---

## 6. API grounding (from the Seerr OpenAPI spec)

Decisions pinned to the actual API so the client stays correct:

- **Auth header** is `X-Api-Key`. **Base path** is `/api/v1` (joined onto any
  reverse-proxy sub-path in the configured URL).
- **`/status` is unauthenticated**, so `doctor` uses it for reachability and
  then hits **`/auth/me`** to actually validate the key (a 200 there is the only
  reliable "the key works" signal).
- **Approve and decline are the same route** — `POST /request/{id}/{status}`
  with `status` ∈ `approve` | `decline`. We expose them as two commands over one
  client method to keep the surface obvious.
- **Create body** (`POST /request`): required `mediaType` (`movie`|`tv`) and
  `mediaId` (**the TMDB id**, not an internal id). `seasons` is a `number[]` or
  the string `"all"`. Optional `is4k`, `serverId`, `profileId`, `rootFolder`,
  `languageProfileId`, `userId`. A **201** is a normal create; a **202** means
  "accepted but no seasons were available" — surfaced as a distinct meta note
  rather than a silent success.
- **Search has no server-side `type` param** — `/search` always returns mixed
  movie/tv/person. `--type` is therefore a **client-side** filter applied after
  trimming.
- **Two pagination shapes, deliberately not unified:**
  - **Request list** uses `take`/`skip` and returns `{ pageInfo: { page, pages,
    results }, results }`.
  - **Search / discover** use `page` and return `{ page, totalPages,
    totalResults, results }`.
  Handlers translate each into a uniform `meta` block for the caller.
- **Status enums are two different scales:**
  - **Request status** (`MediaRequest.status`) is numeric **1–3**:
    1 pending, 2 approved, 3 declined.
  - **Media availability** (`MediaInfo.status`) is numeric **1–6**:
    unknown / pending / processing / partially-available / available / deleted.
  Both are decoded to human strings (`decodeRequestStatus`,
  `decodeMediaStatus`) in output so an agent never has to memorize the numbers.
- **`DELETE /request/{id}` returns 204** with no body; the client returns the
  status number and the handler reports `{ deleted: true }`.

### Retries & timeouts

Requests are wrapped in an `AbortController` timeout (default 15s, override with
`--timeout`). **Idempotent GETs** retry with exponential backoff + jitter on
network errors, timeouts, `429`, and `5xx`, honoring `Retry-After`. **Mutations
are never auto-retried** — retrying a create/approve could double-act.

---

## 7. Testing strategy

- **Runner:** `bun test`.
- **Injected `fetch`.** The client takes a `fetchImpl`; tests pass a fake that
  returns recorded responses, so the suite is fully offline and deterministic
  (no network, no real Seerr).
- **Recorded behavior.** Fixtures mirror real Seerr payloads (the two
  pagination shapes, both status enums, the 201-vs-202 create split, 204
  delete) so the trimming/decoding logic is exercised against realistic data.
- **Boundaries covered:** config resolution + precedence, base-URL
  normalization/security (http-to-public refusal, credential-in-URL rejection),
  redaction (key scrubbed, hashes preserved), exit-code mapping, and the
  envelope shape.
- **Live test, gated.** An optional `test/live` suite runs against a real
  instance **only** when `SEERR_API_KEY` is set, and **self-skips when
  `CI=true`**, so CI never needs a real server or secret.

---

## 8. Distribution

- **Source / scripted use:** `bunx @gldc/seerr-cli …` or a global install; the
  `bin` entry points at `src/index.ts` (Bun runs TS directly).
- **Standalone binaries:** `bun build src/index.ts --compile
  --no-compile-autoload-dotenv` produces a self-contained executable with no
  Bun/Node install required — ideal for dropping into an agent sandbox or
  container. CI builds these per-platform.
- **CI** (GitHub Actions) typechecks (`tsc --noEmit`), runs the test suite with
  `CI=true` (live test self-skips), verifies the binary compiles, and runs a
  **zero-dependency guard** that fails if `package.json` ever declares a runtime
  dependency.
