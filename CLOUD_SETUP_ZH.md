# SMARTFUZE AQUA 云端安装教程（v2.0.2）

写给完全不懂电脑的人。照着一步一步做，大约 **30 到 60 分钟**，只需要做一次。

完成后的样子：

```
pH 探头 + 水温探头 → ESP32 → 店里 4G 路由器 → 互联网 → 云服务器（AQUA）→ 你的手机
```

店里**不需要放电脑**。店里停电或 4G 断线，云端会在 5 分钟内发现并报警（设置 Pushover 后手机会响）。

---

## 准备：需要注册 3 个免费 / 便宜的账号

| 账号 | 用途 | 费用 |
|---|---|---|
| GitHub | 存放 AQUA 程序，让服务器下载 | 免费 |
| DuckDNS | 给你一个固定网址，例如 `myshrimp.duckdns.org` | 免费 |
| DigitalOcean | 云服务器，24 小时运行 AQUA | 最便宜的 1GB 方案约每月 6 美元（以页面显示为准），需要信用卡或 PayPal |

> 建议用电脑操作这一部分（屏幕大比较容易看清楚）。

---

## 第 1 步：把程序放到 GitHub（约 10 分钟）

1. 打开 **github.com**，点 **Sign up** 注册，记住你的**用户名**（例如 `ahming88`）。
2. 登录后，点右上角 **+** → **New repository**。
3. **Repository name** 填：`smartfuze-aqua`
4. 选择 **Public**（程序里没有任何密码，公开是安全的；密码是安装时才设置的）。
5. 点 **Create repository**。
6. 在新页面找到 **uploading an existing file** 这几个蓝色字，点它。
7. 在你的电脑上解压 **`SMARTFUZE-AQUA-v2.0.2-github-upload.zip`**。
8. 打开解压后的文件夹，**全选里面所有的文件和文件夹**（例如 `server.js`、`public`、`cloud`……），拖进 GitHub 网页的上传区域。
   - ⚠️ 要拖**里面的东西**，不是拖外层那个文件夹本身。
9. 等上传完成，点页面下方绿色按钮 **Commit changes**。
10. 检查：仓库首页应该直接看到 `server.js`、`cloud`、`public` 等。

你的仓库名称就是：`你的用户名/smartfuze-aqua`（例如 `ahming88/smartfuze-aqua`）。

---

## 第 2 步：申请 DuckDNS 网址（约 3 分钟）

1. 打开 **duckdns.org**，点上方 **Google** 用 Google 账号登录。
2. 在 **sub domain** 框里输入一个名字，例如 `myshrimp`，点 **add domain**。
   - 名字只能用小写英文、数字、减号。被别人用过的话换一个。
3. 页面上方有一行 **token**（一长串字母数字，像 `a1b2c3d4-....`）。**复制保存好**，等一下要用。
   - IP 那一格不用填，安装程序会自动填。

---

## 第 3 步：建立云服务器（约 5 分钟）

1. 打开 **digitalocean.com**，注册并绑定付款方式。
2. 点 **Create** → **Droplets**。
3. 按下面选择：

| 项目 | 选择 |
|---|---|
| Region（地区） | **Singapore**（离马来西亚最近） |
| Image（系统） | **Ubuntu 24.04 (LTS) x64** |
| Size | **Basic** → **Regular** → 选 **1 GB** 内存的那一档 |
| Authentication | 选 **Password**，设一个**很强的 root 密码**并写下来 |
| Hostname | 填 `aqua` |

4. 点最下面 **Create Droplet**，等大约 1 分钟，直到出现一个 IP 地址。

---

## 第 4 步：安装 AQUA（约 10 分钟，只要粘贴一行）

1. 在 DigitalOcean 点进你的 Droplet（`aqua`）。
2. 点右上角 **Console**（或 **Access** → **Launch Droplet Console**），会打开一个黑色窗口。
3. 把下面这一行复制，**把两处 `你的用户名` 换成你的 GitHub 用户名**，然后粘贴到黑色窗口，按 **Enter**：

```
curl -fsSL https://raw.githubusercontent.com/你的用户名/smartfuze-aqua/main/cloud/install.sh | sudo REPO=你的用户名/smartfuze-aqua bash
```

例子（用户名是 ahming88）：

```
curl -fsSL https://raw.githubusercontent.com/ahming88/smartfuze-aqua/main/cloud/install.sh | sudo REPO=ahming88/smartfuze-aqua bash
```

4. 回答 3 个问题：
   - **DuckDNS 名字**：只填前面部分，例如 `myshrimp`
   - **DuckDNS token**：第 2 步保存的那串
   - **登录密码**：至少 10 位，输入时屏幕**不会显示**，这是正常的；要输入两次
5. 等它自动完成（会显示 1/8 到 8/8）。
6. 最后会显示 **安装完成** 和一段资料，例如：

```
【手机 / 电脑打开】 https://myshrimp.duckdns.org
【ESP32 固件里填写】
  #define USE_TLS 1
  MQTT_HOST = "myshrimp.duckdns.org"
  MQTT_PORT = 8883
  MQTT_USER = "dev-pond-a"
  MQTT_PASS = "Xk7pR2mQ9vT4nW8sY3hZ"
```

7. **用手机把这段拍下来。**设备密码（MQTT_PASS）只显示这一次。
   - 以后想再看：在 Console 输入 `cat /root/aqua-setup.txt`

---

## 第 5 步：手机打开（2 分钟）

