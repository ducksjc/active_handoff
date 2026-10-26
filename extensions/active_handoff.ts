/**
 * active_handoff — hyper_session 세대 전환 (release 0.2.0)
 *
 * 사용법:
 *   1) 일반 write/edit 도구로 인수인계 노트를 <자기 작업 폴더>/handoff.md 에 먼저 쓴다.
 *   2) active_handoff 를 인자 없이 부른다.
 * 그 다음 확장이, 검증 → 새 pi 창 기동 → 자기 종료까지 결정적으로 처리한다.
 * LLM가 PID를 계산하거나 명령줄 인용부호를 다루지 않는다.
 *
 * 아래 "vN에서 고친 것" 은 이 파일의 **내부 개정 라벨(이력)** 이다. 버전 표기는 package.json 의
 * 0.x.y 하나이며 릴리스 태그도 그 하나다(vN 은 릴리스 번호가 아니다). 이번 개정: v10 = 0.2.0.
 *
 * v3에서 고친 것 (모두 실측 근거):
 *  (a) handoff 이후 도구 호출 전면 차단.
 *      ctx.shutdown()은 shutdownRequested=true만 세팅하고 실제 종료는 agent_settled에서
 *      일어난다(interactive-mode.js:1737 / :2968). 그래서 그 사이에 모델이 도구를 더 부를 수 있다.
 *  (b) 혼잣말 차단: 도구 결과가 확정되는 message_end에서 런을 abort해 agent_settled를 강제로
 *      데려온다. abort/shutdown은 ExtensionContext 소속("Available in all contexts")이라
 *      이벤트 핸들러에서 불러도 된다(command-only 경고는 session replacement/reload 쪽 얘기).
 *  (c) self-write 강제: 이 코드가 메모리에 올라간 시각 이후에 쓰인 자서전만 인정한다.
 *      앞 세대가 남긴 글을 그대로 넘기는 "대독"을 결정적으로 막는다.
 *  (d) 후속 창 자기 소멸: start는 .cmd를 새 콘솔 cmd.exe /K로 띄운다(실측: 후속 창 cmdline이
 *      "cmd.exe /K pi.cmd ..."). /K는 pi가 죽은 뒤에도 cmd가 남아 창이 세대마다 쌓인다.
 *      start가 실행할 프로그램을 cmd.exe /c로 감싸면 pi 종료 → cmd 종료 → 창 소멸.
 *      대신 부팅 실패 시 창이 즉시 사라지므로 흔적은 active_handoff.log에 남긴다.
 *      실측: pi의 execCommand를 하네스에서 직접 import해 argv 4종을 돌린 결과
 *      start+배치(/K), start+cmd.exe /c, start+cmd /c, start 없음 전부 exit 0으로 배치 실행에 성공.
 *      argv와 pi.exec는 원인이 아니었다(내 시뮬레이션 파일의 역슬래시 이스케이프가 깨져 있었음).
 *      첫 메시지는 하드코딩된 ASCII이며 cmd 메타문자 % " ^ & 를 포함하지 않는다. 포함시키지 말 것.
 *
 * v4에서 고친 것 (용도: 긴 자율 수행 중의 자동 교대):
 *  (e) 첫 메시지를 얇은 디스패치로 축소. "wait for the user"는 자율 런에서 후속을 idle로 앉힌다
 *      (실측: 후속이 실제로 그렇게 앉았다). 노트가 지시 채널이므로 프레이밍을 여기서 하지 않는다.
 *  (f) 노트 상단에 '- status: CONTINUE|WAIT' 줄을 강제. 없으면 거절. (v9 에서 영어 앵커로 교체)
 *      첫 메시지가 "적힌대로 행동해"가 되는 순간, 다음 행동이 없는 노트는 후속을 멈추게 한다.
 *      LLM 판단 없이 정규식으로 결정적으로 검사한다.
 *  (g) 노트 장르를 '자서전'에서 '인수인계 노트'로 교체. 도구 설명도 같이.
 *
 * v5에서 고친 것:
 *  (h) MAX_BYTES=3600 상한. LLM 노트의 기본값은 비대하므로 상한이 없으면 능동 요약 유인이 없다.
 *      거절 메시지는 압축 지시(트랜스크립트가 아니라 포인터)로 쓴다.
 *      도구 설명의 작성 지침도 최소로 축소: 다음 세션이 알아야 할 것(미완·함정)만.
 *
 * v6에서 고친 것:
 *  (i) 노트 위치를 ~/.pi/auto_handoff.md(전역 단일 파일. v6 이전의 실존 파일명)에서 <세션 cwd>/handoff.md(폴더별)로 이동.
 *      전역 파일은 작업 폴더가 바뀌면 앞 작업의 노트가 새 작업의 노트로 오독된다.
 *      ANCHOR가 상수에서 함수(anchorFor(cwd))로 바뀌고, 후속 창도 같은 cwd에서 기동한다
 *      (pi.exec의 options.cwd — start는 부모 cwd를 상속하므로 --cwd 플래그 불필요).
 *      로그는 계속 ~/.pi/active_handoff.log 한 곳에 모은다(세대 교대 감사 추적은 전역이 편하다).
 *
 * v7에서 고친 것:
 *  (j) MAX_BYTES 3600 → 40000. 노트가 길어질 작업을 인정하는 대신, (f)의 상태 줄 검사를
 *      노트 앞 4000자에서 전체로 확장했다. 안 하면 맨 끝에 적힌 '- 상태:' 줄이 잘려서
 *      긴 노트가 무조건 거절된다(한글은 UTF-8 3바이트라 4000자 ≒ 12KB에 불과).
 *
 * v8에서 고친 것 (공개 배포: 남이 설치해도 깨지지 않게):
 *  (k) 플랫폼 가드. 후속 기동이 cmd.exe + start + pi.cmd 이므로 POSIX에서는 성공할 수 없다.
 *      win32 이외에서는 registerTool 자체를 하지 않는다. 실패할 툴을 모델 앞에 세우는 것보다
 *      아무것도 등록하지 않는 편이 결정적이다(로그에 SKIP 한 줄만 남는다).
 *  (l) annotations. 이 툴은 세대를 종료시키고 창을 열므로 destructive. 권한 확장이 이 힌트를
 *      읽어 호출 확인을 결정할 수 있다(docs/extensions.md:167).
 *
 * v9에서 고친 것 (2026-10-22 user 지시: "LLM 과 상호작용하는 문자열은 전부 영어로"):
 *  (m) LLM 이 런타임에 읽거나 손으로 써야 하는 문자열 전부 영어로 교체 — 도구 설명, 거절/성공
 *      결과문, tool_call 차단 사유, 로그 줄, 툴 label. **계약 앵커도 `- 상태:` → `- status:` 로 하드 스위치**
 *      (옛 노트의 `- 상태:` 줄은 거절된다. 거절 메시지가 요구 형식을 그대로 보여주므로 LLM 이 바로 고친다).
 *      소스 주석과 README 는 원문 유지(사람이 코드 분석할 때 쓰는 지식).
 *      후속 창 첫 메시지는 원래부터 ASCII 영어였다(명령줄 메타문자 금지 불변식은 그대로).
 *
 * v10에서 고친 것 (2026-10-26 user 지시: "규칙도 다 지켰고 가이드도 1회 나간 적이 있다면 이번엔 진짜로 수행"):
 *  (n) 최초 가이드 체크포인트. 강제 규칙(MIN/MAX/AGE/self-write/status)을 **모두 통과한 노트로**
 *      이번 세대 최초로 호출한 경우에만, 가이드 문구로 한 번 거절한다. 그 다음 호출부터는 수행한다.
 *      로그 태그는 REJECT가 아니라 GUIDE로 분리한다. REJECT는 계속 "진짜 결함" 신호로 남아야 한다
 *      (5일 28판 로그에서 REJECT는 1건이었고 그 1건이 실제로 결함이었다. 섞으면 감사 추적이 죽는다).
 *      가이드는 재작성을 강요하지 않는다: 노트를 안 고치고 재호출해도 수행한다. 컨텍스트 한계에
 *      닿은 세대가 핸드오프를 못 하는 데드락이 원천 차단된다. 대신 HANDOFF 로그에 rewrote= 와
 *      guideBytes= 를 찍어, 가이드가 실제로 노트를 고치게 만드는지 세대로 축적해 측정한다.
 *      1번 조항의 근거와 형태는 실측으로 세 번 바뀌었다.
 *      (1) "most recent instruction"로 시작했다: user는 텔레그램으로 중간에 관여하고 그 지시가 앞의
 *          골을 대체한다(실측: #54의 골 "★27 실행 흐름의 단일 소유처 정리" → #55에서 user 인용문
 *          "골 멈추고 일단락해봐..."로 대체).
 *      (2) 그런데 최신만 남긴다(실측: innotant handoff.md 8판에서 user 지시 인용은 26KB 판이나 9KB
 *          판이나 항상 1~2개. 하루 종일 텔레그램으로 수십 번 관여했는데 노트에는 늘 하나). 지시를
 *          3번 하면 마지막 하나만 산다.
 *      (3) 그래서 "장부(전부 원문)"로 넓히려 했더니 이번에는 과잉이었다 — user의 지시가 100줄이거나
 *          이미 md 파일로 주어지는 판이 있어 40,000 bytes에 들어가지 않는다.
 *      (4) 최종 형태는 user가 직접 쓴 초안: **최종 목적**을 축으로 세우고 지시를 그 아래 둔다. 지시가
 *          짧으면 요약 없이, 길면 요약, 외부 md에 있으면 경로를 함께 적는다.
 *      경직은 하나만 남긴다. 되돌릴 수 있는 것(무엇을 얼마나 적을까)은 판단에 맡기고, 되돌릴 수 없는
 *          것(이 세대에서 흔적 없이 지우면 트랜스크립트가 사라져 후속이 영원히 회복 못 함)만 금지한다.
 */

