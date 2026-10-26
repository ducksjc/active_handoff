/**
 * active_handoff — hyper_session 세대 전환 (release 0.2.0). Windows 전용.
 *
 * 사용법:
 *   1) 일반 write/edit 도구로 인수인계 노트를 <자기 작업 폴더>/handoff.md 에 먼저 쓴다.
 *   2) active_handoff 를 인자 없이 부른다.
 * 그 다음 확장이, 검증 -> 새 pi 창 기동 -> 자기 종료까지 결정적으로 처리한다.
 * LLM 가 PID를 계산하거나 명령줄 인용부호를 다루지 않는다.
 *
 * 불변식 (미래의 모든 편집이 지켜야 할 것):
 *  - LLM 이 런타임에 읽거나 손으로 쓰는 문자열은 전부 영어로 쓴다. 도구 설명, 거절/가이드/성공
 *    결과문, tool_call 차단 사유, 로그 줄, 툴 label, 계약 앵커 `status` 가 전부 해당한다. 소스
 *    주석과 README 는 한국어로 둔다(사람이 코드를 분석할 때 쓰는 지식).
 *  - 후속 창 첫 메시지는 하드코딩 ASCII 이고 cmd 메타문자 % " ^ & 를 포함하지 않는다.
 *  - 노트는 트랜스크립트가 아니라 포인터다. 판정 숫자는 담당 문서에 먼저 적는다.
 *
 * 개정 이력은 git log 에 있다. 여기에 사본을 두지 않는다 - 사본은 유지되지 않는다. 실측: 이 파일
 * 헤더의 "세대 N 개정" 표기는 0.1.0 배포(6346652)부터 v10 개정(68e9c2c)까지 6개 커밋 내내 v3으로
 * 방치됐었다. 삭제된 v3~v10 개정 기록의 원문은 git show 68e9c2c:extensions/active_handoff.ts.
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 노트는 자기 작업 폴더 안의 handoff.md. cwd는 매 호출 때 ctx.cwd로 받는다. */
function anchorFor(cwd: string): string {
	return join(cwd, "handoff.md");
}
const LOG = join(homedir(), ".pi", "active_handoff.log");
const MIN_BYTES = 200; // 빈 껍데기 자서전으로 세대 넘기는 것 방지
const MAX_BYTES = 40000; // 비대 자서전 방지. 초과 시 압축 후 재작성만 통과.
const MAX_AGE_MS = 60 * 60 * 1000; // 1시간 이상 오래된 파일로는 넘기지 않음

/**
 * 세대 최초 통과 시 한 번 나가는 작성 가이드. LLM 이 런타임에 읽는 문자열이므로 영어(v9).
 * 강제 규칙을 통과한 노트에만 나간다 — 결함 처리와 겹치지 않고, 이미 유효한 노트를 개선하는 데 쓴다.
 * 재작성을 강요하지 않는다(데드락 금지). ASCII 만.
 */
const GUIDE =
	"There are things a handoff must not lose to summarization.\n" +
	"\n" +
	"1. Write the final purpose that must not disappear even if the handoff repeats without end. The user's instructions belong to it, and the latest instruction among them. If an instruction is not long, write it without summarizing; if it is long, summarize it, and if it lives in an external md, state the path as well.\n" +
	"2. Write the overall flow, not only the current step. A successor several relays away needs the same flow you hold.\n" +
	"3. Record the core: decisions already made along the way, and new concepts this work created. These must stay undistorted across tens or hundreds of relays.\n" +
	"4. Out of room? Write it into the md that owns it and leave the path here. A pointer is enough; an empty handoff is not. Instructions about finished work belong in the document that owns that work, with the path left here.\n" +
	"5. Ask twice: what must the very next session know, and what must still be true after a hundred relays. Both belong somewhere - in this file or in a document you name by path.\n" +
	"\n" +
	"This guide is shown once per generation. Review the handoff.md you just wrote against the points above, rewrite it if needed, then call active_handoff again.";

/** 후속이 무엇을 할지 결정할 수 있는 줄. 이 줄 없이는 교대하지 않는다. (v9: 앵커는 영어 `status`) */
const STATUS_RE = /^\s*-\s*status:\s*(CONTINUE|WAIT)\s*$/m;

/** Windows 전용. 그 밖의 플랫폼에서는 이 확장이 아무것도 등록하지 않는다. */
const IS_WINDOWS = process.platform === "win32";

/** 이 확장 코드가 메모리에 올라간 시각. 자서전 self-write 판정의 기준선. */
const MODULE_LOADED_AT = Date.now();

let pi_exec: ExtensionAPI["exec"];

/** handoff 발동 표시. 이 이후 이 세대는 도구도 발화도 하지 못한다. */
let armed = false;

/** 가이드는 프로세스 = 세대당 1회. 이 변수가 그 1회를 결정한다. */
let guideShown = false;
let guideShownAt = 0;
let guideBytes = 0;

