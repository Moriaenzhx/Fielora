# Fielora UI/UX System V0.1

状态：`CURRENT / CANONICAL / CHANGE-SYNCHRONIZED`

产品视觉语言由 `docs/product/FIELORA_DESIGN_LANGUAGE_V0.1.md` 定义；本文定义 Desktop Renderer 如何实现、约束和演进该语言。任何受管理 UI/UX 系统文件的变化，必须在同一 changeset 更新本文。`pnpm verify:ui-ux` 强制检查这一规则。

## 1. 当前布局基线（锁定）

材质、字体、图标和控件优化不得改变以下 ownership：

```text
DesktopChrome
├─ Window Chrome（系统菜单与窗口按钮，共用一个 Chrome plane）
└─ Desktop Work Area
   ├─ Active Route
   │  ├─ Project Workspace
   │  │  ├─ Project Navigation
   │  │  ├─ Conversation Content
   │  │  └─ Right Workspace Dock（按需）
   │  ├─ Browse
   │  ├─ Settings
   │  │  ├─ Settings Navigation
   │  │  └─ Settings Content
   │  └─ Scheduled
   │     ├─ Shared Project Navigation
   │     └─ Scheduled Content
   ├─ Utility Workspace（按需）
   └─ Bottom Terminal（按需）
```

- Conversation 与 Right Workspace Dock 是同一个连续 `Content` 背景上的两个工作视图，不建立两套页面底板。
- Settings 与 Scheduled 的 Content pane 使用 `--fl-radius-work-surface` 左上接入 Chrome；Conversation 使用更克制的 `--fl-radius-conversation-surface`（Standard `16px`，Small/Large `12px / 20px`）。其外层 shell 只在既有圆角切口处露出同一 Brand Chrome canvas，保证弧度真实可见而不向正文着色。Conversation 右上角保持直角，不随 Brand Chrome 调整。
- Window Chrome、Project Navigation 与 Settings Navigation 保持同一个连续 Chrome owner，并通过显式 `data-brand-chrome="top|navigation"` 消费可替换的 Brand Chrome token bundle。Light 使用一张跨整个 viewport 的低饱和近白薰衣草/雾粉画布，Navigation 以 `-44px` 纵向偏移续接顶栏；顶栏进入原生 Window Controls Overlay 前必须平滑收敛到当前 Sidebar solid/gradient 的右端色，并将同一 HEX 传给 native caption，主题切换和自定义色都不得产生竖向接缝。该作用域不得进入 Conversation、Settings Content、Right Workspace Dock、Right Dock Tab Strip、Utility Workspace 或 Overlay。
- Settings 与 Scheduled 内容区复用同一 `Content` 背景；Scheduled 直接复用 Project 的 Primary Navigation，二者均通过共享 `WorkspaceSurface` 持有相同宽度偏好与 resizer。
- Bottom Terminal 是工作区底层，不进入左侧导航，也不成为第四列。
- Composer 浮在完整 Conversation viewport 上；滚动区延伸至 Pane 底部并通过 bottom padding 避让。
- Workspace/Navigation/Dock/Terminal 的 resizer、窄窗口 overlay 行为和所有权保持现状。材质 changeset 不得改 DOM ownership、grid topology 或 Pane routing。

Canonical geometry 位于 `styles/layout.css`；真实页面结构由 `WorkspaceSurface`、`ProjectWorkspace`、`RightWorkspaceDock` 和 `DesktopChrome` 持有。

2026-09-07 Conversation 校准：用户明确要求整个对话内容区统一居中并增加左右留白。
用户消息、Assistant 正文、运行记录、Markdown 代码/表格、结果与变更列表共用 `1040px` reading rail；
Composer 与 queued follow-up 使用同一 rail 和 `clamp(28px, 5cqw, 56px)` 最小 gutter。
按用户最新桌面截图将普通窗口的内容再略向内收，宽窗 rail 上限仍为 1040px，窄栏保留至少 28px。
不再分别使用 680/700/720px 的内部宽度上限。文字保持左对齐，用户气泡仍在公共 rail 内靠右。
Conversation Header 保持原 ownership，左 inset 固定复用 Navigation 外边距与菜单内边距之和，
图标到标题的间距与菜单文字起点对齐，不再按宽窗 reading rail 向右缩进。Dock 关闭时为 window-right controls 预留至少 `144px`，
打开时为 Project 摘要按钮预留 `60px`，标题及更多操作不得进入该命中区域；摘要按钮位置跟随实际
Conversation 右边界，不能使用窄窗可能被压缩或裁切的 Dock 偏好宽度推算。
摘要 Portal host 在 DesktopChrome 内保持挂载，离开 Project 时隐藏；设置、资料库等页面返回后，
ProjectWorkspace 可立即找到既有 host，不能因两个组件更新路由的时序差异丢失摘要按钮。
既有 Composer/Queue 的 ResizeObserver 只更新当前 Pane 的遮挡高度变量，滚动尾部和回到底部按钮
随真实输入框高度避让；不改变浮动锚点、Pane topology 或 Runtime。

至少四个已展示的用户轮次且对话需要纵向滚动时，在 Conversation 左侧留白显示低对比短横线导航。
每条横线对应一个用户轮次，当前阅读轮次加深；悬停/键盘聚焦提示轮次与请求摘要，点击或 Enter
跳转至对应用户消息。支持上下方向键及 Home/End，在大量轮次时标记区独立滚动并保持当前项可见。
轮次列表随对话切换、新消息及排队消息状态更新；滚动、过程展开和输入框尺寸变化后重新定位。
导航避让输入框及排队区，不改变公共 reading rail，主动回看历史后沿用既有“回到最新”行为。

运行过程按真实事件顺序展示简短进展。工具组默认折叠为一行，可展开全部操作；每项操作可进一步
展开完整路径/行号/搜索词/命令、状态、结束时间和已有错误码。时间仅在操作详情显示，删除父组与子项
重叠 hover 提示。长段分析和包含代码块的过程说明默认显示 bounded 原文预览，点击展开完整 Markdown。
最终答案保持完整；结束后的“查看执行记录”使用同一套折叠组件，已记录的 Run failure code 同时映射为
直接可见的原因。此 presentation 不改变 Run 状态、预算、恢复或完成裁决。
历史 `fielora-project-file:` 标记只在匹配本 Run 成功 read_file 的路径和 SHA 回执后变成可打开的文件链接，
打开复用现有 Project file viewer 和 SHA guard；其他标记只显示标签，不直接导航自定义 URL。

Workbench 比例同样属于锁定布局，不属于材质：Project/Settings/Scheduled Navigation 默认 `304px`、允许在 `220–560px` 内调整并共享宽度偏好；Right Workspace Dock 默认 `635px`、最小 `360px`；Conversation Pane 最小 `340px`，reading column 为 `1040px`，Composer 为 `1040px`。应用初始窗口保持 `1180px` 宽，初始窗口高度等于允许的最小高度 `560px`；用户之后仍可正常调整窗口。Navigation 收起时必须释放整个导航列与 resizer，Conversation、Settings 或 Scheduled Content 原地扩展占用可用 Work Area。Settings、Scheduled 与 Conversation 复用同一 `WorkspaceSurface` 和 Content frame，Settings 不显示 Project 工具按钮，Settings 与 Scheduled Content 自身纵向滚动。Dock 不使用截图像素形成固定上限：可用上限始终为当前 Project Work Area 扣除实际 Navigation、Conversation 最小宽度与 resizer 后的剩余宽度。用户拖动得到的偏好宽度独立持久化；窗口缩小时仅临时 clamp，窗口再次放大时恢复该偏好宽度。历史版本持久化的极窄值在读取时恢复为当前默认比例。窄窗口策略与 Pane ownership 不变。Conversation 与 Right Workspace Dock 之间始终保留可发现但低对比的 `1px` neutral gray divider；它只消费 Light/Dark 对应的 `--fl-color-workspace-divider`，不得从 Brand Chrome、Accent 或用户 Action Color 混色。拖动命中区可以更宽，但视觉线及 hover/dragging 状态始终保持 `1px`，不得表现成厚边框。Project Navigation 与 Conversation 之间的 resizer 默认不可见，hover 只显示极轻 neutral edge，dragging 才适度增强；其命中宽度不得随视觉线宽变化。拖动开始时一次性缓存 Work Area、Navigation 和动态 max，pointer move 每帧只更新宽度 CSS variable，结束时才提交 React state 与持久化；Browser native view 的 bounds 同步必须 latest-only 合并，纯几何变化不得反复回写 Browser React state。

Right Workspace Dock 的“＋”只在至少存在一个标签时显示；零标签状态由 Dock 内的工具启动页提供入口，不重复显示空 Tab Strip 操作。关闭最后一个标签或手动收起 Dock 时，Conversation minimum、divider 与 Dock width 使用可插值 length track 在 `--fl-duration-panel` 内同步收起，Panel 内容同时淡出并向右移动；若用户启用 Reduced Motion，仍遵守全局无动画设置。

