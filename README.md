# 合成大肥鱼

> 《按下发送之后》像素同人小游戏 —— 掉落合成，纯网页，打开就能玩。

**▶ 在线试玩**（手机、电脑都行，竖屏体验最好）：

- **GitHub Pages**：<https://oowjzzoo.github.io/hecheng-dafeiyu/>（浏览器打开就玩，存档在本地）
- **B站 Toy**：<https://www.bilibili.com/toy/hecheng_dafeiyu/index.html>（B站 App 或网页里玩，多了排行榜和云存档，见下文「B站 Toy 版」）

粉丝向的免费同人小游戏。角色来自 **@Oo肥鱼O** 的 8-bit 像素动画《按下发送之后》：从上方丢东西，两个同级的碰在一起合成下一级，一路合到大肥鱼；堆过红线就结束。

## 玩法

- 拖动 / 点击放下当前的东西，松手落下；两个**一样**的碰在一起，合成更大的一级，共 11 级：小笼包 → 饭团 → 面窝 → 白米饭 → 泡面 → 小螃蟹 → 小鲸 → 大小姐 → 豆包 → 钢盆小鲸 → 大肥鱼。
- **镀金**：有的东西会镀上金色，但金色会褪，要赶在褪色前合成；合到人物以后就镀牢了。
- **金豆**：分数攒到门槛、或合出大肥鱼，会得到金豆。普通模式里金豆能「灌水」——水涨上来，小的东西浮到盖子底下自己合成；美梦模式里金豆用来「摇一摇」。
- **美梦模式**：连着两局没合出大肥鱼会解锁的「爽玩」模式（夜空绶带进入）：容器大 4 倍、不怕红线、长按连丢，但**不计最高分、不解锁成就和图鉴**。
- 图鉴（11 级普通 + 11 级镀金）、27 个成就（含 1 个隐藏）；最高分、成就、图鉴都存在浏览器本地（`localStorage`），不上传任何东西。

首次打开有教程；开始页、暂停页右下角的 `i` 是署名，`?` 是玩法回看。右上角的齿轮是设置（局内也有）：背景音乐 / 音效音量和静音、粒子特效档位、屏幕震动开关、恢复默认，以及删除全部存档（要连点 8 次确认）。

## 本地运行

没有构建步骤，也没有依赖，起一个静态服务器就能玩（直接双击 `index.html` 不行，图片和脚本加载不了）：

```bash
python -m http.server 8731 --bind 127.0.0.1
```

然后打开 <http://127.0.0.1:8731/>。

调试网址参数（加在网址后面）：`?debug`（图鉴和成就全点亮，只在内存里）、`?gold`（更快见到镀金）、`?dream`（美梦入口常开）、`?tutorial`（每局都弹教程）、`?fps`（左下角帧率小窗）、`?showcase`（调试快捷键）。

## 目录

```
index.html, game.js      游戏本体（所有页面在 index.html，逻辑在 game.js）
pixui.js                 像素字 / 像素 UI 渲染
bgm.js                   背景音乐：WebAudio 现场合成的 8-bit，无音频素材（开始页、美梦各一首循环；普通局内两首间歇乐章轮流，中间留空白）
toy.js                   B站 Toy 版的适配层（云存档、排行榜、跳转），只打进 Toy 包
vendor/matter.min.js     物理引擎 Matter.js
text.json  →  text.js    全部文案的源头 → 构建生成的 window.TEXT
sprites/                 生成物：精灵、背景、成就头像、字模图等（运行时用的就是这里）
art/                     GPT 出的原图（绿幕表等），sprites 由它们生成
tools/                   构建与出图脚本（build.py、make_*.py、perf_web.cjs 性能测量、smoke_web.cjs 冒烟测试）
docs/                    署名与授权、像素字经验、成就设计、开发笔记
```

## 改文案

文案全在 [`text.json`](text.json)（普通 JSON，键是中文），改完在仓库根目录跑：

```bash
python tools/build.py
```

它会检查文案有没有缺项 → 生成 `text.js` → 把新字补进像素字模图 → 更新缓存版本号。需要 Python 3.10+ 和 `numpy pillow`。署名页是例外：由 [`docs/署名与授权.md`](docs/署名与授权.md) 生成后写回 `text.json`，改措辞改那个文件，**署名是授权要求，改之前请先和作者确认**。

