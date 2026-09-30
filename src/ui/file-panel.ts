import type { AppFile } from "../files/storage";
import { typeLabel } from "./presentation";

/** Pure rendering inputs; opening a document remains the caller's operation. */
export function renderFileList(fileList: HTMLElement, files: ReadonlyMap<string, AppFile>, selectedName: string | undefined, openFile: (name: string) => void): void { fileList.replaceChildren(...[...files.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")).map(file => { const button = document.createElement("button"); button.type = "button"; button.className = `file-item${file.name === selectedName ? " selected" : ""}`; button.setAttribute("aria-current", String(file.name === selectedName)); button.innerHTML = `<span></span><small>${typeLabel(file.name)}</small>`; button.querySelector("span")!.textContent = file.name; button.title = `가져오기 인코딩: ${file.encoding.toUpperCase()} · 원본 ${file.byteSize}바이트`; button.addEventListener("click", () => openFile(file.name)); return button; })); }