Right Workspace Dock 的扩展/恢复同样只能改变上述可插值 track：Conversation 连续收窄/恢复并淡出/淡入，Dock 在 `--fl-duration-panel` 内占满/退回用户偏好宽度，不得通过两套不兼容的 `grid-template-columns` 瞬切。直接拖动 Divider 时则关闭该 track transition；coalesced pointer samples 只取最新位置，并继续以 `requestAnimationFrame` 合并为每帧一次 CSS width 更新，结束时才提交 React state 与持久化。代码视图可以在拖动期间暂停重复 syntax paint，但必须保持原始代码文字可见并在释放后立即恢复。Reduced Motion 继续由全局设置即时关闭面板过渡。

2026-09-07 Divider 修复：普通分栏仍保留 Conversation `340px` minimum；继续向左越过动态分栏上限
`48px` 后进入既有 Dock focus，保留分栏宽度偏好。保持同次 pointer capture，回拉至上限外 `12px`
以内退出 focus，避免边界抖动；往右收起与反向恢复沿用既有行为。没有新增 Pane 或迁移 Resizer ownership。
面板几何只对解析后的 `grid-template-columns` 做一次插值，不再同时动画化输入 track。
点击展开/恢复期间由真实 transition run/end/cancel 暂停 syntax layer 的 layout/paint，textarea 保持同一代码文字，
结束或取消后立即恢复高亮；拖动同样跳过高亮子树排版。摘要控制位置只写入其自身 host，按像素去重，
不再每帧更新 body 的继承变量，也不对已按帧测量的位置再叠加 `right` transition。
语法 token 节点只在代码内容或语言改变时重建，单纯打开面板、调整宽度或切换 focus 不重新分词。
真实 Electron 回归需覆盖 compact 窗口代码文件、拖动进入/退出 focus、偏好恢复、动画中代码可见及结束后清理。

Tab Strip 的“＋”紧跟在 bounded tab lane 的右边，不得被拉伸到 window controls 前形成孤立按钮；点击后显示由 `document.body` Portal 承载的 fixed Tool Menu。该 Menu 使用触发器的 viewport bounds 定位，在窗口边缘自动翻转并保持至少 `8px` inset，不得受 Tab Strip、单标签 Browser host 或 Right Dock overflow 裁剪。通用 Workspace Tab 通过受控右键 Menu 提供重新加载、复制、重命名、关闭、关闭其他与关闭右侧标签；Browser Page 继续复用 Browser Runtime 的原生 Page context menu。Conversation branch 不属于 File/Tool Tab 语义，不得伪装成 Workspace Tab 操作。

全局 Summon、浮动 Summon 按钮、`Ctrl+Shift+Space`、右侧“侧边聊天”工具和 `Ctrl+Alt+S` 已从当前产品删除。右侧 Dock 的零标签启动页固定只提供审阅、PowerShell、浏览器和文件四个入口；“工作对象”不再作为常驻工具，与文件预览形成重复心智。Agent 新建的 Artifact 仍直接打开为独立 Tab，底层持久化、版本与上下文能力保持。模型交互由 Project Conversation / Agent 工作流拥有，Inbox 与模型服务设置继续作为独立 Surface 存在，不以隐藏入口保留第二套 Summon UI。

## 2. Cascade Ownership

2026-09-24 执行过程展示：Settings → General 增加“精简 / 详细”，沿既有 v2 本地 UI preferences 持久化 `agentDisplayMode`，旧偏好默认 COMPACT，不进入 Core、模型请求或权限状态。App 在 Project 工作面提供同一 React context，当前与历史 AgentTurn 共用。精简模式按真实时间顺序保留叙述与逐项灰色单行操作，不再要求先展开分组；每条操作独立展开命令、参数、回执和退出码，长行截断，文件名可沿既有 File/Review 打开，底部变更数折叠为摘要，运行文本以 2.2 秒低幅度灰色呼吸呈现；暂停/等待审批/结束均不呼吸，系统与用户 Reduced Motion 设置生效。详细模式默认展开完整事件顺序、工具参数、状态/时间，仍允许收起。Skill/能力/结束工具使用具体动作标签，避免全部落为“检查相关信息”；命令参数按记录原值展示。旧命令回执未保存 stdout/stderr 原文时明确说明缺失，不把 hash 或空白称为实际输出。每段已保存消息、叙述、操作与压缩记录通过共享 TimestampHover 显示真实记录时间；时间浮层按 2026-09-25 用户修订使用纯白背景、深色文字、8px 圆角，支持 Escape、移开收起和边缘避让。Core 在既有 CHECKPOINT_CREATED 通道补充真实压缩开始事件；常规连续执行与模型请求重试均有开始/结束，旧 GENERAL_CONTEXT_REDUCED 可独立回放。未结束的压缩在暂停/终止状态不继续闪动，也不宣称完成；快速压缩不人为延时，字节变化不推算 token。澄清问题、审批和暂停动作直接显示，不得藏进历史。两种模式都保留完整最终答案和执行记录，不声称减少模型 token；不改变 Pane ownership、执行或验证语义。样式归 `styles/controls.css`，复用文字/颜色 tokens。

2026-09-15 设置增加模型计费统计，保持 Settings / WorkspaceSurface 的 Pane、导航、滚动与材质 ownership。`styles/model-usage.css` 仅在 features 层管理该页布局；标题、文字、共享 SelectMenu/按钮继续使用既有 type/control tokens。Icon Registry 新增 `usage → ChartBar`。统计图是数据可视化 SVG（不是产品 glyph），使用 emphasis / muted semantic colors 表达输入和输出，并提供数值、图例和键盘可读标签。零数据不生成演示用量。任务列表分页，窄窗表格在自身容器滚动；Light/Dark 共用结构。


2026-09-08 Large-directory drag correction: the 300-file trace did not cover the real Project's
2,759 rendered directory rows (including folders). The subsequent scrollbar review supersedes the width
hold completely during direct dragging: code, directory rows, filter and native scrollports stay responsive
on every pointer frame. Scrollbars remain on the pane edge and code wrapping/thumb size update before
release. Never hold the width of a scrollport or an ancestor that positions it.

Large directories use a flattened presentation of the same filtered/collapsed tree model. Above 200 files
or rows, only the viewport plus six rows of overscan on each side are mounted. Native scrolling uses spacer
heights computed from the full row count and a font-aware measured row height; no synthetic scrollbar is
introduced. Scroll/height changes update the window, while width-only ResizeObserver notifications never
trigger a tree state update. Small trees keep their nested presentation. Depth, ancestor guides, selection,
filter-path compression and directory state remain consistent; Home/End/Up/Down/Page keys navigate beyond
the mounted window and Left/Right collapse/expand folders. Performance regression covers 2,500 files plus
400 long source lines, actual bidirectional input, pre-release native viewport edges, stable scroll extent,
the final directory entry, filtering and keyboard navigation.

The inner divider may shrink its live directory viewport below the saved 160px minimum. Within 36px
of the right edge it sets the same collapsed state as the toolbar; reversing to 80px restores it within
the same captured gesture. Collapse retains the expanded width preference; a toolbar reopen restores it.
After release the file viewer consumes the resulting full width. Pointer previews never become durable
Project state, and these changes preserve the current pane ownership.

2026-09-08 Motion performance follow-up: the three live grid inputs
`--workspace-navigation-width`, `--project-workspace-width` and `--dock-file-tree-width` are registered
lengths with `inherits:false`. They belong to their grid, never to file rows, syntax tokens or hidden tabs.
This is a performance invariant: a 300-file, multi-tab Chromium trace reproduced widespread style
recalculation with inherited inputs. Navigation drag also caches geometry and viewport clamping waits
until the drag ends. The navigation viewport clips stable-width children on collapse without an
independent opacity, padding or translation transition.
Temporary slide/code/navigation content dimensions follow the same rule: write to the actual consumer,
or explicitly inherit only onto the immediate pane child, never through the entire file subtree.
Directory trees retain their sessions and use memoization with stable open/refresh callbacks so that
unrelated panel state changes do not rebuild every hidden file tab's tree.

Bottom Terminal and every affected pane above it use the same panel timing for height/margin-bottom.
The terminal body keeps its full content height during the reveal; it does not run a separate fade/translate
animation. Its left edge directly follows the measured navigation edge without a second transition.
Terminal resizing previews only local height/margins on animation frames, committing state and storage
once on release; focus uses preventScroll. Regression must verify intermediate shared edges, not merely
final bounds. The default Open button uses the existing native FILE_EXPLORER icon; that entry and the
Fielora Files/Terminal shortcuts are excluded from its alternate-app menu.

