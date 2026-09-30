import type { ModuleValue } from "./value";

// The VM still owns the per-run snapshot, cache and frame transition sequence.
export type UserModuleState = { value: ModuleValue; loading: boolean };
