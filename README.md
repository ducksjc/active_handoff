# pi-active-handoff

pi extension: rotates the agent to a **new pi process** using a gate-verified handover note.
The LLM writes a handover note, calls the tool, the successor generation boots in a new window,
and the current generation terminates. The gates are enforced by code, not by model judgement.

Package name is `pi-active-handoff`; the repository is `ducksjc/active_handoff`.
**Windows only** — on any other platform the extension loads and registers nothing (see Limits).

## Install

```bash
pi install git:github.com/ducksjc/active_handoff@v0.1.0   # pinned tag
pi install https://github.com/ducksjc/active_handoff      # same, URL form (tracks the default branch)
pi install C:/path/to/active_handoff                      # local dir, loaded without copying
pi -e ./extensions/active_handoff.ts                      # one-shot load, nothing written to settings
pi list                     # configured packages
pi remove git:github.com/ducksjc/active_handoff@v0.1.0
pi update --extensions      # reconcile git checkouts (a pinned ref is not moved)
```

Personal installs are written to `~/.pi/agent/settings.json`. Project scope (`--local`) loads
only after project trust is granted.

Prerequisites on the installing machine:

- pi itself is on `PATH` as **`pi.cmd`**. The successor is started by name, and npm's global shim
  provides `pi.cmd` on Windows (verified at `C:\Program Files\nodejs\pi.cmd`). If pi is not on PATH,
  the tool refuses with a non-zero exit and the current generation stays alive.
- The calling pi owns a console: run it in a normal terminal window, not from print/RPC/headless mode.

## Use

1. Write `<cwd>/handoff.md` with the `write`/`edit` tool. It must contain a status line:
   `- 상태: CONTINUE` or `- 상태: WAIT` (Korean token is the contract anchor).
2. Call the tool `active_handoff` (no parameters).
3. The tool returns, the successor generation starts, this generation exits. Do not speak, do not
   call tools after the tool result.

Gate rules (all enforced in code, deterministic):

| Check | Rule |
|---|---|
| location | `<cwd>/handoff.md` — per-folder, not global |
| size | >= 200 bytes, <= 40000 bytes (refuses oversized notes with a compression instruction) |
| freshness | last modified within 60 minutes |
| self-write | last modified **after** this process loaded the extension (blocks "reading aloud" an inherited note) |
| status line | `/^\s*-\s*상태:\s*(CONTINUE\|WAIT)\s*$/m` over the whole file |
| once per generation | tool refuses a second call |

Successor: `cmd.exe /c start "" cmd.exe /c pi.cmd --approve --name hyper-<digits> "Read <anchor> and
do what it says..."` in the **same cwd**. The first message is hardcoded ASCII with no cmd
metacharacters. `cmd /c` (not `/K`) so the shell dies with pi and no orphan prompt is left.
Audit trail: `~/.pi/active_handoff.log` (`HANDOFF`, `REJECT`, `FORCE_EXIT` lines).

After the tool result the extension blocks every tool call, aborts the run at `message_end`, retries
abort at 2 s, and hard-exits at 8 s as the last resort.

## Windows only. Verified limits

- **Non-Windows: the extension registers nothing.** On `process.platform !== "win32"` the entry point
  returns before `registerTool`, leaving one `SKIP` line in the log. Installing it there is harmless
  but does nothing; `pi.cmd` and `cmd.exe` do not exist, so a callable-but-failing tool would be worse.
  `package.json` also declares `"os": ["win32"]`.
- `cmd.exe` + `start` is the console opener. POSIX is not supported.
- `start` requires the **parent process to own a console**. Measured: from a process with no console
  `start` returns **exit 0 and opens nothing** (silent). pi's interactive TUI owns a console, so the
  handoff works there. print/RPC/headless contexts are unsupported.
- `pi.exec` spawns the child with `stdio: ["ignore","pipe","pipe"]` fixed (`pi` `dist/core/exec.js:10`),
  so `stdio:"inherit"` is not available from a tool. The successor must own its own terminal, which
  `start` provides.
- `wt.exe` (Windows Terminal app alias) returns exit 0 without opening a window. Do not use it.
- **macOS has never been tested.** The Windows-only contract is deliberate, and it is enforced in
  code by the platform guard above.
- After a successful handoff the **previous** generation's window shows a red
  `Error: This operation was aborted` line before the shell prompt returns. That is the run being
  aborted to suppress post-handoff monologue; the process exits normally and is not a failure.

## Not included

No bash payload, no Git Bash dependency, no tmux, no in-process session rotation. In-process
`ctx.newSession()` exists on `ExtensionCommandContext` (user-initiated commands only), **not** on the
tool `execute()` context, so an LLM-initiated true new session cannot be done inside one process.
That is why process rotation is the mechanism.