2026-09-08 File workspace correction supersedes the earlier motion details: the existing outer Dock and inner
resource grid retain their ownership and topology. During a state transition the tab strip, toolbar, viewer and
tree body retain a measured content width and are revealed by the moving pane edge; opacity/translate preludes
and `display:none` on the collapsing tree are removed. The owning grid animation controls cleanup, including
interruption and reduced motion. Inner directory drags cache geometry, update only the CSS width per animation
frame, and commit React state/localStorage on release. Pointer cancellation, capture loss and window blur end
the drag and restore interactive content. Code keeps wrapping throughout direct dragging and its native
scrollport follows the live pane edge; the whole-code width hold is superseded. Click-driven inner reveal
retains its existing measured-content transition. Syntax and source line numbers remain visible throughout.

Source editing uses CodeMirror 6 inside the existing file surface. One editor owns text, soft wrapping,
selection, undo, native scrolling and source line numbers. Its viewport layout replaces the previous full
textarea plus full highlighted DOM overlay, whose duplicate layout became costly on 400 long lines.
Language parsing covers the existing JS/TS/JSX/TSX, JSON, HTML, CSS and Markdown paths; unsupported extensions
remain editable plain text. Lezer highlight tags map to the existing semantic syntax classes and code
palette, not a second theme. Code font family/size and line height are shared by text and the gutter.
The React adapter preserves controlled content updates, existing review/save callbacks and line-range reveal;
unmount destroys the view and its observers. No completion UI, IDE panels, file access or new runtime is added.
The code palette pairs purple keywords with blue properties and teal strings in both light
and dark appearance. File and image tabs consume the same local FileTypeIcon mapping as directory rows;
rename changes the tab label only, never its file-type identity. Tool tabs keep their semantic action glyph.

The File toolbar has a 1px workspace-divider bottom edge. Directory toggle precedes the external Open control;
the resource separator uses the same neutral 1px line and a larger invisible pointer target. The filter is a
28px search field immediately below that edge with a clear action (Escape also clears), bounded path filtering,
and compressed single-child folder chains in filtered results. Normal directories use 18px depth indentation,
light ancestor guides that strengthen on hover, compact rows and file-type artwork. Real Electron tests must
type into the visible file tab, wheel-scroll to the bottom, verify input/highlight agreement, exercise both
separators and record intermediate reveal widths; DOM existence and animation duration alone are insufficient.

Renderer 只从 `styles/index.css` 加载样式。Cascade 顺序是稳定 API：

```text
reset
→ tokens
→ legacy
→ foundation
→ features
→ layout
→ typography
→ components
→ materials
→ utilities
→ overrides
```

- `tokens.css`：唯一 design value source；允许 Light/Dark 的 token 值。`--fl-brand-chrome-*` 是连续、可替换的品牌 Chrome bundle，只允许由 `data-brand-chrome` owner 消费；Appearance 用户 Override 只能覆盖下述批准的 semantic token seam。
- `styles.css`：只读式 legacy compatibility layer；不得增加新跨页面视觉规则，其 raw-color budget 只能下降。
- `foundation.css`：reset、focus、scrollbar、系统 motion。
- `appearance.css`：现有 feature presentation，不能拥有 shared control 或 material recipe。
- `layout.css`：锁定 Pane ownership、Workbench 比例、连续工作面与 viewport/composer 关系；Feature/Material 层不得声明 Composer 宽度、Pane grid 或持久化宽度边界。
- `typography.css`：字体栈和有限 type roles。
- `controls.css`：Button、Menu、Select、Tabs、Dialog、IconButton/ToolbarAction 与受控 Tooltip。
- `materials.css`：五种 semantic surface 的唯一 paint resolver 和 Solid fallback。

禁止通过 selector specificity、加载顺序偶然性或 `!important` 穿透上层 ownership。仅 reduced-motion 系统兜底允许 `!important`。

## 3. Typography Roles

Sans：`Segoe UI Variable → Segoe UI → Microsoft YaHei UI → sans-serif`。

Mono：`Cascadia Code → Consolas → monospace`。

只使用五个产品角色：

| Role | Size / Weight / Line height | 用途 |
|---|---|---|
| Title | 17 / 600 / 1.3 | 独立 Result 与 Dialog 标题 |
| Section | 13 / 500 / 1.4 | 小节和导航分组 |
| Body | 15 / 400 / 1.7 | Conversation、Markdown、说明正文 |
| Label | 14 / 500 / 1.35 | Button、Menu、Select、Tabs |
| Meta | 13 / 400 / 1.45 | 路径、时间、Evidence、Toolbar metadata |

2026-09-07 用户字体校准：Conversation 顶部标题复用 Body 字号和 Medium 字重（默认 `15px / 500`），
不继承独立 Title 的 `17px / 600`；标题栏使用与右侧功能行一致的 `40px` 高度，标题、更多操作和功能按钮
垂直居中对齐。Conversation 内 Markdown 的 h1–h6 和正文强调仅以 `600` 字重区分，小标题保持 Body 字号，
inline strong/b 继承当前字号，不因加粗放大。原有标题语义、层级间距及独立代码字号保持。

代码、Diff、Terminal 只使用 Mono。UI 基础字号允许在 `12–18px` 中选择并按 15px 基线等比派生上述五个角色；代码字号在 `11–17px` 独立设置，不跟随 UI scale。新组件不得添加独立 `font-family`，不得新增未进入 role contract 的字号或 700/800 重字重。

### 3.1 Appearance User Override Contract

Settings → 外观在唯一 `fielora` Theme identity 之上提供六项持久、实时生效的用户 Override，不注册新 Theme、不注入 CSS selector，也不改变五层 Surface ownership：

| 设置 | Preference / Token seam | 当前 Light 默认 | 约束 |
|---|---|---:|---|
| 侧边栏背景 | `sidebarBackgroundOverride` / `sidebarBackgroundGradientOverride` → `--fl-brand-chrome-canvas` | Theme Chrome 渐变 | 默认、单色、渐变三种来源；Titlebar、Navigation 与圆角 underlay 必须消费同一个 viewport-aligned canvas，文字、图标和 selected semantics 不随背景改色 |
| 工作区背景 | `workspaceBackgroundOverride` / `workspaceBackgroundGradientOverride` → `--fl-surface-content` | `#FFFFFF` | 默认、单色、渐变三种来源；Conversation、Library/Settings Content、Right Dock/Utility 共享 Paint，neutral token 只从两个 stop 的 solid mix 派生，Floating/Overlay 继续由 Material resolver 管理 |
| 界面字体/字号 | `uiFont` / `uiFontSize` → `--fl-font-sans` / `--fl-ui-font-scale` | System / `15px` | 普通 UI 与正文按现有 role scale 相对派生 |
| 代码字体/字号 | `codeFont` / `codeFontSize` → `--fl-font-mono` / `--fl-code-font-size` | System Mono / `13px` | Code、Diff、Editor、Terminal 独立于 UI 字体 |
| 对比度 | `surfaceContrast` → neutral Surface derivation | `42` | 只派生 subtle/hover/selected/border/input 与 Brand Chrome 菜单 hover/selected/edge/input/selection-shadow；禁止全局 `filter: contrast()`，不修改正文与 Success/Warning/Danger |
| 按钮颜色 | `actionColorOverride` → `--fl-action-primary` | `#6847D8` | 自动派生 hover/pressed/focus/disabled/foreground；不覆盖 Danger/Success/Warning |

背景控件统一提供默认/单色/渐变、真实预览与 `#RRGGBB` 输入；Action Color 提供默认/自定义。颜色选择只使用 Fielora 自己的 bounded Overlay：160px saturation/value 平面、Hue track、当前 HEX，按触发器位置在窗口内上下翻转并与四边至少保留 12px，不调用 Windows native color picker，也不得产生 viewport 横向溢出。Sidebar 默认控件明确显示“主题渐变”和真实 Chrome 预览，不再以 `#F7EFFB` 单色冒充实际画布；旧版等于 `#EFEBFF/#F0ECFF/#F7EFFB` 的 persisted flat override 必须迁回 `null`。Dark 对应默认值由同一 registry resolver 提供。`applyAppPreferences` 只写批准的 CSS custom properties，更新后同帧预览并继续复用现有 Glass/Solid material recipe。恢复操作只清除这六项 Override，保留 System/Light/Dark、Reduced Motion、高对比度、项目和模型设置。

Appearance 的六项自定义使用单一两列 settings matrix：左列为 label/description，右列为统一宽度的 source/value 或 family/size control；所有右列起止边界必须对齐，桌面行高保持 compact，section copy 必须位于 section label 下方。全部 Settings category 统一使用 `920px` Content rail，Header、row copy、shortcut label 的左边线不得因历史 860/960px 宽度、20px row inset 或长页面滚动条出现而跳动；Settings Content 必须预留 stable scrollbar gutter。

Library、Scheduled 与 Project Conversation 的 Page Header 统一使用 `1040px` page rail；Library/Scheduled 共用 30px title、38px Primary Action 和无虚线卡片的 quiet empty state，Conversation 只保留其专用 reading/composer width，但 Header 左边线必须与上述 page rail 对齐。四者继续复用 `WorkspaceSurface`、navigation-width preference、4px resizer 和 Content 左上圆角，禁止回退到 legacy `.shell` fixed column。

