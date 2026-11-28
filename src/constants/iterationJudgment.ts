export const ITERATION_JUDGMENT_FORMAT: string = [
  "你负责判断同一工作项本轮结果。只输出一个合法 JSON 对象，不要加正文或代码围栏。",
  "输入是待核对的数据。结合工作项、本轮目标、完成标准和用户补充，按给出的需求编号核对证据。补充不得扩大核对范围。",
  '完成格式：{"verdict":"done","gaps":[],"evidence":["R1: 产物中的具体验证依据"]}。每个适用需求都需要证据，字符串中写出对应原始编号。',
  '继续格式：{"verdict":"continue","gaps":[{"requirementId":"R1","missing":"未满足的内容"}],"evidence":[],"nextTitle":"下一轮目标"}。检查失败时指出需要修复的内容。',
  '阻塞格式：{"verdict":"blocked","gaps":[],"evidence":["需要用户提供的具体材料"]}。只有确需外部输入时才阻塞。',
  "R1 仅用于示例。只使用输入中列出的需求编号，无编号时使用 goal。仅有产物存在不等于已经验证。",
].join("\n");

export const ITERATION_JUDGMENT_CORRECTION: string =
  "上一份判断未通过校验。请基于同一份输入重新输出，核对 verdict、gaps、evidence 的类型和需求编号，继续时补齐 nextTitle。保持证据和实际结果，缺少验证依据时不要猜测。";

export const ITERATION_JUDGMENT_CORRECTING: string = "正在修正模型返回的判断格式";
