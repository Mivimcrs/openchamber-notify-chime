# 提醒音（notify-chime）

OpenChamber 的提示音扩展：会话结束、失败、要你回答、要你授权时出声，**窗口开着也响**。

用 `contributes.sessionEvents` + 本地服务实现，声音由服务侧直接播放，不依赖系统通知、不依赖面板是否打开。

- 仓库根目录**就是扩展包**（`package.json` + `panel/` + `service/` + `assets/`）
- 源码与构建在 `构建/`：`node build.mjs` 生成 `panel/main.js` 与 `service/main.js`
- 发布自检：`node 工具/check.mjs`

## 安装

**从仓库安装（推荐，能跟着线上更新）：**

设置 → 扩展 → 添加扩展 → **URL**，填：

```
https://github.com/Mivimcrs/openchamber-notify-chime
```

安装后会要求授权，**必须批准「本地服务」**（以及它声明要运行的 `powershell`），否则不会出声。左侧栏出现「提醒音」面板，在里面调音效、音量、开关。

**离网/本地改代码时**，也可以按文件夹安装：直接指向这个仓库根目录（`package.json` 所在的那层）。

## 更新

从 URL 安装的扩展是 git 源，OpenChamber 会读仓库根目录 `package.json` 的 `version`、和已装版本做 semver 比较；发现更新时在扩展页提示，点更新会重新 clone 并替换安装副本（授权、数据、设置按扩展 id 保留，不用重新批准）。

- 检查频率：每扩展每小时最多一次，可手动刷新。
- 安装副本在 OpenChamber 自己的目录（`guest-copies/notify-chime`），**不是**本仓库；直接改本仓库的文件不会进到已安装的那份，要走「提交 → 打 tag → 在应用里更新」。
- 回滚就是装回旧 tag：`https://github.com/Mivimcrs/openchamber-notify-chime#v1.0.0`（`#` 后跟 ref）。

发版流程：

```bash
git add -A && git commit -m "release: v1.0.1"
git tag v1.0.1 && git push origin main --tags
```

打 tag 会触发 `.github/workflows/release.yml`：重建产物、比对产物与源码、跑自检、打 zip 发 Release。

## 事件与默认音

| 事件 | 面板上的名字 | 默认音效 |
|---|---|---|
| `turn-finished` | 完成 | 叮咚（上扬双音） |
| `turn-failed` | 失败 | 低沉（两声） |
| `question-asked` | 需要回答 | 询问（两声） |
| `permission-asked` | 需要授权 | 提醒（三声急促） |

- 子代理（`session.parentId` 非空）的事件会被忽略，只响你真正要处理的那条。
- 防抖：全局 1500 ms、同一会话同一事件 3000 ms，避免连续事件一起炸响。
- 四个槽位各自可以单独关掉，也有总开关。

## 自定义音效（只有本地文件）

每个槽位三件事：开关、音源下拉、试听 / 选择… / 重置。

- **选择…**：由本地服务弹出 Windows 原生文件选择框（面板是沙箱 iframe，拿不到真实路径，也传不了音频文件，所以选择框在服务侧弹）。
- **粘贴路径导入**：面板底部填绝对路径（可以是网络共享路径），点导入。
- 选定后文件会被**复制**到扩展自己的数据目录 `sounds/`，源文件之后移动或删除都不影响；想换音再选一次。
- 支持 `wav / mp3 / m4a / wma`，单个 ≤ 20 MB，会按文件头校验是不是真的音频，不合格直接提示、不写入设置。
- 失效处理：副本被删或损坏时，该行标红，下拉显示「文件已失效」，此时**不响**（不会偷偷换成别的音）。点重置恢复内置音。

## 数据与日志

- 数据目录：`%USERPROFILE%\.config\openchamber\guest-data\notify-chime`（注意是 `guest-data`，不是 `guest-services`；后者只放服务进程的 pid/token 记录）
  - `settings.json`：开关、音量、四个槽位的音源引用（`builtin:<id>` 或 `file:<文件名>`）
  - `sounds/`：导入的自定义音效副本
  - `service.log`：事件与播放记录，超过 512 KB 自动清空
- 内置音效在仓库 `assets/*.wav`，由 `构建/src/generate-sounds.mjs` 合成，无第三方音频素材。

## 播放引擎

1. 主力：PowerShell + WPF `MediaPlayer`（wav/mp3/m4a/wma，带真实音量），脚本用 `-EncodedCommand`（UTF-16LE base64）传递，中文路径不会乱码。
2. 兜底：WAV 播放失败时回退 `System.Media.SoundPlayer`。
3. 每次事件起一个独立 PowerShell 进程（约 0.3–0.5 s 延迟）；服务本身空闲 10 分钟会被系统停掉，下个事件自动拉起（实测冷启动约 65 ms）。
4. 子进程**不要加 `detached`**：detached 的 PowerShell 会启动即退（退出码 0）却一行脚本都不执行，声音不会响，而 `spawn` 不报错。`工具/check.mjs` 会卡住这个写法。
5. `service.log` 每播一次会记两行：`spawn <音源> pid=` 和 `spawn done <音源> code= ms=`。第二行的 `ms` 约等于「PowerShell 启动 0.3 s + 音频时长」，明显偏小（约 100 ms）就说明脚本没跑。

## 不出声时按顺序查

1. 面板里总开关和对应槽位的开关是否打开。
2. 设置 → 扩展：这个扩展是否已批准「本地服务」、是否被禁用。
3. 该槽位是否标红（音效文件没了）。
4. 面板「最近响过」里有没有记录：有记录但听不到 → 系统侧（音量合成器里 OpenChamber/PowerShell 的音量、输出设备）；没记录 → 事件没送到或被防抖挡了。
5. 看 `service.log`：先找 `spawn <音源> pid=`（没有 → 请求没到或文件被判失效），再找 `spawn done ... code= ms=`（`code` 非 0 或 `ms` 只有一百多毫秒 → PowerShell 没执行脚本）。

## 仓库结构

```
package.json          扩展清单（openchamber.contributes，发布版本号改这里）
icon.svg
panel/                设置面板：index.html（静态）+ main.js（构建产物）
service/main.js       本地服务（构建产物）
assets/*.wav          六个内置音效
构建/                 源码：src/panel.js、src/service.js、src/generate-sounds.mjs、build.mjs
工具/check.mjs        发布自检
踩坑日志.md           踩过的坑与验证手段
```

构建：

```bash
cd 构建 && npm ci && node build.mjs      # 产物写回仓库根的 panel/ 与 service/
node 工具/check.mjs
```

## 已知边界

- 只做提示音，不改 OpenChamber 本体，不接管系统通知。
- 只支持本机播放（Windows 用 PowerShell；macOS/Linux 走 `afplay` / `paplay`，未实测）。
- 面板「最近响过」只保留本次服务进程内的 12 条，服务停掉后清空。

## 许可

MIT，见 `LICENSE`。