Contrast 控件使用无外围输入框的 3px neutral/action track、20px strong thumb 与右侧等宽数值；focus 只在 thumb 周围显示 token 化 focus ring。侧栏菜单的 hover、selected material 及 selection shadow 必须从同一个 `surfaceContrast` 派生，0 时 selection shadow 为 `none`，高值逐步增强；项目容器本身继续保持无选中阴影，避免 Conversation 选中状态污染父 Project。

## 4. Icon System

外观自定义渐变（2026-09-19）：侧栏/标题栏和工作区的渐变模式采用左下（0%,100%）、左上（0%,0%）、右上（100%,0%）三个径向颜色中心，固定柔和扩散范围。三个颜色分别编辑并显示位置标签，窄窗口仍保持可访问的 HEX 与颜色选择器。侧栏和标题栏沿用同一窗口背景坐标，不分别拉伸。

兼容影响：仅为既有 UI preference v2 渐变对象添加可选 bottomLeft，from/to 继续表示左上/右上；旧值或无效新增值回退到原 from，不丢失用户已选颜色。无 Core schema/Migration、安全或权限变化。工作区中性控件从三色混合基色派生，不把多层背景图像送入 color-mix。默认主题/单色/重置语义保留。

- 产品图标只通过 `ui/Icon.tsx` 的 `<AppIcon>` 使用 `@phosphor-icons/react`。
- 尺寸只使用 14 / 16 / 18px；默认 regular weight，状态由 `currentColor` 与父控件 semantic token 表达。
- Phosphor 组件独占 glyph 的 `fill` / `stroke` / `stroke-width` / `weight`；CSS 只管理 optical box、`currentColor`、布局和交互状态。禁止把 `<AppIcon>`、Composer、Select 或文件图标重新套入旧手绘 SVG 的 `fill:none + stroke` 规则，否则填充式 glyph 会被抹除并错误呈现为禁用态。
- 可操作图标默认必须达到 secondary icon contrast；只有真实 `disabled` 控件允许通过控件级 opacity 降权，不能在 glyph 本身设置低透明度模拟 disabled。
- 文件类型通过 `ui/FileTypeIcon.tsx` 使用本地 Material Icon Theme SVG 子集；这是 2026-09-08 用户明确要求的 file glyph 例外。源图与 MIT 许可位于 `apps/desktop/assets/file-icons/`，许可同时嵌入分发 SVG；不发起远程图标请求，不改变 Phosphor 产品控件 registry。不得将来源不明的专有产品图标拷贝到仓库。
- Agent 生成的 `工作对象` Tab 与空状态使用 Icon Registry 中独立的 `objects → Shapes` 语义，不再占用零标签工具启动页；不得借用表示“新建文件”的 `filePlus`。
- `审阅` 与 Conversation 完成结果中的变更入口统一使用 `diff → PlusMinus`，并由 canonical optical box 添加圆角方框，使“＋ / −”同时可辨；不使用只有“＋”的 `PlusSquare` 或分支状 `GitDiff`。右侧 PowerShell 工具使用 `terminal → Terminal`，底部 Terminal 控件与标题使用 `terminalPanel → TerminalWindow`，同一行出现时必须可区分。
- 右侧工作区普通态使用 `focus → ArrowsOutSimple`，扩展后切换为 `unfocus → ArrowsInSimple`；文件目录开关使用 `fileTree → Folders`，位于“打开”左边。
- 禁止组件内手绘 SVG、Unicode glyph、emoji 图标、局部 icon registry 或 CSS 伪元素画图标。
- 例外只有真实外部应用的本机 icon、站点 favicon 和用户内容媒体；它们不是 Fielora 产品 glyph。
- Fielora 品牌标记是另一项明确例外：`apps/desktop/assets/fielora-brand-mark.svg` 是 Renderer 的 canonical 品牌源；当前 mark 固定三条 `#5840C8` 花瓣 path 且中心保持透明负空间。`render-brand-svg.cjs` 只生成 Windows icon pipeline 消费的同形 PNG，再由既有 `icon:generate` 生成 ICO；不得在组件中复制第二份品牌图或恢复中心圆。
- Webpack 必须固定 React/ReactDOM singleton。Phosphor 等 hook-based shared UI dependency 不得解析第二份 React，否则 packaged Renderer 会发生 Invalid Hook Call 并空白启动。

## 5. Shared Interaction Primitives

图片缩略图不使用卡片边框、灰色底板或内边距，按原图比例展示；不可用状态仍显示原因，键盘焦点仍可辨。放大预览仅保留图片与独立的小型控制条，不绘制包围图片的白色面板；点击图片外的空白处可关闭。暂停任务仍占用当前 Conversation 的任务槽，新消息沿用追加队列，不得当作终态启动第二个任务；排队说明明确等待继续或停止，正式创建消息前须向 Core 核对占用状态。

图片缩略图在 Composer 和 Conversation 中只展示媒体，不常驻重复文件名；文件名保留在可访问名称、悬停提示及图片预览标题中。Composer 的移除按钮置于缩略图右上角，失败原因仍可见。图片 Lightbox 与遮罩共同限定在标题栏下方的 Work Area，复用标题栏高度 token 并避开原生 Window Controls Overlay；缩放、关闭与边缘留白在小窗口中仍完整可用，禁止仅提高网页 z-index 来遮盖原生按钮。

`UiPrimitives.tsx` 是共享交互入口：

- `Button`
- `IconButton`
- `ToolbarAction`
- `Tooltip` / `TooltipButton`（由 `IconButton` / `ToolbarAction` / Sidebar 项统一托管并通过 Portal 绘制）
- `Menu` / `MenuItem`
- `SelectMenu`
- `TabStrip` / `Tab`
- `TextActionDialog`

Button/Menu/Select/Tabs 共用 geometry、type roles、hover、active、focus-visible、disabled、keyboard 和 reduced-motion。Feature 可以添加布局 class，但不得复制一套控件状态。原生 `alert` / `confirm` / `prompt` / 产品级原生 `select` 不进入 Renderer。

共享 Button 的内容采用 inline-flex 居中和 space-2 间距，图标与文字不得依靠行内基线或直接相邻文本排版。资料库“添加文件”使用标准 16px FilePlus 图标与独立文案，保持当前色继承和完整点击区域（2026-09-19）。

模型单价行的两个 label 清除历史全局底部 margin；输入框、币种选择器与保存/清除按钮统一使用 control-lg 高度，按控件底部对齐。窄窗口保持可换行，不通过相对位移补偿错误盒模型（2026-09-19）。

2026-09-08 工作区菜单与标签校准：Conversation Header 的摘要入口改称“工作区信息”。分支/上游属于静态状态；“任务改动”读取当前 Review，“工作区改动”读取 Git status，二者不能混用计数。“查看改动统计”只在终端展示未暂存 diff 统计，不再标作比较分支。提交/推送分别使用 GitCommit/CloudArrowUp，以“准备提交 / 准备推送”明确生成 Composer 草稿，保留原草稿且不自动发送、不修改当前权限；没有上游时推送不可用。删除未实现 PR 状态和重复添加来源入口，来源文件复用 FileTypeIcon，当前文件直接回到对应文件 Tab。打开/刷新读取真实状态，失败与非 Git 状态不伪装成零改动；异步返回不能串入其他 Project。

Right Dock 选中标签使用中性 selected 底色与 subtle shadow；Keyboard focus 绘制在完整 Tab 上并向内收口，避免主按钮 outline 被标签裁切成一根竖线。共享 TabStrip 使用 roving tabindex、左右方向键及 Home/End；激活后保持标签焦点并 reveal。Right Dock 的普通滚轮映射为横向滚动，保留横向触控板与 Ctrl 缩放手势；滚动不改变活动文件。左右渐隐只在对应方向确有溢出时出现，mask 仅作用于 bounded Tab lane，“＋”及窗口控制不参与渐隐。滚动/ResizeObserver/标签变更按 frame 更新边缘状态，不因无关 Conversation render 自动滚回活动标签。点击共享图标控件时收起 Tooltip，避免盖住刚打开的菜单。

权限 Select 的常驻触发器保持无边框、透明底的轻量控件；常规高度 `30px`，窄 Composer 仅保留 `30px` 图标槽。三种权限统一使用 Phosphor 语义图标：请求批准为 `HandPalm`、帮我批准为 `ChatCircleDots`、完全访问为 `WarningOctagon`；图标槽必须透明，不增加独立底板。选项文案固定为“请求批准 / 编辑外部文件和使用互联网时始终询问”“帮我批准 / 仅对检测到的风险操作请求批准”“完全访问权限 / 可不受限制地访问互联网和你电脑上的任何文件”；Composer 中第三项只显示紧凑标签“完全访问”。`FULL_CONTROL` 只以 warning icon/text/check signal 表达风险，选中行保持透明底，不改变 Composer 底板或制造大面积状态色。菜单宽度上限 `440px`，确保三条说明在标准桌面窗口中完整单行显示，单项最小高度 `50px`；菜单中的同一选项复用相同 warning token，并从触发器上方以 motion token 定义的轻量位移/透明度过渡进入。

