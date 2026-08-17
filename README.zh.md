# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 桌面应用

`dsh` 也可以打包成解包目录形式的桌面应用。它运行的是与 `dsh web` 完全相同的 harness——同样的插件、同样的 UI——但**不占用任何本地端口**。

### 构建

```sh
pnpm run build:desktop                 # full build, then stage and package
pnpm run build:desktop --skip-build    # reuse existing lib/ and apps/web/dist
pnpm run build:desktop --dry-run       # print every command and file change
```

仅支持 Linux x64。产物位于 `dist/desktop/dsh-linux-x64/`：

```
dist/desktop/dsh-linux-x64/
├── dsh                  renamed Electron binary — opens the GUI
├── bin/dsh              CLI wrapper — the same binary under ELECTRON_RUN_AS_NODE
├── resources/app/       the application, plain files (asar disabled)
│   ├── package.json     main: lib/main.js
│   ├── lib/main.js
│   └── node_modules/    pnpm-deployed production closure
└── locales/, *.pak, …   Electron runtime
```

`./dsh` 启动 GUI，`./bin/dsh` 走命令行。

### 分发

产物中不含任何绝对路径，换目录、换机器都能直接运行。压缩时必须使用能保留软链接的格式：

```sh
tar -czf dsh-linux-x64.tar.gz -C dist/desktop dsh-linux-x64
```

`resources/app/node_modules` 是 pnpm 的隔离存储，靠 2980 个相对软链接连通。普通 `zip` 会把它们解引用，使 738 MB 的目录膨胀数倍；请用 `tar` 或 `zip -y`。

有两项主机侧前提是压缩包带不走的：

- `chrome-sandbox` 不带 setuid 位，因此依赖目标主机启用 unprivileged user namespaces。以 root 运行的安装脚本应改为对它执行 `chown root:root` 与 `chmod 4755`。
- 仅面向 glibc 的 Linux x64，未构建其他平台。

### 原理

零端口来自**替换载体，而非替换服务端**。`dsh web` 通过 `dsh-host-webserver` 提供 HTTP；桌面 profile 换成 `dsh-host-electron-carrier`——同一个 `webServer` 服务的第二个 Provider，底层是 Electron 的 `protocol.handle('dsh', …)`。Chromium 在进程内路由这些请求，从不打开套接字，因此 `client-connection`、`client-modules`、`frontend-static`、`client-hmr` 的路由注册完全不用改。

这次替换带来三处衍生改动：

- **下行通道。** 自定义协议没有 WebSocket，因此 `dsh-client-connection` 新增了 `downlink: 'websocket' | 'sse'` 字段。桌面 bundle 选择 `sse`，而 `AbstractApiClient` 的基类实现本就是 SSE；默认值仍是 `websocket`，浏览器路径逐字节不变。
- **信任围栏。** `isTrustedApiRequest` 要求请求带 loopback 的 `Host` 头，而 Chromium 在自定义协议上不发该头。窗口加载 `dsh://127.0.0.1/index.html`，载体从请求 authority 注入 `host: 127.0.0.1`——这是正当的，因为请求从未离开本进程。
- **一个二进制，两个入口。** `bin/dsh` 以 `ELECTRON_RUN_AS_NODE=1` exec 同一个 Electron 二进制。该变量是导出而非就地消费的，因为 harness 会为子进程与 worker 能力重新拉起 `process.execPath`。

打包是 [`scripts/build-desktop.ts`](scripts/build-desktop.ts) 中的一条流水线：构建、`pnpm deploy --legacy --prod` 到 `dist/desktop-staging`、以 `asar: false` 与 `derefSymlinks: false` 调用 `@electron/packager`，最后做两次链接修复。两次修复都不可省略。`link:` 形式的 workspace 依赖——每个 vendored Cordis 包都是——在 deploy 之后仍指回仓库，必须在打包前把目标拷进来；而 packager 的拷贝会把相对链接解析成指向暂存目录的绝对路径，成品里并不存在该目录，因此事后要改写回相对路径。此外 deploy 会把 `--prod` 选择记录在 workspace 根部，所以脚本结束时会重新安装 workspace。

设计决策与验证记录见 [Agent Note](.agents/notes/implemented/architecture/2026-08-17-electron-desktop-shell.md)。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
