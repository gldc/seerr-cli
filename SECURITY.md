# Security

`seerr-cli` is designed to be driven by AI agents and scripts. That changes the threat model: the
single most valuable secret — your **Seerr API key** — must never reach an LLM provider or any other
party it wasn't meant for. This document explains what we defend against, how, and the honest limits.

> This is an **unofficial** community tool, not affiliated with or endorsed by the Seerr team.

## Threat model

The asset is the **Seerr API key**. With it, an attacker can read and manipulate your media requests
and user data. The realistic way it leaks when an agent or script is in the loop:

| Vector | How the key would escape |
|---|---|
| **argv / process list** | A `--api-key <value>` flag lands in `ps`, the parent agent's transcript, and exec logs. |
| **stdout / stderr** | The key gets printed in output, errors, or debug dumps that the LLM then ingests. |
| **Environment enumeration** | A tool that dumps `process.env` or `env` ships `SEERR_API_KEY` to the model. |
| **Shell history** | A key typed on the command line is persisted to `~/.bash_history` / `~/.zsh_history`. |
| **Committed files** | A `.env` or config with a real key gets `git add`ed and pushed. |

## How seerr-cli mitigates each

- **No key-value flag.** There is **no** `--api-key <value>` option. The key can only be supplied via
  `--api-key-file <path>`, the `SEERR_API_KEY` environment variable, or the config file. A value passed
  on the command line cannot leak into argv, `ps`, or shell history because the surface to do so does
  not exist.
- **Header-only transmission.** The key is sent solely in the `X-Api-Key` request header — **never** in
  a URL, query string, or path. URLs are safe to log; the key is not in them.
- **Central output redaction.** Every byte written to stdout and stderr passes through a single
  redaction boundary that masks the resolved key. Even an accidental dump of the wrong object cannot
  print it.
- **Errors carry no headers.** The internal `SeerrError` type intentionally never stores request
  headers or the key, so error envelopes (which agents read) can't leak it via `error.body` or hints.
- **`describe` / `doctor` report presence only.** Diagnostic commands show the API key as **set** or
  **unset** — never the value. An agent can verify configuration without ever seeing the secret.
- **Config file hardening.** The preferred store is `~/.config/seerr/config` with mode `600`. If the
  file is group- or world-readable, the CLI emits a `chmod 600` warning on stderr.
- **No stray dotenv in the binary.** The compiled binary is built with `--no-compile-autoload-dotenv`,
  so it will **not** silently pick up a `.env` from the current working directory. `.env` is for local
  `bun run` development only.
- **URL hardening.** The base URL is validated before any request: credentials embedded in the URL
  (`user:pass@host`) are **rejected**, non-`http(s)` schemes are refused, and plaintext `http://` to a
  **public** host is blocked (it would expose the key in transit) unless you explicitly opt in with
  `--insecure` on a trusted private network.

## Honest limitation

These controls protect **normal use** — they stop the key from leaking through the CLI's own surfaces
(flags, output, errors, URLs). They do **not** sandbox an agent that already has raw shell access: such
an agent could simply `cat ~/.config/seerr/config` or read the environment directly. Defending against a
fully shell-capable adversary is **out of scope** for this tool; that is the job of the agent sandbox
and OS permissions. seerr-cli ensures it is never the *easy* path.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Open a private security advisory via GitHub:
  **Security → Advisories → Report a vulnerability** at
  <https://github.com/gldc/seerr-cli/security/advisories/new>.

Please include reproduction steps and the version (`seerr --version`). We aim to acknowledge reports
promptly.

## Key rotation

If a key is ever exposed — in a commit, a log, an agent transcript, anywhere — **rotate it first**:

1. In Seerr, go to **Settings → General → API Key** and regenerate it. This immediately revokes the
   old key.
2. Update your config file or environment with the new value.

> Scrubbing the key from files or rewriting git history does **not** revoke it — anyone who already
> copied it can keep using it until you regenerate it in Seerr. **Rotate first, clean up second.**