共享 `IconButton` / `ToolbarAction` 禁止使用浏览器原生 `title` 提示。Hover 或键盘 Focus 统一显示 Portal 承载的深色轻量 Tooltip：白色 Caption 文本、约 `7px` 圆角、`8px` 锚点间距，并在窗口边缘自动 clamp；顶栏 Tooltip 必须避开原生窗口按钮所在的 Chrome 区域。Tooltip 必须位于 App Shell overflow 之外，不得被 Conversation 或 Workspace Pane 裁切。Escape、Pointer leave 与 Blur 必须关闭，`prefers-reduced-motion` 下仅保留即时可见性变化。Sidebar 的 Project / Conversation 项使用同一受控 Tooltip 的轻量 Card variant，补充标题、Project、时间或本地路径；不得依赖浏览器原生 `title`，阴影统一使用 Floating token。

Project 下的 Conversation 只通过缩进表达层级，不绘制持续的树形竖线；项目标题再次点击仍负责展开/收起，且 hover preview 不改变选择或折叠行为。`项目` 分组标题固定在滚动容器之外，只有其下方 Project/Conversation list 纵向滚动；滚动区上下保留 `8px`、右侧保留额外 inset，Scrollbar 不得贴住分组标题或 Content 接缝。Project expanded 只表达层级展开，不消费 active background/shadow；选择某条 Conversation 时只允许该 Conversation row 显示 selection。

Conversation Composer 在空对话、历史对话和运行中使用同一底部锚点；空状态不得把 Composer 重定位到内容中央。发送/追加按钮固定为 `36px` 圆形，使用 `17px` 粗体 ArrowUp；可用态使用 Fielora emphasis purple 与白色 glyph，禁用态只降低语义对比而不改变轮廓，hover/press 动效必须复用 control motion token。

Composer 底部的添加、权限、语音和发送控件在宽栏与窄栏中始终按垂直中线对齐；权限 Select 外层与触发器保持同为 `30px` 高，避免外层遗留高度使图标偏上。不得用图标位移补偿容器高度错误，窄栏也不得退回底边对齐。

## 6. Material Contract

Fielora Glass 是唯一官方语言。组件只声明：

```text
Canvas / Content / Chrome / Floating / Overlay
```

`materials.css` 统一决定 background、edge、shadow、blur 和 fallback。Content 近实色；Chrome、Floating、Overlay 才允许受控 translucent material。System/Light/Dark 是 appearance，不是不同布局或组件体系。Solid 仅为同 DOM 的能力 fallback。

Brand Chrome 是 `Chrome` 内的显式产品子主题，不是第六种 Surface，也不是应用全局 Theme。只有持久的 Desktop title/tab bar 与 Project/Settings 左导航可以声明 `data-brand-chrome`；它们共享同一 viewport-sized 低饱和薰衣草粉画布和坐标系，原生 Windows caption 颜色与顶部渐变右端一致。品牌 foreground/hover/active/input/edge 也必须来自同一 token bundle。菜单/Popover 仍是 `Overlay`，右侧 Dock/Tabs/Utility 与全部 Conversation/Workspace/Settings 正文仍是中性的 `Content`/既有控件语义。

所有工作区正文区域使用同一个 `Content` 基础背景。材质变化不得增加 Pane 间实色割裂、重复标题栏、大面积状态色、装饰性 gradient card 或重阴影。

Conversation Header 不常驻 Project 打开方式控件；Project 外部打开器只属于 File/Resource toolbar。Right Workspace Dock 中的工作对象与 Browser viewer 均使用标准白色 `Content` plane。嵌入 Right Workspace Dock 的 Browser Page 必须直接使用 Dock 顶部的共享 Tab Strip，不得在内容区重复绘制第二层 Page Strip；active Tab 只以中性 material shift 与文字状态表达，禁止在标签底部绘制蓝色或紫色 indicator。共享 Tab Strip 必须在 window-right controls 前结束并保留 `126px` clearance；标签超过可视宽度时只在该 bounded lane 内横向滚动，激活标签自动滚回可视区，且 Dock 宽度动画导致 lane 再次变化时必须由 ResizeObserver 重做 reveal，不能覆盖 Focus/Terminal/Panel 控件。其内部固定为 `Address Toolbar → Viewport` 两行，自上而下占满动态 Dock。独立 Browse Route 可以保留自己的 Page Strip。共享 Page Tab / Address Toolbar 分别为约 `32px / 44px`，地址框为 `34px`，导航与更多操作为 `30px`；空状态使用中性的 Browser glyph、`开始浏览` 与一行说明，不形成 Landing Page 式大标题。

## 7. Change Protocol（强制）

任何修改下列路径的 changeset，必须同步更新本文的对应 contract、mapping、例外或验证方式：

```text
apps/desktop/src/renderer/styles.css
apps/desktop/src/renderer/styles/**
apps/desktop/src/renderer/ui/**
apps/desktop/src/renderer/UiPrimitives.tsx
apps/desktop/src/renderer/WorkspaceSurface.tsx
apps/desktop/src/renderer/ResizableDivider.tsx
apps/desktop/webpack.renderer.ts
```

顺序固定：

1. 说明现有 Layout ownership 是否保持；
2. 更新 token/type/icon/primitive contract；
3. 在正确 Cascade Layer 实现；
4. 删除被替代的 legacy override，不增加新的全局方言；
5. 更新本文；
6. 只运行受影响的静态、TypeScript、Desktop/packaged smoke 和必要视觉验收。

`scripts/check-ui-ux-doc-sync.mjs` 会拒绝“改样式但未改本文”的 changeset。产品视觉原则变化时还必须同步更新 `docs/product/FIELORA_DESIGN_LANGUAGE_V0.1.md`；重大布局/ownership 决策同步更新 Project Reality 与 Decisions。

## 8. Visual Golden Metrics

`FIELORA VISUAL GOLDEN CALIBRATION` 以 `1600 × 816`、100% UI scale 的当前 Codex Desktop 截图为人工参考。数值只约束视觉参数，不改变 App Shell、Pane topology、Dock/Overlay 语义或行为。

| Metric | Codex reference（截图估算） | Fielora canonical |
|---|---:|---:|
| Sidebar width | ≈304px | 304px |
| Top chrome height | ≈44px | 44px |
| Navigation row | ≈38px | 38px |
| Conversation row | ≈36px | 36px |
| Icon glyph / optical slot | 16px / ≈24px | 16px / 24px |
| Icon / text gap | ≈12–14px | 12px |
| UI / Meta / Title / Body | 14 / 13 / 17 / 15px | 14 / 13 / 17 / 15px |
| Composer width / compact height | ≈920px / ≈100px | 1040px / ≈100px（用户收窄留白校准） |
| Composer bottom offset | ≈12px | 12px |
| Permission trigger / menu width | 30px compact / ≈440px | 30px compact / 440px max |
| Send button / glyph | 36px / 17px | 36px / 17px |
| Browser Page Tab / Address Toolbar | ≈32px / ≈44px | 共享 Dock Tab 32px / 44px |
| Browser address / action control | ≈34px / ≈30px | 34px / 30px |
| Toolbar control | ≈30–34px | 30–34px |
| Selected row radius | ≈8px | 8px |
| Main readable width | ≈920px | 1040px（用户收窄留白校准） |
| Right Workspace Dock default | ≈635px | 635px（不是 max） |
| Divider | ≈1px / 6–8% neutral | 1px neutral visual / 4px content-painted hit track |

Light appearance 的 Content 文字/图标对比基线为：Primary `#181a1f`、Secondary `#343a43`、Muted `#717a87`、普通图标 `#505761`。工作内容中的亮紫色只用于菜单选中标记与 Composer 发送/停止主操作；Workspace 顶部 active Tab 使用 neutral material shift，不使用底部 accent line。显式 Brand Chrome 是独立例外，只覆盖 Desktop 顶栏与左导航，并使用其自有高对比 foreground/selection tokens。普通 Content 导航、展开状态、进度、文件、工具栏与焦点反馈均使用 Neutral，成功/警告/危险继续使用各自语义色。Project expanded 不是 selected；同一导航链只保留 Current Conversation 的 selection。Composer 仍由 `Floating` material resolver 绘制，但使用低一级 surface shadow，减少独立 Card 感。

Conversation 顶部遵循单行 Header：项目文件夹图标 → 当前 Conversation 标题 → 更多操作。Project 名称、绝对路径或重复上下文不得作为第二行常驻标题。右上角 Workspace Dock 开关统一使用 Phosphor 右侧面板图标；不得以 Columns、手绘 SVG 或文本符号代替。

校准顺序固定为 Typography → Icon/contrast → Sidebar/selection → Composer/controls → Spacing/density。每次只比较相同窗口尺寸；若效果需要改变 DOM 或 ownership，必须报告 BLOCKED 而不是实现。

## 9. 当前验证基线

