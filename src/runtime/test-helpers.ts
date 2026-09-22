import { compile } from "../compiler/compiler";
import { VM, type VMEvent } from "./vm";

export function execute(code: string): { events: VMEvent[]; vm: VM } {
  const events: VMEvent[] = [];
  const vm = new VM(compile(code), event => events.push(event));
  vm.execute();
  return { events, vm };
}
