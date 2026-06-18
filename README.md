# 部署说明

整套系统分两部分：**静态站点**（部署到 GitHub Pages）和 **云函数**（部署到 Cloudflare Workers，负责密码校验和代为操作 GitHub，避免把 GitHub Token 暴露在浏览器里）。

---

## 第一步：建仓库、放静态文件

1. 在 GitHub 新建一个仓库，名字必须是 `你的用户名.github.io`，设为 Public。
2. 把这个项目里除 `worker.js` 之外的所有文件和文件夹，原样放进仓库根目录：
   - `index.html`、`post.html`、`login.html`、`edit.html`
   - `assets/`（含 `style.css`、`common.js`、`config.js`）
   - `posts/`（含示例文章，可以删掉换成自己的）
   - `images/`（空文件夹，上传的图片会自动放进来，Git 不会跟踪完全空的文件夹，可以先放一个 `.gitkeep` 占位）
   - `.nojekyll`（必须有，否则 GitHub Pages 会用 Jekyll 处理站点，干扰我们自己写的页面）
3. 仓库 Settings → Pages，Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。
4. 等一两分钟，访问 `https://你的用户名.github.io` 确认页面能打开（这时文章列表能看到，因为读取是公开匿名的，不需要任何密钥）。

---

## 第二步：生成 GitHub Token

1. GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。
2. Repository access 选择 "Only select repositories"，选中你刚建的这个仓库。
3. Permissions 里找到 **Contents**，设为 **Read and write**，其他权限不用给。
4. 生成后复制保存好这个 token（只会显示一次）。

---

## 第三步：部署 Cloudflare Worker

1. 注册 Cloudflare 账号（免费），进入 Dashboard → Workers & Pages → Create → Create Worker。
2. 起一个名字，比如 `blog-publish`，创建后进入编辑器，把 `worker.js` 的全部内容粘贴进去，覆盖默认代码，点 Deploy。
3. 部署后会有一个形如 `https://blog-publish.你的子域名.workers.dev` 的地址，记下来。
4. 进入这个 Worker 的 Settings → Variables，添加以下环境变量（注意 GITHUB_TOKEN 和 SESSION_SECRET 要点 "Encrypt" 加密保存）：

   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `ADMIN_PASSWORD` | 自己定的密码 | 登录用 |
   | `GITHUB_TOKEN` | 第二步生成的 token | 加密保存 |
   | `SESSION_SECRET` | 任意一串随机字符串，越长越随机越好 | 加密保存，用来签名登录令牌 |
   | `GITHUB_OWNER` | 你的 GitHub 用户名 | |
   | `GITHUB_REPO` | `你的用户名.github.io` | |
   | `GITHUB_BRANCH` | `main` | |
   | `ALLOWED_ORIGIN` | `https://你的用户名.github.io` | 限制只有你的站点能调用这个云函数 |

5. 保存后 Worker 会自动重新部署生效。

---

## 第四步：把云函数地址填回站点配置

打开仓库里的 `assets/config.js`，把里面的占位信息改成你自己的：

```js
window.SITE_CONFIG = {
  owner: "你的GitHub用户名",
  repo: "你的GitHub用户名.github.io",
  branch: "main",
  postsDir: "posts",
  imagesDir: "images",
  workerUrl: "https://blog-publish.你的子域名.workers.dev",
  siteTitle: "你想要的站点标题"
};
```

改完 commit 推回仓库，等 GitHub Pages 重新构建（一两分钟）就生效了。

---

## 验证流程

1. 访问首页，能看到示例文章，分类、标签筛选正常。
2. 点右上角锁图标进登录页，输入你设置的 `ADMIN_PASSWORD`，登录成功会跳回首页。
3. 进文章页，应该能看到右上角多了一个编辑图标（说明登录态生效）。
4. 点编辑，改点内容，点"发布到仓库"，几秒后应该提示发布成功，刷新仓库的 `posts/` 目录能看到文件被更新。
5. 试着新建一篇文章、上传一张图片，确认 `images/` 目录里出现了对应文件，文章页里图片正常显示。

---

## 安全性说明

- `ADMIN_PASSWORD` 和 `GITHUB_TOKEN` 只存在于 Cloudflare Worker 的加密环境变量里，从不会出现在浏览器、仓库代码或网络传输的明文里。
- 登录成功后，浏览器拿到的是一个有效期 6 小时的会话令牌（HMAC 签名，不是密码也不是 token），存在 `sessionStorage`，关闭浏览器标签页即失效。
- 所有写操作（发布、删除、传图片）都要带着这个令牌，由 Worker 验证令牌有效性后才会去操作 GitHub，令牌过期后这些接口会拒绝请求，需要重新登录。
- 仓库本身是公开的（GitHub Pages 免费版的硬性要求），意味着所有已发布的文章和图片本身就是任何人可访问的，这不是 bug，是这套架构的天然属性。