- Packaged Renderer 能挂载真实界面，React singleton contract 有静态回归测试。
- Design-system static tests 覆盖 cascade、type roles、Phosphor icon entry、glyph paint ownership、shared primitives、material ownership 和 legacy raw-color budget。
- Brand Chrome static contract 验证唯一 PNG 品牌源、顶部/左导航显式作用域、同一 viewport canvas 与 `-44px` 续接坐标、只在既有 Content 圆角切口可见的 shell underlay、受控 Logo opacity、Light/Dark token bundle、native caption 连续性，以及 Conversation/Right Workspace Dock/Utility 的零品牌 token 消费；Conversation 右上几何必须保持不变。真实 Electron 视觉验收仍判断渐变、Logo 与五层 Surface 的最终质量。
- Workspace packaged E2E 以 `data-file-kind` 与实际 decoded size 验证本地 Material Icon Theme 文件图标，不再依赖已删除的手绘 SVG tile path；File/Image viewer 必须进一步证明代码输入值与上层 syntax paint 同时包含真实内容、图片完成解码且 `naturalWidth/naturalHeight` 与渲染尺寸均大于 0，禁止仅以 DOM 节点存在判定 PASS。
- Workspace E2E 验证 Navigation/Dock 使用 `304px / 635px` 默认比例；Scheduled/Settings 使用标准 Work Surface 圆角，Conversation 使用 `16px` compact 左上圆角并共享 Navigation 宽度，初始窗口为 `1180 × 560px`。Dock 可持续向左扩展到动态可用上限，在 `1280 / 1440 / 1920` 窗口下实时 clamp，并在窗口重新放大后恢复用户偏好宽度；零标签不显示“＋”，关闭最后标签会采样到多个中间宽度。Dock launcher 只含审阅、PowerShell、浏览器、文件四个当前入口且没有侧边聊天或工作对象常驻项。File / Browser / Terminal 视图占满 Dock 且不添加内部固定宽度上限。
- Workspace presentation tests 验证 Conversation Header 不再渲染 Project launcher、工作对象不再成为常驻工具但 Agent 生成的 Artifact 仍使用直接 Tab 与白色 Content surface、嵌入式 Browser Page 直接复用 Dock Tab Strip，且 Address Toolbar / Viewport 流体占满剩余空间。
- Terminal 定向测试验证命令输入在 IPC 建立 run id 前仍接收首个真实事件，右侧与底部终端继续复用真实 Workspace Runtime；右侧工具使用 Phosphor `Terminal`，底部终端使用 `TerminalWindow`，语义相同但 presentation 可辨识。
- Managed Tooltip 与 Workspace Content Viewer E2E 分别验证顶栏提示避开原生 Chrome，以及 Sidebar 无树形竖线、Project/Conversation hover card 使用真实标题、时间与路径。
- Visual Golden E2E 固定在 `1600 × 816`，记录并断言 Typography、Icon、Sidebar、Selection、Composer、Toolbar、Dock、Divider 与无横向溢出；只生成 Sidebar + Conversation、Conversation + Composer、Workspace open、Settings 四张证据。
- 只对本轮触达的 packaged UI 路径运行最小 E2E；不以无关 Agent/Provider/Rust 全量 Gate 代替 UI 验证。
- Visual Human Gate 仍决定最终材质质量；自动测试只证明结构、契约和可运行性。

## 10. UI/UX 结构硬锁

`STRUCTURAL_CHANGE_REQUIRES_USER_APPROVAL`

当前 Desktop App Shell、Primary Navigation、Conversation、Composer、Right Workspace Dock、Bottom Terminal、Settings shared frame 以及各 Route 的主要页面结构已经锁定。后续字体、图标、色彩、材质、阴影、动效、密度和整体视觉优化只能在现有 ownership 与 DOM topology 内校准，不得借“统一样式”或“重构”进行大幅结构调整。

以下任一变化都属于结构变化：改变 App Shell / Route composition；增删主要 Pane；改变 Navigation / Conversation / Workspace / Dock / Overlay 的归属关系；改变主要 grid/flex topology；迁移 Resizer ownership；改变 Composer 底部锚点、Conversation Header ownership、Settings shared frame 或 Bottom Terminal/Dock 语义。

遇到上述需求，Agent 必须在实现前暂停，说明变更原因、范围、受影响页面和兼容风险，并获得用户明确批准后才能继续。批准后的结构变化必须在同一 changeset 同步更新本文、`docs/product/FIELORA_DESIGN_LANGUAGE_V0.1.md`、Project Reality、Decisions 与相应回归测试；未获批准时只能提交保持现有结构的校准方案。

2026-09-09 Agent continuation: existing conversation progress summary exposes a
short pause reason and Continue/Stop actions even when process details are
collapsed. Exhausted allowances label the explicit extra-step grant; cumulative
limits do not offer an ineffective resume action. Keep existing conversation
rail, type scale and expandable execution history; no permanent activity pane.

2026-09-09 New Project conversation repair: a Project with no conversations now
uses the existing Conversation Header, empty message area and canonical Composer
with attachments, permission, model, voice and Send. Remove the obsolete
project-empty-composer form/styles; no new Pane, grid owner or anchor. First Send
creates/reuses the unsent conversation and sends the captured text/attachments
once; creation failure keeps the draft. Merely opening a Project still creates
no Conversation. Model and permission selection survive first-send activation.

2026-09-10 User-authorized Agent presentation repair: keep the current narrative
and latest operation group in a short fading preview; older progress remains in
the existing expandable execution history. Approval/pause controls remain outside
that fold. A single neutral status indicator replaces duplicate context/thinking
file icons. Use semantic Phosphor group icons, file-type icons in the result list,
an actual downward arrow for return-to-latest, and separated result actions with
no decorative separator inside buttons. Absent optional MCP configuration is not
an error; meaningful connection diagnostics remain accessible. Same Pane owners,
reading rail, type scale and theme tokens; reduced motion is respected.

Earlier attempts for the same user turn are collapsed before the latest result;
expansion retains original failure text and file review. Streaming event updates
must not restart the elapsed-time interval.

2026-09-10 Stable progress refinement: streaming and durable narratives occupy
one shared slot above operations, reserving two text lines for normal updates.
Consecutive search/directory/read batches merge across short narrative notes;
approval, phase and mutation boundaries retain their identity. Expanded batches
preserve every note and operation in sequence. Search, directory, file reading,
editing, command and verification use distinct canonical glyphs; a mixed project
inspection batch uses a folder glyph. Terminal decorative checkmarks use the
neutral shared Check glyph; persisted/copyable Markdown and code remain intact.
No new Pane or permanent progress surface; keep reading rail and typography.


### Agent browser verification — 2026-09-10

Agent 浏览器检查复用右侧 Browser Tab，不创建常驻活动面板。打开目标页时自动展开，既有文件/终端标签保留。过程摘要使用浏览器/验证语义图标；展开可读到具体验收项。工具调用已返回但断言未通过时，UI 显示未通过状态，不能仅因 ToolCall Completed 使用成功状态。浏览器边界在 Dock 打开位移动画期间连续同步，避免原生页面被裁成零宽；切换为非活动工具时隐藏原生网页。默认页内操作不展示元素引用或内部协议字段。

### Composer drafts and recoverable image tasks — 2026-09-10

Unsent prompt and image attachments are isolated by Project/Conversation and survive conversation switching or workspace remount within the current renderer session. A project new-conversation draft transfers to the created conversation on first send; only that sent draft clears. Late attachment completion updates its originating draft. This is editing state, not a second durable task store; app-exit draft recovery is not promised.

Resume restores original images from persisted message attachments for legacy runs. Pause wording distinguishes cumulative usage from active context size and distinguishes unsupported images, malformed message history and unknown request rejection. Do not claim that compaction ran when it did not change the request. Keep these explanations in the existing pause area without adding a permanent token dashboard.


### Goal lifecycle feedback — 2026-09-11

Existing expanded execution history displays the latest receipt-derived task stage: locating the problem, verifying changes, repairing failed checks or preparing the verified result. Keep one live summary and existing foldout; do not add a permanent plan dashboard. Missing historical images pause with a readable explanation. A legacy run ending below its displayed global step limit is described as an old strategy ending early, never as all displayed steps being consumed. Text-only references to prior pictures restore that Conversation's original gallery without duplicating thumbnails in the new user message.
### Referenced image recovery — 2026-09-11

Retry and Continue resolve images against the originating message, including legacy galleries earlier in the same conversation. A missing-reference notice explains that Continue attempts to restore the original images; it does not immediately require stopping and re-uploading when stored originals may still be available. Filling a pre-execution missing input keeps the same task. Subsequent unrelated galleries must not change its reference.


### Scoped work and verification feedback — 2026-09-11

work_plan appears as “明确修改范围与验收条件” in the existing activity foldout. Do not create a permanent plan panel or show evidence ids in ordinary task prose. A saved edit without fresh passing checks is labeled “修改已保存，等待验证”; it must not claim verification is running merely because a write completed. Source facts, tentative interpretations and acceptance remain distinct in the underlying work record.