import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** (i) 노트는 자기 작업 폴더 안의 handoff.md. cwd는 매 호출 때 ctx.cwd로 받는다. */
function anchorFor(cwd: string): string {
	return join(cwd, "handoff.md");
}
const LOG = join(homedir(), ".pi", "active_handoff.log");
const MIN_BYTES = 200; // 빈 껍데기 자서전으로 세대 넘기는 것 방지
const MAX_BYTES = 40000; // (h) 비대 자서전 방지. 초과 시 압축 후 재작성만 통과.
const MAX_AGE_MS = 60 * 60 * 1000; // 1시간 이상 오래된 파일로는 넘기지 않음

/**
 * (n) 세대 최초 통과 시 한 번 나가는 작성 가이드. LLM 이 런타임에 읽는 문자열이므로 영어(v9).
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

/** (f) 후속이 무엇을 할지 결정할 수 있는 줄. 이 줄 없이는 교대하지 않는다. (v9: 앵커는 영어 `status`) */
const STATUS_RE = /^\s*-\s*status:\s*(CONTINUE|WAIT)\s*$/m;

/** (k) Windows 전용. 그 밖의 플랫폼에서는 이 확장이 아무것도 등록하지 않는다. */
const IS_WINDOWS = process.platform === "win32";

/** 이 확장 코드가 메모리에 올라간 시각. 자서전 self-write 판정의 기준선. */
const MODULE_LOADED_AT = Date.now();

