/* ============================================================
   common.js
   全站共用的工具函数：
   - 解析文章 frontmatter
   - 只读方式从 GitHub 拉取文章列表（不需要 token）
   - 标签/分类的颜色分配
   - 简单的 toast 提示
   ============================================================ */

const Common = (() => {

  const cfg = window.SITE_CONFIG;
  const RAW_BASE = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}`;
  const API_BASE = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;

  // 给标签/分类轮流分配颜色，保证视觉区分但又不杂乱
  const COLOR_CYCLE = ["blue", "green", "amber", "purple", "red"];
  const colorMap = new Map();
  function colorFor(name) {
    if (!colorMap.has(name)) {
      colorMap.set(name, COLOR_CYCLE[colorMap.size % COLOR_CYCLE.length]);
    }
    return colorMap.get(name);
  }

  // ---------- frontmatter 解析 ----------
  // 期望格式：
  // ---
  // title: 文章标题
  // date: 2026-06-15
  // category: Linux
  // tags: Wayland, 备忘
  // ---
  // 正文……
  function parseFrontmatter(raw) {
    const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
      return { meta: {}, body: raw };
    }
    const yamlBlock = match[1];
    const body = match[2];
    const meta = {};
    yamlBlock.split("\n").forEach(line => {
      const idx = line.indexOf(":");
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      // 去除可能的引号包裹
      value = value.replace(/^["']|["']$/g, "");
      meta[key] = value;
    });
    return { meta, body };
  }

  function buildFrontmatter(meta) {
    const lines = ["---"];
    lines.push(`title: ${meta.title || ""}`);
    lines.push(`date: ${meta.date || ""}`);
    lines.push(`category: ${meta.category || ""}`);
    lines.push(`tags: ${meta.tags || ""}`);
    lines.push("---");
    return lines.join("\n");
  }

  function splitTags(tagsStr) {
    if (!tagsStr) return [];
    return tagsStr.split(",").map(t => t.trim()).filter(Boolean);
  }

  // ---------- 只读方式获取文章列表 ----------
  // 用 GitHub contents API 列出 posts/ 目录下所有 .md 文件
  // 这一步不需要 token，公开仓库的只读请求允许匿名访问（有速率限制，但个人博客足够）
  async function listPostFiles() {
    const res = await fetch(`${API_BASE}/contents/${cfg.postsDir}`);
    if (!res.ok) {
      throw new Error(`无法获取文章列表 (${res.status})`);
    }
    const list = await res.json();
    return list.filter(item => item.type === "file" && item.name.endsWith(".md"));
  }

  // 拉取单篇文章原始内容（通过 raw.githubusercontent.com，比 API 更不容易触发限流）
  async function fetchRawFile(path) {
    const res = await fetch(`${RAW_BASE}/${path}?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`无法获取文件内容: ${path}`);
    }
    return res.text();
  }

  // 拉取全部文章，解析好 meta，按日期倒序返回
  let postsCache = null;
  async function getAllPosts(forceRefresh = false) {
    if (postsCache && !forceRefresh) return postsCache;

    const files = await listPostFiles();
    const posts = await Promise.all(files.map(async file => {
      const raw = await fetchRawFile(`${cfg.postsDir}/${file.name}`);
      const { meta, body } = parseFrontmatter(raw);
      return {
        filename: file.name,
        sha: file.sha,
        path: file.path,
        title: meta.title || file.name.replace(/\.md$/, ""),
        date: meta.date || "",
        category: meta.category || "未分类",
        tags: splitTags(meta.tags),
        body
      };
    }));

    posts.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    postsCache = posts;
    return posts;
  }

  function invalidateCache() {
    postsCache = null;
  }

  // 从全部文章里汇总出现过的分类和标签（去重 + 计数）
  function summarizeTaxonomy(posts) {
    const categories = new Map();
    const tags = new Map();
    posts.forEach(p => {
      if (p.category) {
        categories.set(p.category, (categories.get(p.category) || 0) + 1);
      }
      p.tags.forEach(t => {
        tags.set(t, (tags.get(t) || 0) + 1);
      });
    });
    return {
      categories: [...categories.entries()].map(([name, count]) => ({ name, count })),
      tags: [...tags.entries()].map(([name, count]) => ({ name, count }))
    };
  }

  function excerpt(body, len = 80) {
    const plain = body
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/[#*`>\-]/g, "")
      .replace(/\n+/g, " ")
      .trim();
    return plain.length > len ? plain.slice(0, len) + "..." : plain;
  }

  // ---------- 简单 toast ----------
  function toast(msg, isError = false) {
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  // ---------- 登录状态 ----------
  // 登录态以"是否持有有效会话令牌"为准，令牌由云函数在密码验证通过后签发
  // 令牌只存在 sessionStorage（关闭标签页即失效），且令牌本身不是密码也不是 GitHub token
  function isLoggedIn() {
    return !!sessionStorage.getItem("blog_session_token");
  }
  function setLoggedIn(val, token) {
    if (val && token) {
      sessionStorage.setItem("blog_session_token", token);
    } else {
      sessionStorage.removeItem("blog_session_token");
    }
  }

  return {
    cfg,
    parseFrontmatter,
    buildFrontmatter,
    splitTags,
    getAllPosts,
    invalidateCache,
    summarizeTaxonomy,
    excerpt,
    colorFor,
    toast,
    isLoggedIn,
    setLoggedIn
  };
})();