### 2026-09-11 计划恢复纠正

工作计划显示具体下一步，不与“检查了相关信息”重复拼接。已记录的计划与未确认引用分别表达，计划成功不能显示结果验证成功；历史范围/引用错误说明为旧版行为。恢复过程仍使用既有当前活动与折叠历史，不新增常驻面板。


### 2026-09-11 浏览器加载与验证阻塞

开发服务进程已启动不等于页面就绪。操作详情解释未检查/未监听状态；导航失败说明目标页面未加载，不能显示为取得页面证据。对旧版无导航、无内容的假成功回执，同样在未验证暂停处提示排查地址和启动状态，不推断用户未登录。不增加永久诊断面板。


### Agent 续作时间与进程关联提示（2026-09-11）

执行摘要将耗时标为“累计”，避免重启后短暂续作被误读为重新运行二十多分钟。服务工具未关联进程时提示已有服务可能仍在运行，并引导检查实际地址；不使用“未启动”断言。继续工作保持原任务，新的资源窗口不代表任务通过验收，不增加常驻状态面板。


### 登录阻塞的操作交接（2026-09-12）

Agent 经浏览器快照确认需要用户登录时，现有暂停提示明确说明“在右侧浏览器完成登录，登录后继续页面验证”，保留原页面、已修改文件和未完成状态。不得仅显示泛化的预算/未验证提示而让用户猜下一步；不得要求用户在聊天中发送密码。继续恢复同一任务，任务完成仍由原需求对应的检查决定。


浏览器输入恢复补充（2026-09-12）：元素被遮挡/引用失效等未发出输入的失败保留明确回执，Agent 重新观察后处理。已发出输入后观察失败只补观察。历史不确定浏览器输入在用户继续后保持暂停和待核对提示，不把“继续”当成允许重复提交或直接宣告整项失败。普通 UI 不展示内部输入阶段枚举。

### 暂停、运行与等待回答（2026-09-18）

任务占有当前对话不等于正在执行。暂停时取消实时预览、流式光标、旋转状态和输入区停止主按钮；历史保留在执行详情中。暂停原因、34px 继续/停止按钮、静态暂停图标紧凑排列，按钮间距使用共享 spacing token，支持换行和键盘焦点。等待补充信息时显示实际问题，输入框显示“回答并继续”；回答恢复同一任务，不进入后续任务队列。只有 RUNNING/QUEUED 使用执行中的输入区控件，暂停不显示正在生成样式。

### 对话锚点悬停动效（2026-09-18）

按用户参考图，左侧原有轮次导航在 gutter 内采用左对齐刻度：静止 6px、当前阅读位置 10px，悬停/键盘聚焦时目标 32px，四个邻近刻度依次为 24/18/12/8px。固定命中区域不随伸缩改变，共享 200ms motion token 的 transform/opacity 过渡避免正文重排。右侧复用 Portal Card Tooltip，显示该轮用户原文与已存在的助手回复节选，不发起模型摘要。移动离开、Blur/Escape 恢复，减少动态效果偏好下立即切换；点击依旧滚动到对应用户消息。保留原 Pane、滚动、长对话导航和 Composer 避让语义。

锚点预览的 Card variant 由 controls.css 在共享组件层定义，使用 400px 上限、实色 overlay token 和截断节选；不能放在低优先级 layout 层后被通用 Card 样式覆盖。动效过渡完成后检查背景与文本对比度。

窄 Pane 内导航宽度受既有 gutter 限制，刻度按比例收窄，不能侵入正文或为动效移动阅读区域。


### 未发送新对话的导航与草稿（2026-09-19）

左侧项目只列出已有用户消息的对话；无已发送对话时隐藏整个对话列表区域，不留“新对话”占位条目。顶部“新聊天”和项目新建入口继续可用，重新打开该项目未发送页面，当前未发送页面优先复用。列表过滤不能删除或移出页面数据集合，不清空文字、图片或其他附件。首次用户消息持久化后即显示条目，与模型是否成功回答无关；不能凭默认标题判断已发送状态。沿用既有按项目/对话隔离的应用会话草稿，未扩展为跨应用重启的草稿持久化。

首次创建时，在发布新页面选择前转移项目临时草稿，包含创建/读取期间输入的内容；不存在的来源不能清空已恢复的目标草稿。真实桌面回归覆盖反复新建、对话/项目切换、设置页往返、文字与两张图片恢复及首发后显示。


### 设置控件表面与交互一致性（2026-09-19）

设置内容区的输入框、下拉选择、颜色字段、普通操作按钮统一采用实色中性表面：浅色为白色，深色使用对应 overlay-solid token；边框保持轻量。路径等只读信息沿用淡底色，与可操作按钮区分。普通按钮、下拉和模式选项悬停/按下统一使用轻微中性色变化，模式选中保留边框、阴影与状态点，开关和颜色色块保留本身语义。主按钮各状态保持强调色与主题指定的对比文字色（默认浅色主题为白字，深色或自定义浅色按钮沿用对比度适配），不能被 settings-card-heading 的通用文字色覆盖。组件层集中管理这些状态，保留禁用与键盘焦点。


### 对话代码底色与右侧共享背景（2026-09-19）

代码块、代码块标题栏与行内代码使用同一 code-background token；浅色默认 #E2E4E6，深色采用对应中性底色。外观对比度以默认 42 为基准：降低向工作区中性色靠拢，提高则增加与正文的区分，恢复默认时移除覆盖值。此 token 不改变其他控件背景。右侧审阅、文件、图片预览、终端、浏览器空页与产物工具容器透明，透出与对话相同的 Content 背景；渐变使用一致的窗口坐标，不能在嵌套面板反复绘制。审阅增删标记、实际网页/图片/文档内容及选择状态保留自身语义。


### 锚点静止态与动画开销纠正（2026-09-19）

静止时所有刻度均为 6px（含当前阅读位置），当前刻度只将透明度从 .28 提高到 .4，不再变长或实黑。悬停/键盘聚焦仍为 32/24/18/12/8px 邻近波形；指针反馈通过单一 data-wave-active 属性及相邻选择器更新，不再通过 React 状态重渲染整组 TooltipButton。只过渡 transform 与 opacity，使用合成提示，去除逐帧背景颜色绘制。保留固定命中区、预览、点击跳转、键盘导航、Escape 收起与减少动态效果偏好。


设置按钮补充（2026-09-19）：按用户确认，模型与服务页的“添加模型服务”属于普通设置操作，使用共享 secondary Button，与“编辑”采用同一白底细边框和中性悬停/按下效果，不使用强调色填充。深色模式沿用对应中性表面。


渐变设置布局补充（2026-09-19）：背景来源下拉收窄为 84px，与三个颜色中心的输入/选择器在同一行底部对齐；位置标签保留在各自输入上方。移除重复的圆形色样，保留 HEX 输入与可点击方形色块。三个颜色值继续独立编辑，普通单色/默认控件布局不变。

### 设置页标题精简（2026-09-25）

设置页直接从主标题开始，删除标题上方的个人、模型、本地优先、效率、Fielora 等分类小字；存储页加载状态同样处理。保留标题下的功能说明，标题沿用现有样式与间距。


### 审阅差异工作面（2026-09-25）

审阅以连续代码差异为主：顶部为当前任务增删总数和可展开文件列表；文件栏显示类型图标、完整路径提示、单文件增删数和前后切换。默认一次显示一个文件，代码区域独立滚动；以旧/新行号、增删符号、红绿行背景和边线区分改动，不再使用修改前/修改后卡片。持久化快照提供差异前后三行上下文，计数只含实际增删；历史片段没有坐标时不编造行号，原内容缺失时保留原始 Diff。底部沿用共享 Button / IconButton；保留已审阅、当前文件后续变化的提示及安全撤销条件，失败反馈留在当前审阅页。时间悬浮框在浅色和深色下均为纯白背景、深色文字，保留圆角、阴影和真实记录时间。

### 精简执行记录按工作类型归类（2026-09-25）

精简模式合并相邻同类动作：文件与信息检查、文件修改、命令与测试、版本管理、搜索下载与扩展、结果验证。单项保留灰色操作行，多项以类别、数量和实际失败数摘要呈现，点击逐项展开命令/参数/回执；中间过程叙述收进过程说明，完整详细模式仍保留全部原始顺序。成功的 record_request_intent/finish_task/work_plan 控制记录只在详细视图显示；失败、未知和待审批不得因此隐藏或改为通过。同类合并不得跨审批、暂停、恢复或上下文压缩边界。该归类只投影已保存事实，不调用额外模型，不声称降低模型 token；运行类别同样使用既有呼吸及减少动态效果规则。

### 2026-09-25 模型配置与任务预算

设置侧栏将“模型与服务”“模型计费统计”合为“模型配置”，页内采用共享中性 Tab 样式切换“模型服务 / 用量统计 / 任务预算”。保留既有服务编辑、连接测试、用量趋势、定价和任务记录；旧 USAGE 导航指向用量 Tab。Tab 支持左右方向键、Home/End、焦点与选中态，无原生 select 样式。