let pi_exec: ExtensionAPI["exec"];

/** handoff 발동 표시. 이 이후 이 세대는 도구도 발화도 하지 못한다. */
let armed = false;

/** (n) 가이드는 프로세스 = 세대당 1회. 이 변수가 그 1회를 결정한다. */
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

/** (n) 가이드는 결함이 아니다. 태그를 분리해야 REJECT 가 결함 신호로 남는다. */
function guide(anchor: string, bytes: number, text: string) {
	log(`GUIDE | anchor=${anchor} | bytes=${bytes}`);
	return { content: [{ type: "text" as const, text }], details: { ok: false } };
}

async function spawnSuccessor(gen: string, anchor: string, cwd: string) {
	// (e) 디스패치 한 줄. 권위·장르·행동은 전부 노트가 결정한다.
	const firstMessage =
		`Read ${anchor} and do what it says. It is a handover note from the session that just ended.`;
	// wt.exe는 Node에서 exit 0만 반환하고 창을 열지 않았다(앱 실행 별칭).
	// start의 첫 "" 은 창 제목 자리. start가 실행하는 프로그램을 cmd.exe /c로 감싸야
	// 후속이 끝났을 때 셸도 끝나 창이 남지 않는다 (/K면 프롬프트에 고아 cmd가 잔존).
	// pi.exec 시그니처는 (command, args, options). ctx를 첫 인자로 넘기면 그 객체가
	// spawn의 file 인자가 되어 ERR_INVALID_ARG_TYPE가 난다(실측됨).
	// (i) 후속 창은 이 세대와 같은 cwd에서 띄운다 — 그래야 handoff.md를 다시 찾는다.
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

	// (k) win32 이외에서는 조차 등록하지 않는다. cmd.exe/start/pi.cmd 가 전부 없는 플랫폼에서
	// 호출 가능 툴을 노출하면, 사용자는 실패 원인을 알 수 없는 메시지를 받게 된다.
	if (!IS_WINDOWS) {
		log(`SKIP | platform=${process.platform} | active_handoff is Windows-only — nothing registered in this session`);
		return;
	}

	// (a) handoff 이후의 모든 도구 호출을 차단한다. tool_call 핸들러의 block은 fail-safe로
	// 도구를 실행시키지 않는다. 이미 확정된 교대를 이 세대가 뒤집지 못하게 한다.
	pi.on("tool_call", async (event) => {
		if (armed) {
			return { block: true, reason: `active_handoff already fired: '${event.toolName}' will not run (this generation is exiting)` };
		}
		return undefined;
	});

	// (b) 도구 결과가 transcript에 확정된 직후 런을 접는다. shutdown()은 플래그일 뿐이고
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
		// (l) 힌트는 저자의 선언이며 검증되지 않는다. 보수적으로 선언해 확인을 유도한다.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (armed) return fail("refused: active_handoff runs once per generation — it already fired this generation.");

			// ── 1) 전제 조건: 하네스가 강제한다 ─────────────────────────
			// (i) 노트는 이 세대의 작업 폴더 안. ctx.cwd는 세션의 실제 작업 디렉터리.
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
			// (c) self-write 강제: 이 프로세스가 확장 코드를 로드한 뒤 쓰인 파일만 인정.
			if (st.mtimeMs < MODULE_LOADED_AT) {
				return fail(
					`refused: ${ANCHOR} was last modified (${new Date(st.mtimeMs).toISOString()}), before this process loaded the extension (${new Date(MODULE_LOADED_AT).toISOString()}). ` +
						"That is a previous generation's note. Overwrite it with your own note by hand, then call this tool.",
				);
			}

			// (f) 다음 행동이 적혀 있지 않은 노트로는 교대하지 않는다.
			// 상한이 40KB로 커졌으므로 상태 줄 검사 대상도 노트 전체로 확장한다.
			// 앞 4000자로 잘려 있으면 맨 끝의 '- status:' 줄을 놓쳐 무조건 거절된다.
			const head = readFileSync(ANCHOR, "utf8");
			if (!STATUS_RE.test(head)) {
				return fail(
					`refused: ${ANCHOR} has no '- status: CONTINUE' or '- status: WAIT' line. ` +
						"The successor cannot decide what to continue and where to stop.",
				);
			}

			// (n) 강제 규칙을 모두 통과한 노트로 이번 세대 최초 호출 → 가이드로 한 번 거절한다.
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
			// (n) rewrote=: 가이드가 나간 뒤 노트를 실제로 손봤는지. 이 플래그가 쌓이면
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
