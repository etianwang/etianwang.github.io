/* ============================================================
   站点配置
   把下面三项改成你自己的信息即可
   ============================================================ */
window.SITE_CONFIG = {
  // 你的 GitHub 用户名
  owner: "YOUR_GITHUB_USERNAME",
  // 仓库名，通常是 用户名.github.io
  repo: "YOUR_GITHUB_USERNAME.github.io",
  // 分支名，通常是 main
  branch: "main",
  // 文章存放目录
  postsDir: "posts",
  // 图片存放目录
  imagesDir: "images",
  // 云函数地址（部署 Cloudflare Worker 后，把它的访问地址填在这里）
  // 例如 https://my-blog-publish.yourname.workers.dev
  workerUrl: "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev",
  // 站点标题，显示在顶部导航
  siteTitle: "我的备忘录"
};
