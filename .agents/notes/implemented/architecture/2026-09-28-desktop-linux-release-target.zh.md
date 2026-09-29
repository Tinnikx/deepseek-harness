# Agent Note: 以 AppImage 形式发布 Linux x64 Desktop 应用

Status: implemented

[English](2026-09-28-desktop-linux-release-target.md) | 中文

打包与更新源沿用 [Electron Desktop 打包与更新决策](2026-08-25-electron-desktop-packaging-and-updates.zh.md)，该记录的首发平台行原先排除 Linux。关闭即后台的行为沿用 [关闭时隐藏 Desktop 窗口](2026-09-23-desktop-close-to-background-and-quit-confirmation.zh.md)；本记录就 Linux 部分部分取代它——Linux 上只有当桌面环境确实提供可见返回路径时，窗口才会隐藏。

## Problem

打包后的 Desktop 应用在开发时能在 Linux 上运行，却无法在那里发布。每个发布目标都以 `mac-arm64`、`mac-x64`、`win-x64` 枚举，Linux 构建主机在准备阶段之前就被拒绝；即使手工打包也会失败：强更策略读取安装平台，对 Windows 和 macOS 之外的系统抛出 `desktop policy: unsupported platform`，出厂应用只会弹出致命对话框而没有窗口。载荷本身从来不是障碍——打包的 Node 与 Python 运行时、`node-pty`、Landlock 启动器、ripgrep 以及沙箱的 `bwrap`/`landlock` 运行链都已声明支持 Linux，Office 转换套件也为没有原生 LibreOffice 包的主机声明了 WASM 引擎。

发布 Linux 还要回答两个问题：一个不签名的产物在会自动更新的产品里意味着什么，以及在既没有 Dock 也不保证有系统托盘的平台上，被隐藏的窗口该怎么办。

## Decision

`linux-x64` 是一等 Desktop 发布目标，产出一个不签名的 AppImage。打包、完成记录、COS 上传计划和更新源把它与既有目标同等对待：通道文件是 `nightly-linux.yml`（稳定版本为 `latest-linux.yml`），二进制对象位于 `bin/linux-x64/`，发布产物名为 `deepseek-harness-<version>-linux-x64.AppImage`。`linux-arm64`、`deb`、`rpm` 以及任何 Linux 签名都不是目标；发布范围停在 x64，因为 Windows 也停在 x64，且没有更多需求。

electron-builder 把 AppImage 的差量更新 blockmap 内嵌在产物里，所以 Linux 发布只上传一个二进制对象，而 macOS 和 Windows 各自上传更新载荷外加独立的 `.blockmap`。更新器就地替换 AppImage，这要求安装直接从 `.AppImage` 文件启动；`--appimage-extract-and-run` 不会留下可供替换的文件。Linux 打包因此不需要任何签名或公证配置，`.env.linux` 只接受共有的发布字段——混进来的 macOS 或 Windows 字段会被拒绝而不是忽略。electron-builder 自行下载 AppImage 工具集，构建主机不需要 squashfs 工具，工具链预检也不增加 Linux 探测项。

出厂的 Linux 应用如实标识自己。强更策略接受 `linux`，并按与其他平台相同的方式上报安装平台与架构；内嵌的 Platform 账户视图和 Host 账户插件发送 `x-client-platform: desktop-linux`，出厂清单携带 `desktopName`，使 Electron 的 Linux 窗口类与 electron-builder 写出的 `.desktop` 条目一致。

dsh Host 是 Node 子进程，Linux 上它的启动器是载荷自带的 Node：Electron 向进程贡献一份 GLib，sharp 捆绑的 libvips 又绑定另一份，图片解码在工作线程上直接段错误，而同一载荷在那个 Node 下解码正常。macOS 与 Windows 继续用 Node 模式的 Electron。运行时准备与出厂包冒烟都用出厂应用实际使用的可执行文件启动 Host，因此这一平台差异不可能未经测试就发布。该 Node 不读取任何 ASAR 归档，所以 Linux 包把 dsh 树解包放在 `resources/app.asar.unpacked/dsh`；electron-builder 在 Linux 上的架构拼写（`x86_64`）由显式产物名覆盖，使每个发布对象都沿用更新源与上传路径使用的 `linux-x64` 目标名。