function log(line: string): void {
	try {
		appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* 로그 실패는 세대 교대를 막지 않는다 */
	}
}

function fail(text: string) {
	log(`REJECT | ${text.replace(/\s+/g, " ")}`);
	return { content: [{ type: "text" as const, text }], details: { ok: false } };
}

/** 가이드는 결함이 아니다. 태그를 분리해야 REJECT 가 결함 신호로 남는다. */
function guide(anchor: string, bytes: number, text: string) {
	log(`GUIDE | anchor=${anchor} | bytes=${bytes}`);
	return { content: [{ type: "text" as const, text }], details: { ok: false } };
}

async function spawnSuccessor(gen: string, anchor: string, cwd: string) {
	// 디스패치 한 줄. 권위·장르·행동은 전부 노트가 결정한다.
	const firstMessage =
		`Read ${anchor} and do what it says. It is a handover note from the session that just ended.`;
	// wt.exe는 Node에서 exit 0만 반환하고 창을 열지 않았다(앱 실행 별칭).
	// start의 첫 "" 은 창 제목 자리. start가 실행하는 프로그램을 cmd.exe /c로 감싸야
	// 후속이 끝났을 때 셸도 끝나 창이 남지 않는다 (/K면 프롬프트에 고아 cmd가 잔존).
	// pi.exec 시그니처는 (command, args, options). ctx를 첫 인자로 넘기면 그 객체가
	// spawn의 file 인자가 되어 ERR_INVALID_ARG_TYPE가 난다(실측됨).
	// 후속 창은 이 세대와 같은 cwd에서 띄운다 — 그래야 handoff.md를 다시 찾는다.
	return pi_exec(
		"cmd.exe",
		[
			"/c",
			"start",
			"",
			"cmd.exe",
			"/c",
			"pi.cmd",
			"--approve",
			"--name",
			gen,
			firstMessage,
		],
		{ cwd },
	);
}

