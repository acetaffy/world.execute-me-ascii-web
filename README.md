# world.execute(me); —ascii（网页版）

Mili《world.execute(me);》的字符动画，浏览器版本：终端风格的 ASCII 画面与原曲同步播放，含歌词字幕、频谱与章节演出。

本仓库 `main` 分支为终端（Python）版；当前 `web` 分支是其浏览器移植。

## 运行

仓库不保存音频文件（`*.mp3` / `*.flac` 已被忽略）。把音频放到 `media/song.flac`，或打开页面后把任意音频文件直接拖入窗口。首次打开会看到「Looking for media/song.flac …」提示层，放入音频后刷新即可。

推荐用任意静态服务器打开页面（直接双击 `index.html` 也可尝试，部分浏览器会限制本地文件）：

```sh
python3 -m http.server 8000
# 访问 http://localhost:8000
```

按空格 / 回车开始。建议全屏（F），有效画面最低 64 列 × 24 行，160 列左右效果最佳。也支持与终端版 `--start` / `--autoplay` 对应的查询参数：

```
http://localhost:8000/?start=158.7&autoplay=1
```

## 操作

| 按键 | 功能 |
| --- | --- |
| 空格 / 回车 | 开始 / 暂停 |
| ← / → | 后退 / 前进 5 秒 |
| R | 从头播放 |
| 1–5 | 跳转章节 |
| `[` / `]` | 字幕提前 / 延后 0.1 秒 |
| `,` / `.` | 上一句 / 下一句歌词 |
| `+` / `-` | 音量 |
| F | 全屏 |
| I | 帧率与状态浮层 |
| Q | 回到开始画面 |
| H | 帮助（Esc 关闭） |

手机上点按画面开始 / 暂停；桌面端可直接把音频文件拖放进来播放。

## 与终端版的一致性

网页版按「同一时间点、同一字符网格」逐项移植 `player.py` / `scenes.py`：

- 画面先绘制在字符网格上（`MV.Canvas` 镜像终端版的 `Canvas`：宽字符占两格、样式索引、行裁剪），再由 `MV.Renderer` 以等宽字体映射到 `<canvas>` 等像素网格；阴影块 `█▓▒░`、半块 `▌▐` 以矩形绘制，与终端同样处理，避免字体缝隙。
- `js/util.js`（`MV.py`）逐位复刻 CPython 数值语义（`int()`、`//`、`%`、半偶舍入的 `round()`、f-string 数字格式化、东亚字符宽度），保证两版逐格一致。
- 时间轴契约与 macOS 版 `AudioClock.swift` 相同：音频设备拥有时间轴，渲染跟随音频时间；网页端由 `HTMLAudioElement` 承担。
- 24 fps；标题转场、glitch 强度曲线、章节阶梯均按原时间轴复现。

## 目录结构

```
index.html         页面入口，按顺序加载数据与脚本
css/mv.css         页面样式（提示层、toast、状态浮层）
js/util.js         CPython 数值语义与东亚宽度工具（MV.py）
js/font.js         5×5 点阵字模（同终端版）
js/canvas.js       字符网格（MV.Canvas）
js/scenes.js       场景与动画层（MV.scenes）
js/film.js         整帧合成：页眉、时钟、章节、频谱条、字幕（MV.Film）
js/render.js       字符网格 → 2D canvas 渲染（MV.Renderer）
js/player-core.js  播放状态机（MV.PlayerCore，无 DOM 依赖）
js/player.js       浏览器接线：音频时钟、主循环、键盘 / 拖放 / 全屏
data/config.js     生成数据：时长与字幕偏移（MV.CONFIG）
data/lyrics.js     生成数据：英文歌词时间轴（MV.LYRICS）
data/spectrum.js   生成数据：30fps × 48 频段频谱（MV.SPECTRUM）
media/             音频放置目录（文件不入库）
```

## 数据文件

`data/*.js` 均为生成产物（文件头注明 *Do not edit by hand*），源自主分支中的 `config.json`、`lyrics.json`、`spectrum.json`；涉及数值一致性，请勿手改。

## 来源与致谢

- 原曲与歌词：Mili《world.execute(me);》。
- 终端原版：yym8224961/world.execute-me-ascii（由 GPT-6 Astra 协助制作）。
- 网页移植：acetaffy/world.execute-me-ascii-web（本仓库，由 DeepSeek-V4.1-Flash 协助完成）。

## 收录范围

本分支为项目归档的网页版实现：播放器、字幕与频谱数据入库；音频文件不入库，由使用者本地提供。本项目是个人创作与备份，未对原曲、歌词或其他第三方素材授予额外使用许可。
