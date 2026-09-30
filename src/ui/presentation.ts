export const utf8Size = (text: string): number => new TextEncoder().encode(text).length;
export const formatBytes = (value: number): string => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}MB` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}KB` : `${value}바이트`;
export const typeLabel = (name: string) => name.split(".").at(-1)?.toUpperCase() ?? "파일";