export default function (pi: ExtensionAPI) {
	pi_exec = pi.exec.bind(pi);

	// win32 이외에서는 조차 등록하지 않는다. cmd.exe/start/pi.cmd 가 전부 없는 플랫폼에서
	// 호출 가능 툴을 노출하면, 사용자는 실패 원인을 알 수 없는 메시지를 받게 된다.
	if (!IS_WINDOWS) {
		log(`SKIP | platform=${process.platform} | active_handoff is Windows-only — nothing registered in this session`);
		return;
	}

	// handoff 이후의 모든 도구 호출을 차단한다. tool_call 핸들러의 block은 fail-safe로
	// 도구를 실행시키지 않는다. 이미 확정된 교대를 이 세대가 뒤집지 못하게 한다.
	pi.on("tool_call", async (event) => {
		if (armed) {
			return { block: true, reason: `active_handoff already fired: '${event.toolName}' will not run (this generation is exiting)` };
		}
		return undefined;
	});

	// 도구 결과가 transcript에 확정된 직후 런을 접는다. shutdown()은 플래그일 뿐이고
	// 실제 종료는 agent_settled에서 일어나므로, abort로 settle을 강제로 데려와 혼잣말을 자른다.
	pi.on("message_end", (_event, ctx) => {
		if (armed && !ctx.isIdle()) ctx.abort();
	});

	pi.registerTool({
		name: "active_handoff",
		label: "Active handoff",
		description:
			"Wakes the next generation in a new pi window and terminates this one cleanly. No parameters. " +
			"Before calling, write the handover note with the write/edit tool at handoff.md inside your own working folder (the current cwd). Write only what the next session needs to know: unfinished work, pitfalls you would otherwise repeat, and a '- status: CONTINUE' or '- status: WAIT' line. " +
			`Refused if the file is missing, too short, over ${MAX_BYTES} bytes, too old, written before this process started, or has no '- status: CONTINUE|WAIT' line. ` +
			"The first call in a generation that passes every rule is a checkpoint, not a handoff: it returns the writing guide once. Read it, review the note, call again.",
		parameters: Type.Object({}),
		// 힌트는 저자의 선언이며 검증되지 않는다. 보수적으로 선언해 확인을 유도한다.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (armed) return fail("refused: active_handoff runs once per generation — it already fired this generation.");

			// ── 1) 전제 조건: 하네스가 강제한다 ─────────────────────────
			// 노트는 이 세대의 작업 폴더 안. ctx.cwd는 세션의 실제 작업 디렉터리.
			const cwd = ctx.cwd;
			const ANCHOR = anchorFor(cwd);
			if (!existsSync(ANCHOR)) {
				return fail(`refused: ${ANCHOR} does not exist. Write the handover note first with write/edit.`);
			}
			const st = statSync(ANCHOR);
			if (st.size < MIN_BYTES) {
				return fail(`refused: ${ANCHOR} is ${st.size} bytes — too short (minimum ${MIN_BYTES}).`);
			}
			if (st.size > MAX_BYTES) {
				return fail(
					`refused: ${ANCHOR} is ${st.size} bytes, over the ${MAX_BYTES} limit. Compress it and rewrite. ` +
						"Drop run logs, repeated narration and previous-generation content; keep only what the successor would otherwise redo (unfinished work, pitfalls) plus the status line.",
				);
			}
			const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000);
			if (Date.now() - st.mtimeMs > MAX_AGE_MS) {
				return fail(`refused: ${ANCHOR} was last modified ${ageMin} minutes ago. Refresh the note.`);
			}
			// self-write 강제: 이 프로세스가 확장 코드를 로드한 뒤 쓰인 파일만 인정.
			if (st.mtimeMs < MODULE_LOADED_AT) {
				return fail(
					`refused: ${ANCHOR} was last modified (${new Date(st.mtimeMs).toISOString()}), before this process loaded the extension (${new Date(MODULE_LOADED_AT).toISOString()}). ` +
						"That is a previous generation's note. Overwrite it with your own note by hand, then call this tool.",
				);
			}

			// 다음 행동이 적혀 있지 않은 노트로는 교대하지 않는다.
			// 상한이 40KB로 커졌으므로 상태 줄 검사 대상도 노트 전체로 확장한다.
			// 앞 4000자로 잘려 있으면 맨 끝의 '- status:' 줄을 놓쳐 무조건 거절된다.
			const head = readFileSync(ANCHOR, "utf8");
			if (!STATUS_RE.test(head)) {
				return fail(
					`refused: ${ANCHOR} has no '- status: CONTINUE' or '- status: WAIT' line. ` +
						"The successor cannot decide what to continue and where to stop.",
				);
			}

			// 강제 규칙을 모두 통과한 노트로 이번 세대 최초 호출 → 가이드로 한 번 거절한다.
			// 위치가 중요하다: 결함은 앞의 게이트에서 REJECT 로 잡히고, 가이드는 유효한 노트에만 돈다.
			if (!guideShown) {
				guideShown = true;
				guideShownAt = Date.now();
				guideBytes = st.size;
				return guide(
					ANCHOR,
					st.size,
					`checkpoint: every rule passed, so this call would hand off - but the writing guide has not run in this generation yet.\n\n${GUIDE}`,
				);
			}

			// ── 2) 후속 기동: 셸을 거치지 않으니 인용부호 문제 없음 ─────
			const gen = `hyper-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
			const r = await spawnSuccessor(gen, ANCHOR, cwd);
			if (r.code !== 0) {
				return fail(
					`refused: successor launch failed (exit ${r.code}).\n${(r.stderr || r.stdout || "").slice(0, 800)}\n` +
						`This generation is still alive. The note is preserved.`,
				);
			}
			// rewrote=: 가이드가 나간 뒤 노트를 실제로 손봤는지. 이 플래그가 쌓이면
			// "가이드가 행동을 바꾸는가"가 추측이 아니라 데이터가 된다.
			const rewrote = st.mtimeMs > guideShownAt ? "yes" : "no";
			log(
				`HANDOFF | gen=${gen} | cwd=${cwd} | anchor=${ANCHOR} | bytes=${st.size} | ageMin=${ageMin} | rewrote=${rewrote} | guideBytes=${guideBytes} | delta=${st.size - guideBytes}`,
			);

			// ── 3) 자기 종료: 결과를 먼저 반환하고, 그 뒤 graceful shutdown ─
			// armed는 결과 반환 이후에 켠다(그래야 이 도구의 toolResult는 정상 기록된다).
			armed = true;
			ctx.shutdown(); // shutdownRequested=true; 실제 종료는 agent_settled
			ctx.abort(); // 런을 즉시 settle시켜 agent_settled를 데려온다(혼잣말 차단)
			// 안전망 1: abort가 안 먹으면 다시 시도.
			setTimeout(() => ctx.abort(), 2000).unref?.();
			// 안전망 2(최후): graceful 경로가 막혔을 때의 하드 exit.
			// 이건 터미널 복원(this.stop)을 건너뛰어 창을 raw mode로 남길 수 있으므로 마지막 수단만 쓴다.
			setTimeout(() => {
				log("FORCE_EXIT | graceful shutdown did not finish within 8s");
				process.exit(0);
			}, 8000).unref?.();

			return {
				content: [
					{
						type: "text",
						text:
							`Successor generation '${gen}' launched in a new window (cwd=${cwd}). Note: ${ANCHOR} (${st.size} bytes, modified ${ageMin} min ago). ` +
							`This generation exits after this response. Do not say anything more and do not call any tool.`,
					},
				],
				details: { ok: true, gen, anchor: ANCHOR, bytes: st.size, ageMin },
			};
		},
	});
}
