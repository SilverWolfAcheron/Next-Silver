# 规范
0. App.tsx 这类入口文件必须干净，不得承载过多业务代码
1. 严格声明和标注类型 包括 for (let i: number ...)，禁止非特殊情况下使用 any 和 unknown
2. 文件长度，.tsx/.css 文件不得超过 1536 行 .ts/.rs 文件不得超过 768 行，超过必须考虑拆分
3. 前端 zustand 必须有对 state 的选择器调用和注册，不能一个改动直接刷新整个 store, <></> 禁止使用，必须使用 Fragment 
4. 前端的 数据，渲染交互 必须严格按 hook 和 tsx 组件拆分，禁止 tsx 文件直接承载过多逻辑
5. 常量必须集中管理，不能散在各类文件中，types 也必须集中管理，分别分门别类放在 src/types 和 src/constants 中