1. 手机浏览器打开 `https://你的名字.duckdns.org`
2. 用户名 `admin`，密码是第 4 步设置的密码。手机会记住登录 90 天。
3. 添加到主屏幕，以后像 App 一样打开：
   - **iPhone**：Safari 下方分享按钮 → **添加到主屏幕**
   - **安卓**：Chrome 右上角 ⋮ → **安装应用** / **添加到主屏幕**

这时仪表盘显示 **Waiting for real ESP32 telemetry**（等待 ESP32 数据），这是正常的。

---

## 第 6 步：设置 ESP32 固件（10 分钟）

用 Arduino IDE 打开 `firmware/SMARTFUZE_AQUA_ESP32/SMARTFUZE_AQUA_ESP32.ino`，只改最上面这几行：

```cpp
const char* WIFI_SSID      = "店里4G路由器的WiFi名称";   // 必须是 2.4GHz
const char* WIFI_PASSWORD  = "WiFi密码";

#define USE_TLS 1
const char* MQTT_HOST      = "myshrimp.duckdns.org";    // 你的网址
const uint16_t MQTT_PORT   = 8883;
const char* MQTT_USER      = "dev-pond-a";               // 安装结果里的
const char* MQTT_PASS      = "Xk7pR2mQ9vT4nW8sY3hZ";     // 安装结果里的

const char* SITE_ID        = "SITE-01";   // 场地编号，仪表盘 Settings 里可以看到
const char* POND_ID        = "POND-A";
const char* POND_NAME      = "Pond A";
const char* DEVICE_ID      = "AQUA-POND-A-01";
```

其他传感器开关（`ENABLE_FLOW_SENSOR` 等）保持 **0**，以后买了再改。

上传后打开 **串口监视器（115200）**，正常会看到：

```
[WiFi] connecting to "..." ...
[MQTT] connecting to myshrimp.duckdns.org:8883 as dev-pond-a ... connected
[PUBLISH] T=28.94 C | pH=7.82 | RAW=1435 ...
```

几秒后手机上就会出现 **Pond A** 和真实读数。

### 串口监视器常见提示

| 看到 | 意思 | 怎么办 |
|---|---|---|
| `waiting for internet time` 一直出现 | ESP32 连不上网 | 检查 4G 路由器有没有信号、WiFi 名称密码 |
| `failed (state 5) - login refused` | 设备账号或密码错 | 重新抄 MQTT_USER / MQTT_PASS，注意大小写；POND_ID 要是 POND-A |
| 连上了但仪表盘没有数据 | 场地或池塘编号不对 | SITE_ID 要和 Settings 里显示的一样；POND_ID 要和设备账号的池塘一样 |
| `failed (state -2) - cannot reach server` | 找不到服务器 | 检查 MQTT_HOST 拼写、MQTT_PORT 是 8883 |
| `[BUFFER] stored offline reading` | 4G 断线，读数先存在 ESP32 里 | 不用管，联网后会自动补传（最多存 6 小时） |

---

## 第 7 步（建议）：设置手机报警

在仪表盘 **Settings → Phone alerts (Pushover)** 按页面说明设置。设置后，ESP32 离线（店里停电或断网）5 分钟，手机就会响。

- Pushover 是一次性付费（每个平台约 5 美元）。
- 在购买之前，至少每天打开仪表盘看一次 **Online** 状态。

---

## 以后的日常

| 想做的事 | 怎么做 |
|---|---|
| 更新 AQUA 到新版本 | 把新文件上传到 GitHub（覆盖），然后在 Console 输入 `sudo aqua-update` |
| 忘记登录密码 | Console 输入 `sudo aqua-reset-password` |
| 加第二个池塘 | 仪表盘 Settings → Device logins → New device login（Pond ID 填 `POND-B`），把显示的资料填进第二块 ESP32 |
| 某块 ESP32 丢失 / 被盗 | Settings → Device logins → 删除它的登录 |
| 备份 | 服务器每天 03:30 自动备份，保留 14 天（`/var/backups/aqua`）。也可以在 DigitalOcean 开启 Backups（另外收费） |
| 下载数据 | 仪表盘 Settings → 下载 CSV / 配置备份 |

---

## 安全说明

- 仪表盘有登录密码，手机记住 90 天。改密码会让其他手机全部登出。
- 连续输错 10 次密码，会锁 15 分钟。
- 每块 ESP32 有自己的账号，只能上传自己池塘的数据。
- 设备和服务器之间全程加密（TLS），网址使用 HTTPS。
- 不要把 root 密码、登录密码、设备密码发给别人。

---

## 遇到问题

| 问题 | 解决 |
|---|---|
| 安装时说 DuckDNS 更新失败 | 名字或 token 抄错。重新运行第 4 步那一行即可（可以重复运行，不会丢资料） |
| 安装时说下载失败 | GitHub 仓库要是 **Public**；命令里用户名、仓库名要正确 |
| 安装时说"仓库最外层没有 server.js" | 上传时拖了外层文件夹。到 GitHub 删除仓库重建，按第 1 步第 8 点重新上传 |
| 手机打不开网址 | 刚安装完要等几分钟让 HTTPS 证书生效 |
| 仪表盘 Settings 显示 `certificate not issued yet` | 等几分钟；还不行就重新运行第 4 步 |
| 其他问题 | Console 输入 `journalctl -u aqua -n 50`，把结果拍照给技术人员看 |
