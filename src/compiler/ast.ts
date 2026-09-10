import type { Token } from "./token";
export type Expr = Literal | Name | Unary | Binary | Compare | Logical | Call | List | Tuple | Dict | Slice | Subscript | Attribute | FString;
export interface Literal { kind: "literal"; value: number | string | boolean | null; token: Token; }
export interface Name { kind: "name"; id: string; token: Token; }
export interface Unary { kind: "unary"; op: string; operand: Expr; token: Token; }
export interface Binary { kind: "binary"; op: string; left: Expr; right: Expr; token: Token; }
export interface Compare { kind: "compare"; operands: Expr[]; ops: string[]; token: Token; }
export interface Logical { kind: "logical"; op: "and" | "or"; left: Expr; right: Expr; token: Token; }
export interface Call { kind: "call"; callee: Expr; args: Expr[]; keywords: { name: string; value: Expr; token: Token }[]; token: Token; }
export interface List { kind: "list"; values: Expr[]; token: Token; } export interface Tuple { kind: "tuple"; values: Expr[]; token: Token; }
export interface Dict { kind: "dict"; entries: { key: Expr; value: Expr }[]; token: Token; }
export interface Slice { kind: "slice"; start?: Expr; stop?: Expr; step?: Expr; token: Token; }
export interface Subscript { kind: "subscript"; object: Expr; index: Expr | Slice; token: Token; }
export interface Attribute { kind: "attribute"; object: Expr; name: string; token: Token; }
export interface FString { kind: "fstring"; parts: (string | Expr)[]; token: Token; }
export type Target = Name | Subscript | Attribute | { kind: "unpack"; values: Name[]; token: Token; };
export interface Assign { kind: "assign"; targets: Target[]; value: Expr; token: Token; }
export interface AugAssign { kind: "augassign"; target: Name | Subscript | Attribute; op: string; value: Expr; token: Token; }
export interface ExprStatement { kind: "expression"; expression: Expr; token: Token; }
export interface If { kind: "if"; branches: { condition: Expr; body: Statement[]; token: Token }[]; otherwise?: Statement[]; token: Token; }
export interface While { kind: "while"; condition: Expr; body: Statement[]; token: Token; }
export interface For { kind: "for"; target: Target; iterable: Expr; body: Statement[]; token: Token; }
export interface FunctionDef { kind: "function"; name: string; params: { name: string; defaultValue?: Expr; token: Token }[]; body: Statement[]; globals: string[]; token: Token; }
export interface Return { kind: "return"; value?: Expr; token: Token; }
export interface Global { kind: "global"; names: string[]; token: Token; }
export interface ClassDef { kind: "class"; name: string; body: Statement[]; token: Token; }
export interface With { kind: "with"; value: Expr; name: string; body: Statement[]; token: Token; }
export interface Try { kind: "try"; body: Statement[]; handlers: { type?: string; name?: string; body: Statement[]; token: Token }[]; otherwise?: Statement[]; token: Token; }
export interface Pass { kind: "pass"; token: Token; }
export interface Break { kind: "break"; token: Token; } export interface Continue { kind: "continue"; token: Token; }
export type Statement = Assign | AugAssign | ExprStatement | If | While | For | FunctionDef | Return | Global | ClassDef | With | Try | Pass | Break | Continue;
export interface Program { kind: "program"; body: Statement[]; }
