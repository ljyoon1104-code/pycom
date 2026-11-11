/** Flat browser VFS names are not Windows paths or device names. */
export function validVirtualFileName(name: string): boolean {
  return typeof name === "string" && !!name && name === name.trim()
    && !/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)
    && !name.includes("..") && !/[. ]$/u.test(name);
}

/** Diagnostics never copy an unbounded filename or render invisible directional controls. */
export function fileNameLabel(name: string): string {
  let prefix = 160, suffix = Math.max(0, name.length - 40);
  if (prefix < name.length && /[\ud800-\udbff]/u.test(name[prefix - 1]) && /[\udc00-\udfff]/u.test(name[prefix])) prefix--;
  if (suffix > 0 && /[\udc00-\udfff]/u.test(name[suffix]) && /[\ud800-\udbff]/u.test(name[suffix - 1])) suffix++;
  const displayed = name.length > 200 ? `${name.slice(0, prefix)}…${name.slice(suffix)}` : name;
  const escaped = JSON.stringify(displayed).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return name.length > 200 ? `${escaped} (${name.length}자)` : escaped;
}
