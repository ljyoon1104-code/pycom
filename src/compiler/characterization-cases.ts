// Hand-written programs; no textbook or student source is included.
export const compilerCases = [
  { name: "arithmetic", source: "print(1 + 2 * 3)", output: "7\n" },
  { name: "comparison-chain", source: "print(1 < 2 < 3)", output: "True\n" },
  { name: "short-circuit", source: "print(0 and missing, 2 or missing)", output: "0 2\n" },
  { name: "conditional", source: "if 1:\n    print(2)\nelse:\n    print(3)", output: "2\n" },
  { name: "nested-loops", source: "for x in range(2):\n    for y in range(2):\n        print(x + y)", output: "0\n1\n1\n2\n" },
  { name: "break-continue", source: "for x in range(4):\n    if x == 0:\n        continue\n    if x == 2:\n        break\n    print(x)", output: "1\n" },
  { name: "function-return", source: "def add(x, y=2):\n    return x + y\nprint(add(3))", output: "5\n" },
  { name: "recursion", source: "def fact(n):\n    if n < 2:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))", output: "120\n" },
  { name: "try-except-else-finally", source: "try:\n    print(1)\nexcept ValueError as error:\n    print(error)\nelse:\n    print(2)\nfinally:\n    print(3)", output: "1\n2\n3\n" },
  { name: "return-finally", source: "def f():\n    try:\n        return 1\n    finally:\n        print(2)\nprint(f())", output: "2\n1\n" },
  { name: "class", source: "class Box:\n    def __init__(self, x):\n        self.x = x\nprint(Box(3).x)", output: "3\n" },
  { name: "inheritance-super", source: "class A:\n    def value(self):\n        return 2\nclass B(A):\n    def value(self):\n        return super().value() + 1\nprint(B().value())", output: "3\n" },
  { name: "comprehensions", source: "print([[x * y for y in range(2)] for x in range(2) if x >= 0])", output: "[[0, 0], [0, 1]]\n" },
  { name: "user-module", source: "import helper as h\nfrom helper import value\nprint(h.value, value)", output: "7 7\n" },
] as const;