任务预算沿既有设备本地 preferences 仅配置累计执行时长。共享 SelectMenu 提供 5/15/30 分钟、1/2/4/8/12/24 小时和自定义；自定义为 1–1440 整数分钟，输入后点击“应用”保存，非法值不能提交。默认 1 小时、可恢复默认。新建/主动继续读取当前时长，当前运行不改预算。Token 仅计量，不因累计用量暂停；单次请求超时、审批、无进展保护独立。沿现有 Pane/滚动/Light-Dark/窄窗响应式，不新建设置 Runtime。此 2026-09-26 修订取代前版三维额度 UI。


### 2026-09-25 工具安装确认

沿既有 Agent 审批区展示具体工具名/版本、来源、实际下载大小、项目隔离目标、SHA-256、影响和需确认原因；确认与拒绝只绑定当前调用。预览来自 Core 解析的真实准备回执，不信任模型生成的风险/大小字段。安装仍与兼容性验证分开显示。

### 精简模式二次收敛（2026-09-25）

按用户最新要求替代前述“逐项默认可见”：常规叙述、已完成操作和已完成压缩默认进入单行“执行记录”，保留操作数及真实未完成数量。展开后按既有工作类别查看，并在组内按真实 sequence 交错排列操作和说明；完整命令、回执、文件入口和悬浮时间仍可访问。当前活动工具从历史批次中单独提取，运行中的压缩单行可见，流式过程说明限制为灰色单行预览、点击展开原文。审批、暂停/恢复、恢复提醒和未确认压缩结果保留为可见边界，最终答案不截断。详细模式继续使用原始投影，不改变运行、上下文和 token 行为。

摘要与说明统一紧凑行距、就近折叠箭头，展开区域用轻量边线提示层级；不增加内部滚动面板。上下文整理使用 ArrowsInLineVertical 图标，browser screenshot 使用 Images 叠图图标并明确“页面截图”，不把截图获取声称为视觉验证。原有纯白圆角时间浮层、Reduced Motion、暂停后停止呼吸保持。

### 文件变更是交付结果，不折叠成过程按钮（2026-09-25）

用户图示修正：精简模式仅折叠执行过程。两种模式的终态文件变更都使用可见卡片：标题“已编辑 N 个文件”、绿色新增/红色删除总计、默认前三个文件的单行项目相对路径与逐文件增删行数；多余文件通过“再显示 N 个文件”展开/收起。卡片不使用 details 包住整个结果，审阅入口直接可见，文件行打开对应 diff。长路径单行截断并保留完整路径 title；窄屏自适应，复用明暗主题 tokens。

具有 durable revision 且 undoAvailability=AVAILABLE 的文件提供“撤销…”入口，打开相应审阅文件，由既有撤销控制检查当前文件状态再执行；这不是新增批量撤销，也不会点击摘要就覆写文件。没有安全撤销能力的旧记录不伪造操作按钮。该规则替代此前“底部变更数折叠为摘要”的规定。

### 稳定的过程分类与语义图标（2026-09-25，用户再次修订）

撤回“所有过程统一收到执行记录”的上一方案。精简视图按连续操作类别直接显示折叠行，不在外部再套总折叠；每类从单项开始就使用同一个 details 节点，运行/完成仅更新状态，不拆分活动项再移入历史。普通说明集中到“过程说明”，不在主区显示短暂流式说明，原始内容及时间仍可展开查询。审批、暂停、恢复与压缩记录保留原边界，详细模式保持原始序列。

耗时在当前轮顶部，运行状态同处固定高度栏；“正在思考”仅文字，无图标、无无内容的展开按钮，精简模式不再追加底部状态行。压缩、工具、说明均在稳定位置更新，不增加淡入淡出/滑移替换效果。可选呼吸只影响透明度，尊重 Reduced Motion。新增操作可增长列表，不把正常增长说成完全静止。

图标分工：文件读取=叠页；目录=文件夹；命令=终端；编辑过程=铅笔；文件交付=文件轮廓内加减号；截图=叠图；上下文=向内收拢。不要复用清单图标代表执行历史与文件变更；思考无前置图标。“撤销”去掉省略号，仍进入现有安全审阅。Agent 区所有自定义 disclosure 统一按用户指定的收起向左/展开向右，不沿用其他页面的上下旋转规则；原生参数折叠也使用统一自定义箭头。


### 2026-09-26 文件交付卡按用户参考图修订

卡片采用1px中性边框、14px圆角、浅灰82px卡头、50px圆角图标底；文件加减图标为圆角文档轮廓（无折角）。标题下为可点击“查看更改 ↗”，移除该位置总增删计数；计数仍在每条文件右侧和原始投影数据中。右侧“撤销”配回转箭头，复用既有审阅确认；“审阅”采用用户图4的圆角方框加减/斜线图标与文字、无外围胶囊框。前三文件45px行高、路径弱化而文件名正常、红绿增删数字右对齐，底部“再显示N个文件”使用本卡专属下/上箭头（最新图示覆盖此前本卡左右箭头约定）；其他执行记录箭头不变。明暗主题颜色由token管理，窄屏适配。


2026-09-26 用户箭头批注纠正图4用途：加减斜线图标放卡头最左灰色图标底内，替换原文档加减图标；右侧为无图标的“审核”文字按钮，白色/主题表面、1px细边框、12px圆角。此次修订覆盖上一段审阅按钮无外围框的误解，点击仍调用既有审阅入口。


### 2026-09-26 精简过程层级再次修订

覆盖前述状态与耗时同栏、独立过程说明组的方案：顶部仅耗时，执行记录末尾保留固定高度的当前动作文字行；有活动工具显示具体动作，否则显示正在思考，无图标或空展开。单个操作使用具体动作及对象，不显示抽象类别和1项计数；连续同类多项才使用分类摘要。普通过程说明附于相关操作的折叠详情，取消独立过程说明组。审批、暂停、恢复、压缩仍可见。分组从单项到多项、执行到完成保持同一details身份和展开状态，新增步骤自然增长；不以临时叙述替换布局。详细模式保留完整原始顺序。


### 2026-09-26 按最新六张过程参考图覆盖分类方案

最新参考以时间流为主体：普通过程说明直接显示正文，与实际操作按sequence穿插，不再隐藏到类别详情。仅连续同类操作合并，说明、压缩、审批与暂停是分界；使用运行了命令/查看了文件等自然动作摘要，不堆类别计数。单条命令显示已运行及截断命令，展开显示Shell面板，原始参数与回执二级折叠。持久记录没有输出正文时明确标注未保存，不编造无输出。按钮可复制命令。顶端已处理及耗时、底部状态稳定保留；流式过程文字不短暂闪现后替换成摘要。

精简过程箭头按最新图示改为收起向右、展开向下；关闭时仅悬浮或键盘focus-visible出现，打开时保留，触屏常显。opacity隐藏仍占位，避免悬浮跳动。Shell用浅中性灰背景及细边框、圆角、等宽代码、独立滚动；命令采用圆角终端图标，压缩使用两侧括号/折线与中间文本线图标。文件交付卡沿用上一修订，详细模式完整信息保持。


### 2026-09-26 思考与执行提示必须依据实际事件

正在思考仅用于已记录MODEL_STARTED、尚未MODEL_COMPLETED/FAILED且没有活动工具或审批的模型调用区间；工具完成后的空隙、失败、恢复与启动不能兜底成思考。工具调用入口补记既有ModelStarted事件，无新schema；老记录缺少开始事件时保守显示正在处理。最新活动工具的可见摘要使用轻微透明度呼吸，展开多项组时只动画活动子行；正在压缩的记录同样呼吸。终态/暂停/失败立即停止，减少动态效果关闭动画。底部思考提示仅模型活动时呼吸，不与工具执行提示同时闪烁。

执行已有可见操作行时，底部状态行保留高度但不重复命令或压缩文字；仅模型活动显示思考，明确的非模型阶段切换使用中性正在处理。


### 2026-09-26 精简模式按信息价值收敛

用户再次要求精简。默认命令摘要只显示动作，多项合并计数；命令全文、参数及回执保留在展开内容。相邻操作允许跨常规准备说明与已完成压缩合并，这些说明/维护记录附于操作详情，保留sequence顺序；发现、错误、权限、审批、暂停和交付结果不隐藏。重复说明仅折叠，不删除事件。长说明及代码围栏先显示短摘要、完整内容展开；详细模式不变。工具行使用execution字号和10px段间距，正文保留主要层级。沿用稳定details身份、悬浮/键盘箭头、Reduced Motion和活动工具动画。上述取代此前所有过程说明均直接正文及每次压缩常驻的规则。

2026-09-29 真实复发补充：仅描述已有文件、随后宣布读取/检查的“我注意到/我看到/我已读取”准备说明也进入操作详情；真实新错误、原因、授权和用户问题优先保留。此规则不是语义去重引擎，不删除原始说明，不以折叠冒充模型上下文优化。
