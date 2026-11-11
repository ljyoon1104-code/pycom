/** Runtime allocation budgets, shared by formatting, representations and collections. */
export const RESOURCE_LIMITS = Object.freeze({
  stringCharacters: 100_000,
  collectionItems: 10_000,
  representationDepth: 64,
  representationVisits: 50_000,
  formatSpecifierCharacters: 128,
  formatPrecision: 100,
});

/** App resource control; never a catchable Python exception. */
export class ResourceLimitError extends Error {}

export function checkTextLength(length: number, message = "문자열 크기 제한을 초과했습니다."): void {
  if (!Number.isSafeInteger(length) || length < 0 || length > RESOURCE_LIMITS.stringCharacters)
    throw new ResourceLimitError(message);
}

/** One budget per conversion, f-string or print call, including all of its parts. */
export class TextBudget {
  private characters = 0;
  private visits = 0;
  constructor(private readonly message = "문자열 크기 제한을 초과했습니다.") {}
  checkAdditional(length: number): void { checkTextLength(this.characters + length, this.message); }
  consume(length: number): void { this.checkAdditional(length); this.characters += length; }
  visit(depth: number): void {
    if (depth > RESOURCE_LIMITS.representationDepth)
      throw new ResourceLimitError("값의 표현 깊이 제한을 초과했습니다.");
    if (++this.visits > RESOURCE_LIMITS.representationVisits)
      throw new ResourceLimitError("값의 표현 작업 제한을 초과했습니다.");
  }
}
