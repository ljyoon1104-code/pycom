/** Exception ancestry shared by except parsing and VM matching. */
export const exceptionParents: Readonly<Record<string, readonly string[]>> = {
  Exception: [], ArithmeticError: ["Exception"], OverflowError: ["ArithmeticError"],
  ZeroDivisionError: ["ArithmeticError"], ValueError: ["Exception"], TypeError: ["Exception"],
  NameError: ["Exception"], UnboundLocalError: ["NameError"], ImportError: ["Exception"],
  LookupError: ["Exception"], IndexError: ["LookupError"], KeyError: ["LookupError"],
  AttributeError: ["Exception"], OSError: ["Exception"], FileNotFoundError: ["OSError"],
  UnsupportedOperation: ["OSError", "ValueError"], RuntimeError: ["Exception"],
  RecursionError: ["RuntimeError"], AssertionError: ["Exception"],
};
export const pythonErrorNames = new Set(Object.keys(exceptionParents).filter(name => name !== "UnsupportedOperation"));
export function exceptionMatches(actual: string, expected: string): boolean {
  return actual === expected || (exceptionParents[actual] ?? ["Exception"]).some(parent => exceptionMatches(parent, expected));
}
