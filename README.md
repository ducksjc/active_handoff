# pi-active-handoff

pi extension: rotates the agent to a **new pi process** using a gate-verified handover note.
The LLM writes a handover note, calls the tool, the successor generation boots in a new window,
and the current generation terminates. The gates are enforced by code, not by model judgement.

Package name is `pi-active-handoff`; the repository is `ducksjc/active_handoff`.
**Windows only** — on any other platform the extension loads and registers nothing (see Limits).

# 왜 만들었나?

에이전트가 초장시간 자율 수행을 하는 도중에 무한 컴팩션되면서 발생하는 기억열화의 대안이다.
"좀 더 긴 자율수행"을 계속해서 그 시간을 늘리려면 컴팩션에 대한 대응은 반드시 필요하기에 이 방법을 마련하였다.
서브에이전트 방식을 사용해도 마스터에이전트의 컴팩션은 막을 수 없으며,
서브에이전트를 사용한다고해서 능동인계(active handoff)를 안쓸 이유가 없고, 병행 가능하다. 마스터 에이전트든 서브에이전트든 handoff를 사용하라고 지침을 주면 된다.

# 왜 효과가 있으며, 컴팩션과의 차이점은?

컴팩션은 하네스(pi)가 제공하는 최소한의 규칙기반의 방어선이며, 능동인계를 쓴다 하더라도 여전히 컴팩션은 존재해야만 한다.
능동인계는 모델(llm)이 스스로의 인지능력감소를 고려하여 자율적으로 판단하여 새션이동을 하는 것이다.
24시간 테스트해본바로는 서브에이전트 방식보다 작업효율과 지능수준에서 더 뛰어난 작동을 보였다.
특히 local llm에서 parallel 2 이상을 주기 어려울 때도 좋다.
또한 새션이 한번 망가지기 시작하고 오염(?)당했을 때에 컴팩션은 그걸 자가치유하지 못하는 경우가 대다수인데, 이 핸드오프는 그러한 경우라도 스스로 오염된 새션에서 빠져나오는 방식으로 문제를 해결한다.

컴팩션은 AGENTS.md를 리로드 하지 못한다. 에이전트가 자율수행도중 최고중요 업무지침을 스스로 만들 때 종종 md를 수정하는데, 컴팩션을 당하면서 그러한 기억이 자주 소실된다.
이는 초장기 자율수행에서 치명적인 문제이며, 새션을 새로 만드는 방법으로 그 문제를 해결하였다.

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
   `- status: CONTINUE` or `- status: WAIT` (English token is the contract anchor since v9; the old
   Korean `- 상태:` line is rejected, and the refusal message prints the required form).
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
| status line | `/^\s*-\s*status:\s*(CONTINUE\|WAIT)\s*$/m` over the whole file |
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
