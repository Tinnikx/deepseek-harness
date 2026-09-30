# Agent Note: 为 Linux Desktop 窗口附加应用图标

Status: implemented

[English](2026-09-30-desktop-linux-window-icon.md) | 中文

打包沿用 [Linux 发布目标](2026-09-28-desktop-linux-release-target.zh.md)：一个未签名的 AppImage，不安装任何东西。

## Problem

打包后的 Linux Desktop 窗口到达桌面时没有应用图标：任务列表和窗口装饰都显示占位图案。外壳从未附加图标——没有一个 `BrowserWindow` 构造点传过 `icon`，随包的美术资源只被 About 面板读取。发布物也不安装启动入口，所以桌面环境同样无从解析图标。

## Decision

[application-icon.ts](../../../../apps/desktop/src/application-icon.ts) 承载这两条共享事实。`applicationIconPath` 一次性解析随包美术资源——打包态取 `process.resourcesPath` 下的资源，开发态取按平台命名的美术文件——About 面板改为读取它，不再自己保存同一份分支。`publishWindowIcon` 把位图缩到 256 像素并调用 `BrowserWindow.setIcon`；在 macOS 和 Windows 上它直接返回不碰窗口，这两个平台继续从 bundle 和可执行文件资源取图标。`createWindow`、`openWelcomeWindow` 和策略测试登录窗各自在构造之后调用它，无框更新蒙层不调用，因为它们从不进入任务列表。

缩放的存在理由是随包源位图是 1104 像素见方，而窗口图标按面板尺寸绘制。

选择 `setIcon` 而不是 `BrowserWindow` 选项，依据是观察结果，不是读窗口属性。每个产品窗口都藏在启动遮罩之后以隐藏态创建，而在这种窗口上调用 `setIcon` 能在 Wayland 会话里画出图标。X11 属性并不跟随这个结果：显示图标的那个打包窗口仍然保持空的 `_NET_WM_ICON` 数组、也没有 `WM_HINTS`，而同一会话上一个非 Electron 窗口却在该属性里发布了可渲染的 `Icon (128 x 128)`。因此属性检查不是这项功能的合格验证方式，可见的任务列表与窗口装饰才是。

## Alternatives considered

**在窗口选项里传 `icon`。** 在以隐藏态创建的窗口上没有验证过，而这里每个产品窗口都是这样创建的。`setIcon` 已验证，所以外壳不同时携带两套机制。

**改到 X11 后端绘制。** 一个把 Wayland 进程用 `--ozone-platform=x11` 重启的重挂逻辑确实实现并端到端测过：替换进程起来了、拿到了单实例锁、开出了 X11 窗口。它被删除，因为此后仅靠 `setIcon` 就在原生 Wayland 上出现了图标，重挂对本功能毫无收益，而它的代价——所有 Wayland 用户被动降级到 XWayland，失去合成器原生的逐窗缩放与输入处理——不值得付。Wayland 会话继续在 Wayland 上绘制。

**安装启动入口。** 把 `<appId>.desktop` 与缩放后的图标写进用户自己的目录，可以走桌面环境自己的查找来提供图标，还顺带多出一个启动条目；但这改变了 AppImage 在用户系统上留下的东西，而且就地更新的更新器替换文件之后无法重跑这一步。`deb` 或 `rpm` 目标能通过包管理器达到同样效果，而 [Linux 发布目标](2026-09-28-desktop-linux-release-target.zh.md) 已经因为更新器只替换 AppImage 否决了这些格式。

**在 Wayland 上发布图标。** KDE 为此定义了 `xdg_toplevel_icon_manager_v1`，Electron 没有实现。

## Consequences

Linux 用户在两类会话里都能在任务列表和窗口装饰上看到应用图标，且不安装任何文件、不改变发布形态。这里的一切都不影响托盘可用性，那仍然取决于 [已登记的 StatusNotifierItem 检查](2026-09-28-desktop-linux-release-target.zh.md)：在 KDE Plasma 6 上实测，外壳导出了自己的 item，watcher 从不列出它，外壳在自己的确认时限后销毁图标——X11 与 Wayland 皆然。这个缺口仍然敞开。

验证以单测覆盖图标路径——打包态与开发态按平台的解析、Linux 上的附加、非 Linux 上的不附加——并通过各自的 fake 覆盖窗口构造点。可见结果是人工确认：在 Wayland 会话里启动打包的 AppImage，在任务列表和窗口装饰中确认图标，因为在同一个窗口上读 `_NET_WM_ICON` 只会报告空属性，证明不了任何事。