Linux 上关闭主窗口只有在托盘图标真的被绘制出来时才隐藏。`org.kde.StatusNotifierWatcher` 有属主只是必要条件、并不充分：在 KDE Plasma 6 上实测，Electron 会在会话总线上导出 `org.freedesktop.StatusNotifierItem-<pid>-1`，而 watcher 的 `RegisteredStatusNotifierItems` 列表始终没有它，Wayland 与 X11 两条路径都一样。所以 shell 先询问是否有 shell 拥有 watcher，再用现有的 `DesktopTray` 构建图标，然后最多三秒回读那份列表；只有出现了 watcher 之前没有的条目才开启隐藏窗口，否则销毁图标，关闭按常规退出确认直接退出。没有 watcher 的会话——未装 AppIndicator 扩展的 GNOME、裸合成器、或没有会话总线——根本不构建图标。两条失败路径都以退出结束，而不是留下一个没人能重新打开的隐藏窗口，因为被弃置的 Host 会继续运行却没有返回路径。任务栏闪烁与 Windows 一起成为更新提醒界面；macOS 仍使用 Dock 弹跳。

## Alternatives considered

**用单一目标表拥有所有发布目标。** 目标清单分散在六个脚本里，形状各不相同，而跨文件同步测试的存在就是为了盯住它们。增加第七种形状的重构比本次改动更大，还会在载荷行为同时变化时强迫所有消费者经过同一个模块，因此每份清单只是各自加上 `linux-x64` 一行，重复留在已有测试看管的位置。

**AppImage 之外再加 `deb`。** `deb` 更便于包管理器安装，却得不到自动更新——electron-updater 只替换 AppImage——于是只多出一种产物、一份打包元数据和一个手动安装通道，而没有相应需求。等到确有分发方要求时再加。

**Linux 无条件关闭即退出。** 最简单且永不困住窗口，但会把正在运行的 agent 和定时提醒在用户执行后台化手势时切断，而 macOS 和 Windows 都把这一手势当作后台。按桌面会话分别选择，就能在有返回路径处继续任务运行。

**总是创建托盘并隐藏。** 没有 StatusNotifier 属主时 Electron 的 Linux 托盘静默失败，正是本决策要避免的困住窗口的场景；画不出来的托盘不是返回路径。

**只相信 watcher 的名字。** 一次 `NameHasOwner` 回答曾在这里是最初的规则，前提假定是拥有 watcher 的 shell 会绘制任何向它注册的条目。KDE Plasma 6 会回答那次查询，却仍然不把 Electron 的条目列出来，结果就是把窗口藏到一个没人看得见的图标后面。回读已注册列表只多花几次启动时的会话总线读取，而且只在 watcher 已经存在的场合运行。

**把 Linux shell 报成 `desktop-mac`。** 沿用旧的误标不需要改动契约，分析会继续把 Linux 会话计入 Mac。`desktop-linux` 是 `x-client-platform` 请求头上 Platform 服务尚未确认的新取值；若 Platform 拒绝该值，请求头取值回退，本段记录这一结果。

**掩盖 About 面板图标的平台差异。** 打包的 `resources/icon.png` 在所有平台都是 Windows 磁贴美术，而 Linux 与 macOS 不同，会在自己的 About 面板里绘制它。给 Linux 放原画，既保证可见标识正确，又不改动 macOS 与 Windows 被归档完整性校验钉住的产物字节。

## Consequences

Linux 用户得到能自我更新的单文件发布、如实的客户端标识，以及在其桌面环境支持时的关闭即后台行为。仓库在六份枚举里多出第四个发布目标、多一份 dotenv 文件、多一条产物通道，并且原先只在 Windows 使用的托盘代码现在由两个可用性不同的平台共享。

代价：Linux 发布无法签名或公证，首次运行依赖用户自己的下载完整性校验而不是平台签名；发布范围保证仅限 x64；`desktop-linux` 仍待 Platform 服务确认；AppImage 的自动更新只有在安装就地从 AppImage 文件运行时才成立。Linux 托盘及其首次隐藏确认是用户可感知的，因此即便面板图标复用既有美术而非新字形，发布前仍需设计复核。验证一次 Linux 发布仍需发布操作者执行真实的 COS 上传和一次跨版本更新，因为在没有已发布对象的情况下，更新源和差量下载都无法预演。
