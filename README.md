# 部署说明

整套系统分两部分：**静态站点**（部署到 GitHub Pages）和 **云函数**（部署到 Cloudflare Workers，负责密码校验和代为操作 GitHub，避免把 GitHub Token 暴露在浏览器里）。

---

## 文件结构

```
仓库根目录/
├── index.html          首页（文章列表 + 分类 + 标签筛选）
├── post.html           文章详情页
├── login.html          管理员登录页
├── edit.html           文章编辑/新增页
├── .nojekyll           禁用 Jekyll，必须有
├── assets/
│   ├── style.css       全站样式（毛玻璃风格）
│   ├── common.js       共用逻辑（文章拉取、标签汇总等）
│   └── config.js       站点配置（必须修改）
├── posts/              文章存放目录（.md 文件）
├── images/
│   ├── bg.png          背景图（毛玻璃风格的壁纸）
│   └── ...             文章里上传的图片
└── worker.js           Cloudflare Worker 云函数（不上传到 Pages 仓库）
```

---

## 第一步：建仓库、放静态文件

1. 在 GitHub 新建仓库，名字必须是 `你的用户名.github.io`，设为 Public。
2. 把除 `worker.js` 之外的所有文件原样放进仓库根目录。
3. **把背景图命名为 `bg.png` 放进 `images/` 目录**，这是毛玻璃主题的壁纸，CSS 已经写好了对应路径。如果想用其他文件名，修改 `assets/style.css` 第一行 `body` 里的 `url('../images/bg.png')` 即可。
4. 仓库 Settings → Pages，Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。
5. 等一两分钟，访问 `https://你的用户名.github.io` 确认页面能打开。

---

## 第二步：生成 GitHub Token

1. GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。
2. Repository access 选择 "Only select repositories"，选中你的站点仓库。
3. Permissions 里找到 **Contents**，设为 **Read and write**，其他权限不用给。
4. 生成后复制保存好这个 token（只会显示一次）。

---

## 第三步：部署 Cloudflare Worker

1. 注册 Cloudflare 账号（免费），进入 Dashboard → Workers & Pages → Create。
2. 选择 **从 Hello World! 开始**，起一个名字（比如 `blog-publish`），点创建。
3. 创建完成后点 **Edit code（编辑代码）**，把编辑器里的默认内容全部删掉，粘贴 `worker.js` 的全部内容，点 Deploy 部署。
4. 部署后记下 Worker 地址，形如 `https://blog-publish.你的子域名.workers.dev`。
5. 进入这个 Worker 的 Settings → Variables，添加以下环境变量（`GITHUB_TOKEN` 和 `SESSION_SECRET` 要点 Encrypt 加密保存）：

   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `ADMIN_PASSWORD` | 自己定的登录密码 | 明文保存即可 |
   | `GITHUB_TOKEN` | 第二步生成的 token | 加密保存 |
   | `SESSION_SECRET` | 任意一串随机字符串，越长越好 | 加密保存，用于签名会话令牌 |
   | `GITHUB_OWNER` | 你的 GitHub 用户名 | |
   | `GITHUB_REPO` | `你的用户名.github.io` | |
   | `GITHUB_BRANCH` | `main` | |
   | `ALLOWED_ORIGIN` | `https://你的用户名.github.io` | 限制跨域，只允许你的站点调用 |

6. 保存后 Worker 自动重新部署生效。

---

## 第四步：修改站点配置

打开仓库里的 `assets/config.js`，把占位内容改成你自己的信息：

```js
window.SITE_CONFIG = {
  owner: "你的GitHub用户名",
  repo: "你的GitHub用户名.github.io",
  branch: "main",
  postsDir: "posts",
  imagesDir: "images",
  workerUrl: "https://blog-publish.你的子域名.workers.dev",
  siteTitle: "你的站点标题",
  siteDescription: "站点描述"
};
```

改完 commit 提交，等 GitHub Pages 部署完成（通常十秒左右）即可生效。

---

## 使用说明

**浏览**：首页左侧点分类筛选，右侧点标签筛选（可多选），点文章卡片进入详情页。

**登录**：点右上角 🔒 图标进入登录页，输入 `ADMIN_PASSWORD` 登录。登录成功后右上角变为 ＋（新增文章）和退出图标，会话令牌有效期 6 小时，关闭标签页即失效。

**新增文章**：登录后点右上角 ＋，填写标题、日期、分类、标签（逗号分隔），正文支持 Markdown，点"插入图片"可上传图片（自动上传到仓库 `images/` 目录并插入引用），填完点"发布到仓库"。

**编辑/删除文章**：进入文章详情页，右上角会出现 ✎ 编辑图标，点击进入编辑页，可修改内容后重新发布，或点"删除文章"。

**分类和标签管理**：无需提前定义，写文章时直接填写新的分类名或标签名，首页会自动扫描所有文章汇总出现过的分类和标签，去重后展示在左右侧边栏。

**背景图更换**：把新壁纸命名为 `bg.png` 上传到 `images/` 目录覆盖即可，或修改 `assets/style.css` 里的路径换用其他文件名。

---

## 安全性说明

- `ADMIN_PASSWORD` 和 `GITHUB_TOKEN` 只存在 Cloudflare Worker 的加密环境变量里，不会出现在浏览器、仓库代码或网络传输的明文中。
- 登录成功后浏览器拿到的是一个有效期 6 小时的会话令牌（HMAC-SHA256 签名），不是密码也不是 GitHub token，存在 `sessionStorage`，关闭标签页即失效。
- 所有写操作（发布、删除、上传图片）都需携带会话令牌，由 Worker 验证有效性后才会操作 GitHub，令牌过期后自动跳回登录页。
- 仓库是公开的（GitHub Pages 免费版要求），所有已发布的文章和图片任何人都可以访问，这是这套架构的天然属性。

---

## 常见问题

**首页加载文章失败**：检查 `config.js` 里的 `owner`、`repo` 是否填写正确；如果短时间内频繁刷新，可能触发了 GitHub API 匿名限流（每小时 60 次），等一小时或换网络重试。

**登录没有反应**：打开浏览器控制台（F12），检查是否有红色报错；确认 `config.js` 里的 `workerUrl` 地址填写正确且 Worker 已正常部署。

**发布失败**：确认 Cloudflare Worker 的七个环境变量都已正确设置；登录令牌过期（6小时）会自动跳回登录页重新登录即可。

**背景图不显示**：确认图片已上传到仓库的 `images/` 目录，且文件名与 `style.css` 里的路径一致（默认是 `bg.png`）。
