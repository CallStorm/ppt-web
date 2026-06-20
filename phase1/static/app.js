// Phase 2 前端：登录状态机 + jobs CRUD + SSE + 文件上传
//
// 状态机：
//   boot → fetch /api/auth/me
//     200 → main UI（jobs 列表 / 详情 / SSE / 下载）
//     401 → auth UI（登录 / 注册切换）

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  me: null,          // 当前用户
  currentJobId: null,
  eventSource: null,
  events: [],
  lastSeq: 0,
};

// ── 工具 ───────────────────────────────────────────────────────
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
};
const fmtCost = (usd) => (usd == null ? "—" : `$${usd.toFixed(3)}`);
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ── API 调用（统一带 cookie） ──────────────────────────────────
async function api(method, path, body) {
  const opt = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) {
    opt.body = body;  // 让浏览器自己设 Content-Type + boundary
  } else if (body) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  if (r.status === 401) {
    // 任意端点 401 → 切回 auth 视图
    if (state.me) {
      state.me = null;
      renderAuth();
    }
    const text = await r.text();
    throw new Error(`401: ${text}`);
  }
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status}: ${text}`);
  }
  // SSE 路径不调 api()
  if (r.headers.get("content-type")?.includes("text/event-stream")) {
    return r;
  }
  return r.json();
}

// ── boot ──────────────────────────────────────────────────────
async function boot() {
  try {
    state.me = await api("GET", "/api/auth/me");
    renderMain();
  } catch {
    renderAuth();
  }
}

// ── Auth UI ────────────────────────────────────────────────────
function renderAuth() {
  const app = $("#app");
  app.innerHTML = `
    <header class="auth-header">
      <h1>📊 ppt-web</h1>
      <p class="sub">登录后开始生成 PPT</p>
    </header>
    <main class="auth-main">
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="tab active" data-mode="login">登录</button>
          <button class="tab" data-mode="register">注册</button>
        </div>
        <form id="auth-form">
          <label>邮箱
            <input type="email" id="auth-email" required autocomplete="username" />
          </label>
          <label>密码
            <input type="password" id="auth-password" required minlength="6" autocomplete="current-password" />
          </label>
          <button type="submit" id="auth-submit">登录</button>
          <p class="hint" id="auth-hint"></p>
        </form>
      </div>
    </main>
  `;
  let mode = "login";
  $$(".auth-tabs .tab").forEach((t) => {
    t.onclick = () => {
      mode = t.dataset.mode;
      $$(".auth-tabs .tab").forEach((x) => x.classList.toggle("active", x === t));
      $("#auth-submit").textContent = mode === "login" ? "登录" : "注册";
      $("#auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
      $("#auth-hint").textContent = "";
      $("#auth-hint").className = "hint";
    };
  });
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    const hint = $("#auth-hint");
    btn.disabled = true;
    hint.className = "hint";
    hint.textContent = mode === "login" ? "登录中…" : "注册中…";
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const u = await api("POST", path, { email, password });
      state.me = u;
      renderMain();
    } catch (err) {
      hint.className = "hint error";
      hint.textContent = "✗ " + err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

// ── Main UI ────────────────────────────────────────────────────
function renderMain() {
  const app = $("#app");
  app.innerHTML = `
    <header class="main-header">
      <h1>📊 ppt-web</h1>
      <div class="user-bar">
        <span class="me">${escapeHtml(state.me.email)}</span>
        <span class="quota" title="剩余配额（创建 job 扣 1，失败 refund）">credits: ${state.me.quota_credits}</span>
        <button class="ghost" id="logout-btn">登出</button>
      </div>
    </header>
    <main>
      <section class="col col-left">
        <h2>新建任务</h2>
        <form id="new-job-form">
          <label>项目名（可选）<input type="text" id="project-name" placeholder="留空自动生成" maxlength="48" /></label>
          <label>内容描述
            <textarea id="prompt" rows="5" required placeholder="例：写一份 4 页的 Python 入门 PPT，受众是编程初学者…"></textarea>
          </label>
          <label>素材文件（可选，可多选；PDF / DOCX / MD / PPTX / 图片…）
            <input type="file" id="files" multiple />
          </label>
          <p class="file-list" id="file-list"></p>
          <button type="submit" id="submit-btn">创建并启动</button>
          <p class="hint" id="new-job-hint"></p>
        </form>

        <h2>历史任务</h2>
        <ul id="job-list" class="job-list"></ul>
        <button id="refresh-list" class="ghost">刷新</button>
        <p class="hint warn">单 job 串行：系统一次只能跑一个生成任务。</p>
      </section>

      <section class="col col-right" id="detail-pane">
        <p class="placeholder">← 选一个任务看详情</p>
      </section>
    </main>
  `;

  // 文件选择预览
  $("#files").addEventListener("change", () => {
    const fs = $("#files").files;
    const fl = $("#file-list");
    if (!fs.length) { fl.textContent = ""; return; }
    const names = Array.from(fs).map(f => `${escapeHtml(f.name)} (${(f.size/1024).toFixed(1)}KB)`);
    fl.textContent = "已选: " + names.join(" · ");
  });

  // 登出
  $("#logout-btn").onclick = async () => {
    try {
      await api("POST", "/api/auth/logout");
    } catch {}
    if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    state.me = null;
    renderAuth();
  };

  // 创建任务
  $("#new-job-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#submit-btn");
    const hint = $("#new-job-hint");
    btn.disabled = true;
    hint.className = "hint";
    hint.textContent = "创建中…";
    try {
      const prompt = $("#prompt").value.trim();
      const project_name = $("#project-name").value.trim() || null;
      const fd = new FormData();
      fd.append("prompt", prompt);
      if (project_name) fd.append("project_name", project_name);
      const fs = $("#files").files;
      for (const f of fs) fd.append("files", f, f.name);
      const r = await api("POST", "/api/jobs", fd);
      hint.className = "hint success";
      hint.textContent = `✓ 已创建 ${r.id.slice(0, 8)}（上传 ${r.uploads} 个文件）`;
      $("#prompt").value = "";
      $("#project-name").value = "";
      $("#files").value = "";
      $("#file-list").textContent = "";
      await refreshList();
      selectJob(r.id);
    } catch (err) {
      hint.className = "hint error";
      hint.textContent = "✗ " + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("#refresh-list").onclick = () => refreshList();

  refreshList().catch(console.error);
  setInterval(() => refreshList().catch(() => {}), 10000);
}

// ── 任务列表 ──────────────────────────────────────────────────
async function refreshList() {
  const { jobs } = await api("GET", "/api/jobs");
  const ul = $("#job-list");
  ul.innerHTML = "";
  for (const j of jobs) {
    const li = document.createElement("li");
    if (j.id === state.currentJobId) li.classList.add("active");
    li.dataset.id = j.id;
    li.innerHTML = `
      <div class="row1">
        <span class="name">${escapeHtml(j.project_name)}</span>
        <span class="status-pill status-${j.status}">${j.status}</span>
      </div>
      <div class="meta">
        ${fmtTime(j.updated_at)} · ${fmtCost(j.cost_usd)} · ${truncate(j.prompt, 50)}
      </div>
    `;
    li.onclick = () => selectJob(j.id);
    ul.appendChild(li);
  }
}

// ── 任务详情 + SSE ─────────────────────────────────────────────
async function selectJob(jobId) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.currentJobId = jobId;
  state.events = [];
  state.lastSeq = 0;

  $$(".job-list li").forEach((li) => li.classList.toggle("active", li.dataset.id === jobId));

  const j = await api("GET", `/api/jobs/${jobId}`);
  renderDetail(j);
  openSse(jobId);
}

function openSse(jobId) {
  const fromSeq = state.lastSeq || 0;
  const url = `/api/jobs/${jobId}/events?from_seq=${fromSeq}`;
  // EventSource 默认带 cookie（same-origin），无需 withCredentials
  const es = new EventSource(url);
  state.eventSource = es;

  es.onopen = () => setSseIndicator("connected");
  es.onerror = () => {
    setSseIndicator("error");
    // 不立即重连——终态时 server 会关流；非终态可由下次操作重连
  };

  const onMsg = (type) => (e) => {
    let payload;
    try { payload = JSON.parse(e.data); } catch { payload = {}; }
    const seq = parseInt(e.lastEventId, 10) || 0;
    if (seq <= state.lastSeq) return;
    state.lastSeq = seq;
    state.events.push({ seq, type, payload });
    handleEvent(type, payload);
  };
  ["status", "stage", "tool", "agent_text", "result", "spec", "error", "pptx"].forEach((t) => {
    es.addEventListener(t, onMsg(t));
  });
}

function setSseIndicator(s) {
  const el = $("#sse-indicator");
  if (!el) return;
  el.className = "sse-indicator " + s;
}

function handleEvent(type, payload) {
  if (type === "agent_text") {
    $("#last-text").textContent = payload.text || "";
  } else if (type === "status") {
    $("#detail-status").textContent = payload.status;
    $("#detail-status").className = "status-pill status-" + payload.status;
  } else if (type === "tool") {
    appendTimeline({
      type: "tool",
      label: payload.stage || payload.tool,
      detail: payload.command || payload.file_path,
    });
  } else if (type === "result") {
    appendTimeline({
      type: "result",
      label: `result (cost=$${(payload.cost_usd || 0).toFixed(3)}, stop=${payload.stop_reason})`,
    });
  } else if (type === "pptx" && payload.url) {
    showDownload(payload.url);
    if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    setSseIndicator("");
    api("GET", `/api/jobs/${state.currentJobId}`).then(renderDetail);
  } else if (type === "error") {
    appendTimeline({ type: "error", label: "ERROR", detail: payload.message });
  }
}

function renderDetail(j) {
  const pane = $("#detail-pane");
  const shortPrompt = j.prompt.length > 200 ? j.prompt.slice(0, 200) + "…" : j.prompt;
  pane.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(j.project_name)}</h2>
      <div class="right">
        <span class="sse-indicator" id="sse-indicator"></span>
        <span class="status-pill status-${j.status}" id="detail-status">${j.status}</span>
        ${j.status === "queued" || j.status === "running"
          ? '<button class="danger" id="cancel-btn">取消</button>'
          : ''}
      </div>
    </div>
    <div class="meta-grid">
      <div class="k">Job ID</div><div class="v"><code>${j.id}</code></div>
      <div class="k">创建</div><div class="v">${fmtTime(j.created_at)}</div>
      <div class="k">更新</div><div class="v">${fmtTime(j.updated_at)}</div>
      <div class="k">花费</div><div class="v">${fmtCost(j.cost_usd)}</div>
      <div class="k">Session</div><div class="v"><code>${j.session_id || "—"}</code></div>
      <div class="k">项目目录</div><div class="v"><code>${j.project_dir || "—"}</code></div>
      <div class="k">提示词</div><div class="v">${escapeHtml(shortPrompt)}</div>
    </div>
    ${j.error_message ? `<div class="error-box">${escapeHtml(j.error_message)}</div>` : ''}

    <div class="section" id="download-section" style="${j.pptx_path ? '' : 'display:none'}">
      <h3>产物</h3>
      <a class="download-link" id="download-link" href="/api/jobs/${j.id}/pptx" download>⬇ 下载 PPTX</a>
    </div>

    <div class="section">
      <h3>Agent 最新输出</h3>
      <div class="last-text" id="last-text">${escapeHtml(j.last_agent_text || "(等待输出…)")}</div>
    </div>

    <div class="section">
      <h3>事件时间线</h3>
      <div class="timeline" id="timeline"><div class="row" style="color:var(--muted)">等待事件…</div></div>
    </div>
  `;
  const cancelBtn = $("#cancel-btn");
  if (cancelBtn) cancelBtn.onclick = () => doCancel(j.id);
  if (j.pptx_path) showDownload(`/api/jobs/${j.id}/pptx`);
  state.events = [];
  state.lastSeq = 0;
}

function appendTimeline({ type, label, detail }) {
  const tl = $("#timeline");
  if (!tl) return;
  if (tl.querySelector(".row") && tl.firstElementChild.style.color === "var(--muted)") {
    tl.innerHTML = "";
  }
  const row = document.createElement("div");
  row.className = "row";
  const detailHtml = detail ? `<span style="color:var(--muted);margin-left:6px">${escapeHtml(truncate(detail, 80))}</span>` : "";
  row.innerHTML = `<span class="type-${type}">[${type}]</span> <strong>${escapeHtml(label)}</strong>${detailHtml}`;
  tl.appendChild(row);
  tl.scrollTop = tl.scrollHeight;
}

function showDownload(url) {
  const sec = $("#download-section"); const a = $("#download-link");
  if (sec && a) { sec.style.display = "block"; a.href = url; }
}

async function doCancel(jobId) {
  if (!confirm("确认取消这个任务？")) return;
  try {
    await api("POST", `/api/jobs/${jobId}/cancel`);
    refreshList();
  } catch (e) { alert("取消失败: " + e.message); }
}

// ── 启动 ─────────────────────────────────────────────────────
boot();
