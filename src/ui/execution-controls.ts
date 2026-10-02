import type { ExecutionMode, ExecutionSpeed, ExecutionUpdate } from "../runtime/execution-control";
import type { WorkerRequest } from "../runtime/protocol";

/** Location/status live outside stdout. Fast follow updates intentionally aren't live announcements. */
export function createExecutionControls(parent: HTMLElement, send: (message: WorkerRequest) => void, announce: (text: string) => void) {
  const root = document.createElement("div"); root.className = "execution-controls";
  root.innerHTML = `<label>실행 방식 <select class="execution-mode" aria-label="실행 방식"><option value="normal">일반</option><option value="follow">따라가기</option><option value="step">한 단계</option></select></label><div class="trace-controls" hidden><button class="trace-pause" type="button" disabled>일시정지</button><button class="trace-next" type="button" disabled>다음 단계</button><label>간격 <select class="trace-speed" aria-label="따라가기 간격"><option value="100">100ms</option><option value="500" selected>500ms</option><option value="1000">1초</option></select></label></div><span class="trace-status"></span>`;
  parent.append(root);
  const mode = root.querySelector<HTMLSelectElement>(".execution-mode")!, speed = root.querySelector<HTMLSelectElement>(".trace-speed")!, extra = root.querySelector<HTMLElement>(".trace-controls")!, pause = root.querySelector<HTMLButtonElement>(".trace-pause")!, next = root.querySelector<HTMLButtonElement>(".trace-next")!, status = root.querySelector<HTMLElement>(".trace-status")!;
  let active = false, update: ExecutionUpdate | undefined;
  const render = () => {
    mode.disabled = active; extra.hidden = mode.value === "normal";
    next.disabled = !active || update?.pauseId === undefined || update.state === "input";
    pause.disabled = !active || !update || update.state === "input";
    pause.textContent = update?.state === "paused" ? "계속 실행" : "일시정지";
    const position = update?.location;
    status.textContent = active && position ? `${position.fileName} · ${position.line}줄 · ${update?.state === "input" ? "입력 대기" : update?.state === "paused" ? "일시정지" : "따라가기"}` : "";
  };
  mode.onchange = render;
  speed.onchange = () => { if (active) send({ type: "speed", speed: Number(speed.value) as ExecutionSpeed }); };
  next.onclick = () => { if (next.disabled || update?.pauseId === undefined) return; const pauseId = update.pauseId; update = { ...update, pauseId: undefined }; next.disabled = true; pause.disabled = true; send({ type: "next", pauseId }); };
  pause.onclick = () => {
    if (pause.disabled || !update) return;
    if (update.state === "paused" && update.pauseId !== undefined) { const pauseId = update.pauseId; update = { ...update, pauseId: undefined }; pause.disabled = next.disabled = true; send({ type: "follow", pauseId }); }
    else { pause.disabled = true; send({ type: "pause" }); }
  };
  return {
    get mode(): ExecutionMode { return mode.value as ExecutionMode; },
    get speed(): ExecutionSpeed { return Number(speed.value) as ExecutionSpeed; },
    start() { active = true; update = undefined; render(); },
    finish() { active = false; update = undefined; render(); },
    receive(value: ExecutionUpdate) { update = value; render(); if (value.state === "paused" || value.state === "input") announce(status.textContent ?? ""); },
  };
}
