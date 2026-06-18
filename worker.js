/* ============================================================
   worker.js  —  部署到 Cloudflare Workers

   作用：
   1. 验证管理员密码，验证通过后签发一个有时效的会话令牌（HMAC 签名，不依赖数据库）
   2. 收到带有效令牌的请求时，用环境变量里的 GITHUB_TOKEN 代为调用 GitHub API
      完成"创建/更新文章"、"删除文章"、"上传图片"
   3. GitHub Token 全程只活在这个 Worker 的环境变量里，不会传给浏览器

   需要在 Cloudflare Workers 后台设置的环境变量（Settings → Variables）：
   - ADMIN_PASSWORD   你的管理员密码（明文存，Workers 环境变量本身是加密保存的）
   - GITHUB_TOKEN      具备该仓库 Contents 读写权限的 Fine-grained PAT
   - SESSION_SECRET    任意一串随机字符串，用来签名会话令牌（自己随便定，越长越好）
   - GITHUB_OWNER      你的 GitHub 用户名
   - GITHUB_REPO       仓库名，例如 yourname.github.io
   - GITHUB_BRANCH     分支名，通常是 main
   - ALLOWED_ORIGIN    你的站点地址，例如 https://yourname.github.io（用于 CORS 限制）
   ============================================================ */

const TOKEN_TTL_SECONDS = 60 * 60 * 6; // 会话令牌有效期：6 小时

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------- CORS 处理 ----------
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: false, message: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, message: "请求体不是合法 JSON" }, 400, corsHeaders);
      }

      if (url.pathname === "/verify") {
        return await handleVerify(body, env, corsHeaders);
      }
      if (url.pathname === "/save-post") {
        return await handleSavePost(body, env, corsHeaders);
      }
      if (url.pathname === "/delete-post") {
        return await handleDeletePost(body, env, corsHeaders);
      }
      if (url.pathname === "/upload-image") {
        return await handleUploadImage(body, env, corsHeaders);
      }

      return json({ ok: false, message: "未知接口" }, 404, corsHeaders);
    } catch (err) {
      return json({ ok: false, message: "服务器内部错误: " + err.message }, 500, corsHeaders);
    }
  }
};

// ============================================================
// 密码验证 → 签发会话令牌
// ============================================================
async function handleVerify(body, env, corsHeaders) {
  const { password } = body;
  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, message: "密码错误" }, 401, corsHeaders);
  }
  const token = await signToken(env.SESSION_SECRET);
  return json({ ok: true, token }, 200, corsHeaders);
}

// ============================================================
// 保存文章（新建或更新，区分依据是是否带 sha）
// ============================================================
async function handleSavePost(body, env, corsHeaders) {
  const { token, filename, content, sha } = body;
  const authError = await checkToken(token, env);
  if (authError) return json(authError.payload, authError.status, corsHeaders);

  if (!filename || !content) {
    return json({ ok: false, message: "缺少 filename 或 content" }, 400, corsHeaders);
  }

  const path = `posts/${filename}`;
  const result = await githubPutFile(env, path, content, sha, `chore: publish ${filename}`);
  if (!result.ok) {
    return json({ ok: false, message: result.message }, result.status, corsHeaders);
  }
  return json({ ok: true, sha: result.sha }, 200, corsHeaders);
}

// ============================================================
// 删除文章
// ============================================================
async function handleDeletePost(body, env, corsHeaders) {
  const { token, filename, sha } = body;
  const authError = await checkToken(token, env);
  if (authError) return json(authError.payload, authError.status, corsHeaders);

  if (!filename || !sha) {
    return json({ ok: false, message: "缺少 filename 或 sha" }, 400, corsHeaders);
  }

  const path = `posts/${filename}`;
  const result = await githubDeleteFile(env, path, sha, `chore: delete ${filename}`);
  if (!result.ok) {
    return json({ ok: false, message: result.message }, result.status, corsHeaders);
  }
  return json({ ok: true }, 200, corsHeaders);
}

// ============================================================
// 上传图片
// ============================================================
async function handleUploadImage(body, env, corsHeaders) {
  const { token, filename, contentBase64 } = body;
  const authError = await checkToken(token, env);
  if (authError) return json(authError.payload, authError.status, corsHeaders);

  if (!filename || !contentBase64) {
    return json({ ok: false, message: "缺少 filename 或 contentBase64" }, 400, corsHeaders);
  }

  const path = `images/${filename}`;
  // 图片走 putFile，但内容已经是 base64，不需要再编码
  const result = await githubPutFile(env, path, contentBase64, null, `chore: upload image ${filename}`, true);
  if (!result.ok) {
    return json({ ok: false, message: result.message }, result.status, corsHeaders);
  }
  return json({ ok: true, path }, 200, corsHeaders);
}

// ============================================================
// GitHub API 封装
// ============================================================
async function githubPutFile(env, path, content, sha, message, isAlreadyBase64 = false) {
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const contentBase64 = isAlreadyBase64 ? content : toBase64Utf8(content);

  const payload = {
    message,
    content: contentBase64,
    branch: env.GITHUB_BRANCH || "main"
  };
  if (sha) payload.sha = sha;

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, status: res.status, message: data.message || "GitHub API 写入失败" };
  }
  return { ok: true, sha: data.content?.sha };
}

async function githubDeleteFile(env, path, sha, message) {
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;

  const res = await fetch(apiUrl, {
    method: "DELETE",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH || "main"
    })
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, status: res.status, message: data.message || "GitHub API 删除失败" };
  }
  return { ok: true };
}

function githubHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "blog-publish-worker"
  };
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

// ============================================================
// 会话令牌：HMAC-SHA256 签名的简单令牌，不依赖数据库
// 格式：base64(payload).base64(signature)
// payload 内容：{ exp: 过期时间戳 }
// ============================================================
async function signToken(secret) {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_TTL_SECONDS * 1000 });
  const payloadB64 = btoa(payload);
  const signature = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

async function verifyToken(token, secret) {
  if (!token || !token.includes(".")) return false;
  const [payloadB64, signature] = token.split(".");
  const expected = await hmacSign(payloadB64, secret);
  if (signature !== expected) return false;

  try {
    const payload = JSON.parse(atob(payloadB64));
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
}

async function checkToken(token, env) {
  const valid = await verifyToken(token, env.SESSION_SECRET);
  if (!valid) {
    return { payload: { ok: false, message: "登录已过期，请重新登录" }, status: 401 };
  }
  return null;
}

// ============================================================
// 工具函数
// ============================================================
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}
