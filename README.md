# Next-Silver

Silver 是装在 Windows 上的桌面 Vibe IDE。窗口用 Tauri 打开，代理运行在随程序发布的本机 CLI `silver` 里。可以对着一个本地文件夹持续改代码，包括改这个仓库自己的源码。

界面是三列：左侧文件和会话，中间打开的文件，右侧对话。长任务在 CLI 里跑，关掉窗口后进行中的席位可以接着做。

## 开发

```text
npm install
npm run desktop:dev
```

`npm test` 跑席位和运行时测试。`npm run desktop:build` 打出 Windows 安装包。

功能说明在 `docs/features.md`，界面在 `docs/design.md`，桌面程序和 CLI 在 `docs/desktop.md`。
