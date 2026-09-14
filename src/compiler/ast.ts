import type { Token } from "./token";
export type Expr = Literal | Name | Unary | Binary | Compare | Logical | Conditional | Call | Lambda | Starred | List | ListComprehension | Tuple | Dict | SetLiteral | CollectionComprehension | Slice | Subscript | Attribute | FString;
export interface Starred { kind: "starred"; value: Expr; token: Token; }
export interface Lambda { kind: "lambda"; params: FunctionDef["params"]; value: Expr; token: Token; }
export interface SetLiteral { kind: "set"; values: Expr[]; token: Token; }
export interface CollectionComprehension { kind: "set-comprehension" | "dict-comprehension"; element: Expr; key?: Expr; clauses: ComprehensionClause[]; token: Token; }
export interface Conditional { kind: "conditional"; condition: Expr; consequent: Expr; alternative: Expr; token: Token; }
export interface Literal { kind: "literal"; value: number | string | boolean | null; token: Token; }
export interface Name { kind: "name"; id: string; token: Token; }
export interface Unary { kind: "unary"; op: string; operand: Expr; token: Token; }
export interface Binary { kind: "binary"; op: string; left: Expr; right: Expr; token: Token; }
export interface Compare { kind: "compare"; operands: Expr[]; ops: string[]; token: Token; }
export interface Logical { kind: "logical"; op: "and" | "or"; left: Expr; right: Expr; token: Token; }
export interface Call { kind: "call"; callee: Expr; args: Expr[]; keywords: { name: string; value: Expr; token: Token }[]; token: Token; }
export interface List { kind: "list"; values: Expr[]; token: Token; } export interface Tuple { kind: "tuple"; values: Expr[]; token: Token; }
export interface ComprehensionClause { target: Target; iterable: Expr; filters: Expr[]; token: Token; }
export interface ListComprehension { kind: "list-comprehension"; element: Expr; clauses: ComprehensionClause[]; token: Token; }
export interface Dict { kind: "dict"; entries: { key: Expr; value: Expr; spread?: boolean }[]; token: Token; }
export interface Slice { kind: "slice"; start?: Expr; stop?: Expr; step?: Expr; token: Token; }
export interface Subscript { kind: "subscript"; object: Expr; index: Expr | Slice; token: Token; }
export interface Attribute { kind: "attribute"; object: Expr; name: string; token: Token; }
export type FStringFormat = { kind: "align"; align: "<" | ">" | "^"; width: number; }
  | { kind: "zero"; width: number; }
  | { kind: "fixed"; precision: number; };
export interface FormattedPart { expression: Expr; format?: FStringFormat; }
export interface FString { kind: "fstring"; parts: (string | FormattedPart)[]; token: Token; }
export interface UnpackTarget { kind: "unpack"; values: Target[]; token: Token; }
export interface StarTarget { kind: "star-target"; target: Target; token: Token; }
export type Target = Name | Subscript | Attribute | UnpackTarget | StarTarget;
export interface Assign { kind: "assign"; targets: Target[]; value: Expr; token: Token; }
export interface AugAssign { kind: "augassign"; target: Name | Subscript | Attribute; op: string; value: Expr; token: Token; }
export interface ExprStatement { kind: "expression"; expression: Expr; token: Token; }
export interface If { kind: "if"; branches: { condition: Expr; body: Statement[]; token: Token }[]; otherwise?: Statement[]; token: Token; }
export interface While { kind: "while"; condition: Expr; body: Statement[]; otherwise?: Statement[]; token: Token; }
export interface For { kind: "for"; target: Target; iterable: Expr; body: Statement[]; otherwise?: Statement[]; token: Token; }
export type ParameterKind = "positional" | "varargs" | "varkw" | "keyword-only";
export interface FunctionDef { kind: "function"; name: string; params: { name: string; kind?: ParameterKind; defaultValue?: Expr; token: Token }[]; body: Statement[]; globals: string[]; nonlocals?: string[]; token: Token; }
export interface Return { kind: "return"; value?: Expr; token: Token; }
export interface Global { kind: "global"; names: string[]; token: Token; }
export interface Nonlocal { kind: "nonlocal"; names: string[]; token: Token; }
export interface ClassDef { kind: "class"; name: string; parent?: Expr; body: Statement[]; token: Token; }
export interface With { kind: "with"; value: Expr; name: string; body: Statement[]; token: Token; }
export interface Try { kind: "try"; body: Statement[]; handlers: { type?: string; name?: string; body: Statement[]; token: Token }[]; otherwise?: Statement[]; finalbody?: Statement[]; token: Token; }
export interface Raise { kind: "raise"; value?: Expr; token: Token; }
export interface Delete { kind: "delete"; target: Target; token: Token; }
export interface Assert { kind: "assert"; condition: Expr; message?: Expr; token: Token; }
export interface Pass { kind: "pass"; token: Token; }
export interface Break { kind: "break"; token: Token; } export interface Continue { kind: "continue"; token: Token; }
export interface Import { kind: "import"; module: string; member?: string; binding: string; token: Token; }
export type Statement = Import | Assign | AugAssign | ExprStatement | If | While | For | FunctionDef | Return | Global | Nonlocal | ClassDef | With | Try | Raise | Delete | Assert | Pass | Break | Continue;
export interface Program { kind: "program"; body: Statement[]; }
