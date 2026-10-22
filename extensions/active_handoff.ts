/**
 * active_handoff — hyper_session 세대 전환 (v3 / 세대 3 개정)
 *
 * 사용법:
 *   1) 일반 write/edit 도구로 인수인계 노트를 <자기 작업 폴더>/handoff.md 에 먼저 쓴다.
 *   2) active_handoff 를 인자 없이 부른다.
 * 그 다음 확장이, 검증 → 새 pi 창 기동 → 자기 종료까지 결정적으로 처리한다.
 * LLM가 PID를 계산하거나 명령줄 인용부호를 다루지 않는다.
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
 *  (f) 노트 상단에 '- 상태: CONTINUE|WAIT' 줄을 강제. 없으면 거절.
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

/** (f) 후속이 무엇을 할지 결정할 수 있는 줄. 이 줄 없이는 교대하지 않는다. */
const STATUS_RE = /^\s*-\s*상태:\s*(CONTINUE|WAIT)\s*$/m;

/** 이 확장 코드가 메모리에 올라간 시각. 자서전 self-write 판정의 기준선. */
const MODULE_LOADED_AT = Date.now();

let pi_exec: ExtensionAPI["exec"];

/** handoff 발동 표시. 이 이후 이 세대는 도구도 발화도 하지 못한다. */
let armed = false;

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

	// (a) handoff 이후의 모든 도구 호출을 차단한다. tool_call 핸들러의 block은 fail-safe로
	// 도구를 실행시키지 않는다. 이미 확정된 교대를 이 세대가 뒤집지 못하게 한다.
	pi.on("tool_call", async (event) => {
		if (armed) {
			return { block: true, reason: `active_handoff가 이미 발동됐다: '${event.toolName}' 실행 안 함 (이 세대는 종료 대기 중)` };
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
			"다음 세대를 새 pi 창으로 깨우고 이 세대를 정상 종료한다. 인자 없음. " +
			"호출 전에 인수인계 노트를 자기 작업 폴더(현재 cwd) 안의 handoff.md 에 먼저 쓴다. 다음 세션이 알아야 할 것만 적는다: 미완의 일, 전달하지 않으면 또 할 것 같은 함정, '- 상태: CONTINUE' 또는 '- 상태: WAIT' 줄. " +
			`파일이 없거나 너무 짧거나 ${MAX_BYTES}바이트를 넘거나 너무 오래되거나 이번 프로세스 시작 전에 쓰인 것이거나 '- 상태: CONTINUE|WAIT' 줄이 없으면 거절된다.`,
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (armed) return fail("거절: active_handoff는 1세대 1회. 이미 발동됐다.");

			// ── 1) 전제 조건: 하네스가 강제한다 ─────────────────────────
			// (i) 노트는 이 세대의 작업 폴더 안. ctx.cwd는 세션의 실제 작업 디렉터리.
			const cwd = ctx.cwd;
			const ANCHOR = anchorFor(cwd);
			if (!existsSync(ANCHOR)) {
				return fail(`거절: ${ANCHOR} 가 없습니다. write/edit 로 인수인계 노트를 먼저 쓰십시오.`);
			}
			const st = statSync(ANCHOR);
			if (st.size < MIN_BYTES) {
				return fail(`거절: ${ANCHOR} 가 ${st.size}바이트로 너무 짧습니다(최소 ${MIN_BYTES}).`);
			}
			if (st.size > MAX_BYTES) {
				return fail(
					`거절: ${ANCHOR} 가 ${st.size}바이트로 상한(${MAX_BYTES}) 초과. 압축해서 다시 쓸 것. ` +
						"수행 로그·되풀이 서술·앞 세대 내용을 버리고, 후속이 몰라서 다시 하게 될 것(미완·함정)과 상태 줄만 남긴다.",
				);
			}
			const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000);
			if (Date.now() - st.mtimeMs > MAX_AGE_MS) {
				return fail(`거절: ${ANCHOR} 의 마지막 수정이 ${ageMin}분 전입니다. 노트를 갱신하십시오.`);
			}
			// (c) self-write 강제: 이 프로세스가 확장 코드를 로드한 뒤 쓰인 파일만 인정.
			if (st.mtimeMs < MODULE_LOADED_AT) {
				return fail(
					`거절: ${ANCHOR} 의 마지막 수정(${new Date(st.mtimeMs).toISOString()})이 이 프로세스가 확장을 로드한 시각(${new Date(MODULE_LOADED_AT).toISOString()})보다 앞섭니다. ` +
						"앞 세대가 남긴 글입니다. 네 노트를 네 손으로 덮어쓴 뒤 부르십시오.",
				);
			}

			// (f) 다음 행동이 적혀 있지 않은 노트로는 교대하지 않는다.
			// 상한이 40KB로 커졌으므로 상태 줄 검사 대상도 노트 전체로 확장한다.
			// 앞 4000자로 잘려 있으면 맨 끝의 '- 상태:' 줄을 놓쳐 무조건 거절된다.
			const head = readFileSync(ANCHOR, "utf8");
			if (!STATUS_RE.test(head)) {
				return fail(
					`거절: ${ANCHOR} 에 '- 상태: CONTINUE' 또는 '- 상태: WAIT' 줄이 없습니다. ` +
						"후속이 무엇을 계속할지, 어디서 멈출지 결정할 수 없습니다.",
				);
			}

			// ── 2) 후속 기동: 셸을 거치지 않으니 인용부호 문제 없음 ─────
			const gen = `hyper-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)}`;
			const r = await spawnSuccessor(gen, ANCHOR, cwd);
			if (r.code !== 0) {
				return fail(
					`거절: 후속 기동 실패 (exit ${r.code}).\n${(r.stderr || r.stdout || "").slice(0, 800)}\n` +
						`이 세대는 살아 있습니다. 자서전은 보존되었습니다.`,
				);
			}
			log(`HANDOFF | gen=${gen} | cwd=${cwd} | anchor=${ANCHOR} | bytes=${st.size} | ageMin=${ageMin}`);

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
				log("FORCE_EXIT | graceful shutdown이 8초 안에 끝나지 않음");
				process.exit(0);
			}, 8000).unref?.();

			return {
				content: [
					{
						type: "text",
						text:
							`후속 세대 '${gen}' 을 새 창으로 기동했습니다(cwd=${cwd}). 노트: ${ANCHOR} (${st.size}바이트, ${ageMin}분 전 수정). ` +
							`이 세대는 이 응답 후 종료됩니다. 더 말하지 말고 도구를 부르지 마십시오.`,
					},
				],
				details: { ok: true, gen, anchor: ANCHOR, bytes: st.size, ageMin },
			};
		},
	});
}
