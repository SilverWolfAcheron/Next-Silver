import type { DomainPack } from "./domains/pcb";
import type { Brief } from "./types";

export function intakeQuestions(brief: Brief, domain?: DomainPack): string[] {
  return [
    ...(!brief.outcome ? ["期望的完成标准是什么？"] : []),
    ...(!brief.constraints ? ["有哪些约束或不能动的地方？"] : []),
    ...(domain?.seedQuestions.filter(({ fieldKey }) => !brief.domainFields[fieldKey])
      .map(({ question }) => question) ?? []),
  ];
}
