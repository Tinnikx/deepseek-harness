# Agent Note: Linux Desktop 启动时在动画开屏盖层后直接现身

Status: implemented

[English](2026-09-29-desktop-linux-boot-cover.md) | 中文

macOS 与 Windows 的窗口时机仍由 [已归档的立即开窗决策](../../archived/architecture/2026-09-09-desktop-immediate-window-and-direct-start.md) 管辖；本记录就 Linux 部分部分取代它——Linux 上窗口在启动过程中就出现，而不是启动完成后。关闭即后台的行为沿用 [关闭时隐藏 Desktop 窗口](2026-09-23-desktop-close-to-background-and-quit-confirmation.zh.md)，本改动发布进 Linux 打包的方式遵循 [Linux 发布目标](2026-09-28-desktop-linux-release-target.zh.md)。

## 问题

冷启动的 Linux Desktop 在 Host 进程报告就绪之前不给用户任何可见界面：`createMainWindow` 以隐藏方式建窗，只有 `enterWorkspace` 或欢迎窗口才会显示它，而这可能在启动数秒之后。[已归档的立即开窗决策](../../archived/architecture/2026-09-09-desktop-immediate-window-and-direct-start.md) 选择了在 Host 就绪前展示加载页，但实际落地的时机在三平台上都把窗口留在屏幕外，而它承诺的加载页（页内 `BootPage`）只有窗口可见时才可见。

单纯提前显示窗口会在两处失败。应用文档从 `dsh-app://app/` 加载，其非静态路由在 Host 存在前一律回答 503，而主题背景要等客户端插件挂载之后才到达，所以提前的窗口会闪出一个无色底矩形。盖层也不能住在页面里：前端启动会占满页面自己的主线程，页内 spinner 恰好在它存在的那几秒丢帧，而且页内盖层遮不住页面自己的无色底首帧。

## 决策

Linux 启动时显示一块不透明的动画开屏盖层；macOS 与 Windows 保持隐藏至就绪的时机，相应代码路径零改动。盖层从端到端归 `apps/desktop` 壳所有：

- [boot-cover-document.ts](../../../../apps/desktop/src/boot-cover-document.ts) 以纯函数拼装完整 HTML 文档——带辉光的 `HARNESS` 字标、其后三个各按不同周期环绕的径向渐变极光团、从字标向外脉冲的光晕环作为活动信号、本地化副文案，以及首色 stop 等于平面启动色的渐变底。所有关键帧只动画 transform 与 opacity，被遮盖的页面再忙，合成器也维持动图。文档与调色板（浅色 `#ffffff`/`#0f1115`，深色 `#12081f`/`#f6f4ff`，每个极性各带三个极光色与一条辉光）在建窗时刻按上次运行生效的主题来源选定——壳把每次收到的 `data-ds-theme-source` 缓存进 userData（[theme-source-cache.ts](../../../../apps/desktop/src/theme-source-cache.ts)），因为应用持久主题偏好要等页面挂载后才到得了壳；`system` 或首次启动回退 `nativeTheme.shouldUseDarkColors`——`prefers-reduced-motion` 把动画静止成静态场。副文案是 locale 所有的字符串（两份词典各一条 `bootCoverCaption`）。
- [boot-cover.ts](../../../../apps/desktop/src/boot-cover.ts) 把该文档作为 `WebContentsView` 挂起——一个拥有独立出帧能力的第二渲染器——附加到主窗口的 content view，并用同一启动色填充窗口 `backgroundColor`，让盖层画出之前的几帧显示正确的底色而不是白色。绘制信号取视图 `dom-ready`、`did-stop-loading`、`did-finish-load` 三者最先到达的一个：在 Electron 44 Linux 上实测，`data:` URL 视图永远不触发 `did-finish-load`，只等它的话窗口会一直藏到应用文档自身首次加载完成（该路径保留为兜底）。盖层不带跳过按钮、不带失败面板、不做进度播报：启动失败仍归原生恢复对话框，插件级进度仍归页内 `BootPage`。
- 揭幕信号是主题落定而非挂载：应用 preload 每 50ms 采样 `body` 计算样式里的 `--dsw-alias-bg-base` 与背景色，等有色值稳定 400ms 后置起 `document.documentElement.dataset.dshBootSettled`，覆盖浅色样式表与深色主题属性先后到达的两步。main 每 100ms 通过 `executeJavaScript` 轮询这一个属性，10 秒 deadline 到点无条件揭幕；采样器是计时器而不是 `requestAnimationFrame`，且 Linux 主窗设置 `backgroundThrottling: false`——被完全遮盖的页面停止出帧。静态有主题的页面可能在盖层还不足以被当作开屏页读出之前就已落定，因此 settle 揭幕会让已绘制的盖层至少再停留 700ms（`BOOT_COVER_MIN_VISIBLE_MS`）；在暖启动的本地实测中，盖层阶段比 Host 就绪提前 15 秒以上。页面永远不知道盖层存在——揭幕是 main 在读页面，不是页面在请求 main。
- 盖层提前揭幕的时机：后端启动失败（在 `reportFatal` 打开原生对话框之前，控制器错误发布与调和 catch 两条路都算）、窗口被隐藏（欢迎路径与关闭即后台）、窗口销毁、页面渲染进程丢失、以及被遮盖的首次加载提交之后的全新主框架导航——启动自身的首次导航正是盖层要桥接的那次加载，不触发揭幕（实测：没有这条规则时，盖层在自己首次导航后 400ms 内就被揭掉）。`lift()` 幂等，每个窗口至多一块盖层。

## 考虑过的替代方案

**直接显示普通窗口，让页内 `BootPage` 当开屏页。** 页面得先加载，而主题样式表到达前它只是一个无色底矩形挂在 503 转发的载体上；插件合成期间被丢掉的帧，正是开屏页最需要的那些帧。

**独立的 splash `BrowserWindow`。** 两个顶层窗口在每个 Linux 桌面上都要做焦点与几何编排，二者交接还制造可见跳变；最终窗口内部的一个 view 既不动也不夺焦。

**三平台现在就统一挂盖层。** macOS 走透明 vibrancy 窗口、Windows 走 `titleBarOverlay` 标题栏，两套适配都要各自的实测验证，而本分支的范围是 Linux 发布。

**把 Host 启动阶段播报到盖层上。** `backend.start` 不暴露阶段事件，页内 `BootPage` 已在揭幕之后报告逐插件进度；盖层的 `say` 通道为将来的阶段源保留，目前不使用。

**让页面通过 IPC 通知 main 已就绪。** 那会把揭幕变成产品页面可行使的能力；由 main 读一个 dataset 属性，盖层保持为壳私有界面，并且在重载时天然正确——该属性属于新文档。

## 后果

Linux 用户开机即得一个有主题、带动画的窗口，而不是一段无解释的停顿。代价：启动期多一个渲染进程，建窗与失败路径多一条 Linux-only 分支，以及两个 Electron 测试 mock 的扩展（`WebContentsView`、窗口 `contentView`），让 Linux 路径继续被套件覆盖。400ms 稳定期与 10 秒 deadline 是量出来的余量：太宽会多脉冲一圈光晕，太紧会在闪变上揭幕。macOS 与 Windows 仍未显示 2026-09-09 决策承诺的加载窗口；两平台是否采纳本盖层，是本记录不决定的开放问题。验证方式为 `boot-cover` 与 `boot-cover-document` 两个 spec、`main-startup` 与 `preload-app` 里的 Linux 用例，以及在 Linux 桌面上的一次真实冷启动。
