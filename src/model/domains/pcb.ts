export interface DomainField {
  key: string;
  label: string;
  requirementBinding?: string;
}

export interface SeedQuestion {
  fieldKey: string;
  question: string;
}

export interface DomainPack {
  id: string;
  label: string;
  fields: DomainField[];
  seedQuestions: SeedQuestion[];
  artifactTitles: string[];
}

export const PCB_DOMAIN: DomainPack = {
  id: "pcb",
  label: "PCB 设计",
  fields: [
    { key: "stackup", label: "层数与叠层", requirementBinding: "R1" },
    { key: "nets", label: "关键网络", requirementBinding: "R2" },
    { key: "mechanical", label: "外形与连接器", requirementBinding: "R3" },
    { key: "fab", label: "加工工艺", requirementBinding: "R3" },
  ],
  seedQuestions: [
    { fieldKey: "mechanical", question: "外形和连接器定死了吗？" },
    { fieldKey: "nets", question: "有没有必须守住的阻抗？" },
    { fieldKey: "stackup", question: "这次停在约束，还是要谈到布局取舍？" },
  ],
  artifactTitles: ["约束清单", "取舍纪要"],
};

export const DOMAIN_PACKS: DomainPack[] = [PCB_DOMAIN];

export function getDomain(id: string): DomainPack | undefined {
  return DOMAIN_PACKS.find((d) => d.id === id);
}
