# Silver 桌面程序

Silver 的正式产品是一个 Windows 桌面 EXE。用户安装后从开始菜单或桌面图标打开，窗口里就是 IDE。它不是一个用浏览器访问 `localhost` 的网站。

React 界面由 Vite 构建，正式应用在 Tauri 的 Windows 窗口中加载构建产物。工作区、模型和会话数据由 CLI 负责。

## 1. 两个进程

| 部分 | 给用户的名字 | 职责 |
| --- | --- | --- |
| EXE | Silver | 窗口。显示侧栏、对话、检查器。接收输入，展示进度和差异 |
| CLI | `silver` | 代理运行时。读写工作区，调用模型，跑允许的命令，保存会话，调度多代理和审计 |

EXE 启动时拉起 CLI，两者用本机回环上的一个端口通信，只接受本机连接。窗口最小化、刷新或关掉时，CLI 继续跑当前长任务，进行中的席位不中断。用户在界面里点「停止」才暂停这些席位。从托盘退出程序时，CLI 先把简报、进度、差异和席位状态写完再退出；下次打开从仍是进行中的席位接着调度，不重发已经结束的请求。

CLI 也可以单独在终端里运行，用来排错和做无界面的同一套任务。界面上的每个动作都能对应一条 CLI 子命令，避免窗口里另写一套逻辑。

```text
silver serve                 EXE 连接的本机服务
silver run <工作区>          对一个文件夹执行当前任务
silver check                 在工作区运行允许的测试、类型检查或构建
silver sessions              列出本机保存的对话
```

密钥、对话、简报、工作项和席位写在系统的应用数据目录，例如 `%APPDATA%\Silver`。不写进仓库，不放进浏览器存储。

## 2. Vibe 在这里指什么

Vibe 是用这个桌面程序持续改一个本机项目，并且可以把自己的源码当作那个项目。

用户打开 Silver 源码所在的文件夹后，可以要求它修改 `src`、`src-tauri` 或 CLI。CLI 在这个文件夹里读文件、提交差异、运行 `npm test` 和 `npm run build`。命令输出回到对应工作项。失败时席位阅读输出并在同一项下改下一轮；通过之后，只要差异还没盖住简报，也同样进入下一轮。轮次判断见 [todo-agent.md](todo-agent.md)，长任务的停止条件见 [features.md](features.md) 第 6.2 节。

长任务按下面执行：

- 席位可以反复读目录、文件和搜索。交完差异之后继续看测试和构建结果，再改下一轮。读满若干次或交过一次产物，都不结束这项工作。
- 工作区里允许 `npm test`、类型检查和 `npm run build`。退出码和输出留在该项的文稿产物里，并进入下一轮提示词。
- 任务跑在 CLI 进程里。关掉窗口后再打开，进行中的席位自动接着跑。已经结束的请求不重复发送。

## 3. 技术选择

窗口使用 Tauri 2，界面继续用现在的 React 与 Tailwind。Tauri 负责窗口、打开文件夹、启动和退出 CLI，以及把 CLI 的事件推到界面。选择 Tauri 是为了得到一个本机 EXE，同时留住已经写好的界面。

CLI 使用随 EXE 发布的 Node.js。任务入口位于 `cli/main.ts`，运行状态和轮次由 `cli/conversation.ts`、`cli/iterations.ts` 处理，复用 `src/model` 和 `src/provider`。Tauri 打开原生文件夹选择器，文件读写由 CLI 完成。

Windows 是第一版目标。安装包是一个 EXE。开发时可以用 `cargo tauri dev` 开窗口，正式交付物不是 `npm run dev` 的网页。

## 4. 构建和验收

- `npm run desktop:dev` 启动桌面开发窗口和本机 CLI。开发机需要 Windows x64 Node.js 24、Rust、MSVC 与 WebView2。
- `npm run desktop:build` 生成 Windows x64 NSIS 安装 EXE，位置为 `src-tauri/target/release/bundle/nsis/Silver_0.1.0_x64-setup.exe`。安装包自带 Node.js 和 npm。单独运行 CLI 时，可从安装目录下的 `desktop-runtime` 调用 `silver.cmd`。
- `npm run test:desktop-runtime` 通过实际 CLI 进程、临时原生文件夹和本地模型接口测试长任务。覆盖六轮执行、超过四次读取、检查失败输出进入下一轮、事件连接断开、保存后重启以及已结束席位的请求不重发。
- Windows Release EXE 实测能自动启动附带的 CLI。关闭测试窗口进程时，正在执行的席位仍由同一个 CLI 完成文件写入和检查。重新启动 EXE 可以看到完成的工作项。

确认绑定工作区的开发任务时，CLI 获得应用普通差异和运行检查的授权。删除文件、锁文件、项目脚本配置或超过 20 个文件的变更需要再次确认。手动接受差异仍由 CLI 核对文件原文后写入。允许的检查以工作区为当前目录。项目脚本继承当前操作系统用户权限，执行检查前应确认工作区代码可信。

## 5. 网络代理

CLI 用 Node 内置的 fetch 访问供应商，而 Node 默认不读取 `HTTP_PROXY`/`HTTPS_PROXY`。启动 CLI 时（EXE 拉起 `silver serve`，或终端里运行 `silver`）会补上 `NODE_USE_ENV_PROXY=1`，并在 `NO_PROXY` 中保留 `localhost`、`127.0.0.1`、`::1`：供应商请求走环境变量里的代理，本机回环通信不走代理。

代理由环境变量配置，例如 `HTTP_PROXY=http://127.0.0.1:1081`。只在 Windows 设置里打开「系统代理」而不设置环境变量时，CLI 不会使用它。升级后如果旧的 CLI 进程还活着，EXE 会比较 `endpoint.json` 与运行时脚本的时间戳，判定其来自旧构建并自动重启 CLI。