界面是离线字模拼出来的像素字，不用系统字体；做像素风中文界面的经验见 [`docs/像素字经验.md`](docs/像素字经验.md)。

## 技术说明

- 物理：Matter.js 0.20，逻辑固定 60 步/秒，渲染按时间插值，所以 90 / 120 / 144Hz 的屏也不会一顿一顿。
- 画面：360×704 逻辑分辨率的竖屏，关插值，按先顶到的一边撑满。
- 音效：WebAudio 现场合成的 8-bit 方波，没有音频素材。
- 性能和帧节奏的取舍、量出来的数据见 [`docs/开发笔记.md`](docs/开发笔记.md)。

### 意见便签（已关闭）

游戏里带一个「意见便签」（写了发 `POST feedback` 给同源的接口），需要自己的后端收。GitHub Pages 是纯静态托管、没有后端，所以开源版把它**关掉了**：`game.js` 里 `NOTE_ON = false`，入口不显示，也不会生成任何匿名 ID。页面、输入框和发送逻辑还在，想自己部署并接上接口的话，把 `NOTE_ON` 改成 `true` 并实现 `POST feedback`（JSON：`text`、`cid`、`page`、`mode`、`score`、`best`……）即可。

## 部署

本仓库推到 `main` 会由 GitHub Actions（[`.github/workflows/pages.yml`](.github/workflows/pages.yml)）自动发布到 GitHub Pages，只打包运行需要的文件（`index.html game.js pixui.js text.js bgm.js vendor sprites`）。fork 后在仓库 Settings → Pages 里把 Source 选成 GitHub Actions 即可。

### B站 Toy 版

同一份代码另打一个包发到 [B站 Toy](https://www.bilibili.com/toy/intro)，B站 视频下面可以就地开玩。源文件不分叉，区别全在打包脚本里：

```bash
python tools/build.py            # 先照常构建（文案、字模、版本号）
python tools/build_toy.py        # → dist/toy/（注入 B站 Toy SDK 和 toy.js）
python tools/build_toy.py --fake # → dist/toy-fake/（假 SDK，本地测试用）
```

- **只在 Toy 版有**：排行榜（普通模式、美梦模式各一个榜，入口在开始/结束/暂停页左下角）、云存档（最高分、成就、图鉴、美梦进度等同步到 B站 账号，`toy.js`）。网页版没有 `toy.js`，这些都不出现。
- **按平台规则去掉的**：意见便签的输入框和发送代码（`toy-strip` 标记之间，打包时整段删）、署名页的站外链接（只留文字；B站 空间链接改走 `toy.navigate`）。
- **本地测试**：起静态服务器打开 `dist/toy-fake/index.html`；网址参数 `?guest`（没登录）、`?limit`（限流）、`?slow`（云存档读得慢）、`?fail`（榜单读取失败），见 `tools/toy_fake_sdk.js`。
- **上传前预检**：用官方的 [`toy_doctor.py`](https://github.com/bilibili/toy/tree/main/skills/toy/scripts) 过一遍 `dist/toy/`（入口 index.html 不能超过 1MB、不能有绝对路径等）。
- **封面**：`NODE_PATH=$(npm root -g) node tools/make_toy_cover.cjs` 出 4:3 的 `dist/toy-meta/cover.png`（照开始页样式重排，`tools/toy_cover.html`）。

## 署名与授权

- 角色来自 **@Oo肥鱼O** 的像素动画《按下发送之后》。小鲸是鲸鱼娘二创：原型「溟月」由[上善无形](https://space.bilibili.com/4456176)原创，女仆鲸鱼娘由[ZipZipPipe](https://space.bilibili.com/4168597)二次设计。
- 小鲸、大肥鱼、豆包、大小姐、小螃蟹是粉丝同人角色，与深度求索、字节跳动、Anthropic 均无关。
- 本作品采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 许可共享：署名、非商业性使用、相同方式共享。
- 物理引擎 Matter.js（MIT）；字体思源黑体 Noto Sans SC（SIL OFL 1.1），仅用于离线生成字模。

## 许可

见 [LICENSE](LICENSE)：

- **美术与角色素材**（`art/`、`sprites/` 下的图片）：[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)——署名、非商业性使用、相同方式共享；角色形象的原作权利归原作者。
- **其余全部**（代码、脚本、文案、文档）：MIT。

欢迎 fork、二创；用到美术素材请保留署名、不要商用。
