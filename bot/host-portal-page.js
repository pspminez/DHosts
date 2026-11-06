// Host-facing dashboard, served whole by the Worker at /host.
//
// Kept as one template for the same reason the admin page is: there is nothing
// to build and one deploy ships the page and its data API together.
//
// The page never renders guest phone numbers or message bodies raw: the Worker
// sends body_redacted, and every dynamic value goes through textContent.

export const HOST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0908">
<meta name="robots" content="noindex">
<title>StayXI — Host portal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,100..1000&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0b0908; --panel:#0e0c0b; --card:#151211; --card-2:#191514;
    --line:#27211d; --line-soft:#201b18;
    --text:#f2ede8; --muted:#a69c94; --faint:#7d736b;
    --accent:#ff8a3d; --amber:#ffc46b; --green:#8fc7a4;
    --answered:#d9d29a; --answered-bg:#2e2b1c;
    --routed:#e6bd90; --routed-bg:#3a2a1d;
    --font:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  * { box-sizing:border-box; }
  html { color-scheme:dark; }
  body {
    margin:0; background:var(--bg); color:var(--text); font:14px/1.5 var(--font);
    letter-spacing:-.011em; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    text-rendering:optimizeLegibility;
  }
  h1,h2,h3,p,ul,ol { margin:0; padding:0; }
  ul,ol { list-style:none; }
  button,input,textarea { font:inherit; letter-spacing:inherit; color:inherit; }
  button { cursor:pointer; }
  .hidden { display:none !important; }
  .muted { color:var(--muted); }
  .faint { color:var(--faint); }
  code { font-family:ui-monospace,Menlo,Consolas,monospace; color:var(--amber); font-size:.9em; }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:8px; }
  ::selection { background:rgba(255,122,69,.35); color:#fff; }

  /* ---------- shell ---------- */
  .app { display:grid; grid-template-columns:236px minmax(0,1fr); min-height:100vh; }
  .sidebar {
    display:flex; flex-direction:column; gap:18px; padding:16px 14px 18px;
    background:var(--panel); border-right:1px solid var(--line-soft);
    position:sticky; top:0; height:100vh;
  }
  .brand { display:flex; align-items:center; gap:9px; padding:2px 8px 4px; font-weight:600; font-size:15px; letter-spacing:-.02em; }
  .logo-mark { display:grid; width:26px; height:26px; place-items:center; border-radius:8px;
    background:linear-gradient(135deg,#241c18,#191412); box-shadow:inset 0 0 0 1px var(--line); }
  .logo-mark svg { width:13px; height:13px; }
  .nav { display:flex; flex-direction:column; gap:3px; }
  .nav-item {
    display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px;
    border:1px solid transparent; border-radius:10px; background:transparent;
    color:var(--muted); font-size:13.5px; font-weight:500; text-align:left;
    transition:background .15s ease,color .15s ease,border-color .15s ease;
  }
  .nav-item svg { width:17px; height:17px; flex:none; opacity:.85; }
  .nav-item:hover { color:var(--text); background:rgba(255,255,255,.035); }
  .nav-item.active { color:var(--text); background:#1d1917; border-color:#2a2420; }
  .nav-badge { margin-left:auto; min-width:19px; padding:1px 6px; border-radius:999px;
    background:#3a2418; color:#ffb083; font-size:11px; font-weight:600; text-align:center; }
  .sections { margin-top:4px; }
  .nav-group { padding:0 10px 7px; color:var(--faint); font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; }
  .section-list { display:flex; flex-direction:column; gap:2px; }
  .section-list button { display:flex; align-items:center; gap:9px; width:100%; padding:6px 10px;
    border:0; border-radius:8px; background:transparent; color:var(--muted); font-size:13px; text-align:left; }
  .section-list button:hover { color:var(--text); background:rgba(255,255,255,.03); }
  .section-dot { width:8px; height:8px; flex:none; border-radius:2px; }
  .section-list .empty-section { padding:6px 10px; color:var(--faint); font-size:12.5px; }
  .who { display:flex; align-items:center; gap:9px; margin-top:auto; padding:11px 8px 0; border-top:1px solid var(--line-soft); }
  .avatar { display:grid; width:30px; height:30px; flex:none; place-items:center; border-radius:999px;
    background:linear-gradient(135deg,#3a2a1d,#221a14); color:#ffc9a3; font-size:12px; font-weight:600;
    box-shadow:inset 0 0 0 1px var(--line); }
  .who-text { display:flex; min-width:0; flex-direction:column; line-height:1.25; }
  .who-text strong { overflow:hidden; font-size:12.5px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
  .who-text span { color:var(--faint); font-size:11px; }
  .sign-out { margin-left:auto; display:grid; width:28px; height:28px; place-items:center;
    border:1px solid transparent; border-radius:8px; background:transparent; color:var(--faint); }
  .sign-out:hover { border-color:var(--line); color:var(--text); background:rgba(255,255,255,.03); }
  .sign-out svg { width:15px; height:15px; }

  .main { min-width:0; }
  .topbar {
    display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap;
    padding:16px 26px 15px; border-bottom:1px solid var(--line-soft);
    background:rgba(11,9,8,.94); backdrop-filter:blur(14px);
    position:sticky; top:0; z-index:5;
  }
  .property-name { color:var(--muted); font-size:12px; font-weight:500; letter-spacing:.01em; }
  .topbar h1 { margin-top:1px; font-size:19px; font-weight:600; letter-spacing:-.025em; }
  .range { display:inline-flex; gap:2px; padding:3px; border:1px solid var(--line); border-radius:10px; background:#100e0d; }
  .range button { padding:5px 11px; border:0; border-radius:7px; background:transparent; color:var(--muted); font-size:12.5px; font-weight:500; }
  .range button:hover { color:var(--text); }
  .range button.on { background:#241f1c; color:var(--text); box-shadow:inset 0 1px 0 rgba(255,255,255,.06); }

  .content { padding:20px 26px 42px; max-width:1380px; }
  .sample-banner { margin:14px 26px 0; padding:9px 13px; border:1px solid rgba(255,181,71,.28);
    border-radius:10px; background:rgba(255,181,71,.06); color:#e8c79a; font-size:12.5px; }
  .view-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
  .view-head h2 { font-size:16px; font-weight:600; letter-spacing:-.02em; }
  .view-head p { margin-top:2px; color:var(--muted); font-size:13px; }

  /* ---------- activity ---------- */
  .stat-row { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:13px; }
  .card { border:1px solid var(--line); border-radius:14px; background:var(--card);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 18px 40px -38px #000; }
  .stat { padding:14px 16px 13px; }
  .stat .label { color:var(--muted); font-size:12.5px; }
  .stat .value { display:flex; align-items:baseline; gap:7px; margin-top:9px; font-size:27px; font-weight:600; letter-spacing:-.03em; line-height:1; }
  .stat .value b { font-weight:600; }
  .stat .value span { color:var(--faint); font-size:12px; font-weight:500; letter-spacing:-.005em; }
  .stat .value span.amber { color:var(--amber); }
  .activity-grid { display:grid; grid-template-columns:minmax(0,1.72fr) minmax(0,1fr); gap:13px; margin-top:13px; }
  .chart-card { display:flex; min-height:418px; flex-direction:column; padding:15px 16px 0; }
  .card-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .card-head h2 { font-size:13.5px; font-weight:600; letter-spacing:-.01em; }
  .card-head span { color:var(--faint); font-size:11.5px; }
  #weeklyChart { width:100%; height:auto; margin-top:10px; }
  .chart-foot { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:auto;
    padding:14px 0 15px; border-top:1px solid var(--line-soft); }
  .chart-foot div { display:flex; flex-direction:column; gap:2px; }
  .chart-foot span { color:var(--faint); font-size:11.5px; }
  .chart-foot b { font-size:16px; font-weight:600; }
  .recent-card { padding:15px 14px 12px; }
  .recent-list { display:flex; flex-direction:column; gap:4px; margin-top:10px; }
  .recent-row { display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:9px; align-items:center;
    padding:7px 6px; border-radius:9px; }
  .recent-row:hover { background:rgba(255,255,255,.025); }
  .msg-avatar { display:grid; width:26px; height:26px; place-items:center; border-radius:999px;
    background:#2a3a5c; color:#cfe0ff; font-size:10.5px; font-weight:600; }
  .msg-body { min-width:0; }
  .msg-text { overflow:hidden; color:var(--text); font-size:12.5px; text-overflow:ellipsis; white-space:nowrap; }
  .msg-meta { color:var(--faint); font-size:11px; }
  .chip { padding:3px 8px; border-radius:6px; font-size:10.5px; font-weight:600; white-space:nowrap; }
  .chip-answered { background:var(--answered-bg); color:var(--answered); }
  .chip-routed { background:var(--routed-bg); color:var(--routed); }
  .chip-other { background:#24201d; color:var(--muted); }
  .empty { padding:18px 6px; color:var(--faint); font-size:12.5px; text-align:center; }

  /* ---------- guide ---------- */
  .guide-list { display:flex; flex-direction:column; gap:9px; }
  .guide-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.7fr) auto;
    gap:9px; align-items:start; padding:11px; border:1px solid var(--line); border-radius:12px; background:var(--card-2); }
  .guide-row input,.guide-row textarea { width:100%; padding:8px 10px; border:1px solid var(--line);
    border-radius:9px; background:rgba(11,9,8,.6); color:var(--text); font-size:12.5px; }
  .guide-row textarea { min-height:62px; resize:vertical; }
  .guide-row input::placeholder,.guide-row textarea::placeholder { color:var(--faint); }
  .guide-row input:disabled,.guide-row textarea:disabled { opacity:.62; cursor:not-allowed; }
  .guide-row .remove { width:30px; height:30px; padding:0; border:1px solid var(--line); border-radius:8px;
    background:transparent; color:var(--faint); font-size:15px; line-height:1; }
  .guide-row .remove:hover { border-color:rgba(255,91,46,.5); color:#ff8a70; }
  .field-label { display:block; margin-bottom:4px; color:var(--faint); font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
  .guide-actions { display:flex; gap:8px; flex-wrap:wrap; }
  .guide-save { display:flex; align-items:center; gap:12px; margin-top:14px; }
  .status { color:var(--muted); font-size:12.5px; }
  .primary { padding:8px 15px; border:1px solid var(--text); border-radius:10px; background:var(--text); color:var(--bg); font-size:12.5px; font-weight:600; }
  .primary:hover { background:#fff; }
  .primary:disabled { opacity:.55; cursor:default; }
  .ghost { padding:7px 12px; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--muted); font-size:12.5px; font-weight:500; }
  .ghost:hover { color:var(--text); background:rgba(255,255,255,.03); }

  /* ---------- questions & coverage ---------- */
  .table-card { padding:6px 6px; }
  .q-list { display:flex; flex-direction:column; }
  .q-row { display:grid; grid-template-columns:minmax(0,1fr) 130px 96px 62px; gap:12px; align-items:center;
    padding:11px 12px; border-bottom:1px solid var(--line-soft); }
  .q-row:last-child { border-bottom:0; }
  .q-row .q-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .q-row .q-theme { color:var(--muted); font-size:12px; }
  .q-row .q-time { color:var(--faint); font-size:11.5px; text-align:right; }
  .coverage-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:13px; margin-bottom:13px; }
  .coverage-summary .stat { padding:13px 15px; }
  .coverage-list { padding:8px 14px; }
  .coverage-row { display:grid; grid-template-columns:150px minmax(0,1fr) 112px; gap:14px; align-items:center;
    padding:10px 0; border-bottom:1px solid var(--line-soft); }
  .coverage-row:last-child { border-bottom:0; }
  .coverage-row .name { overflow:hidden; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
  .bar { height:6px; overflow:hidden; border-radius:999px; background:#241f1c; }
  .bar i { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#ff7a45,#ffb547); }
  .coverage-row .counts { color:var(--faint); font-size:11.5px; text-align:right; }

  /* ---------- login ---------- */
  .login-screen { display:grid; min-height:100vh; place-items:center; padding:24px 18px;
    background:
      radial-gradient(620px 340px at 82% -6%, rgba(255,122,69,.12), transparent 62%),
      radial-gradient(520px 320px at 6% 18%, rgba(255,181,71,.05), transparent 60%),
      var(--bg);
  }
  .login-panel { width:min(100%,380px); }
  .login-brand { display:flex; align-items:center; justify-content:center; gap:9px; margin-bottom:16px;
    font-size:15px; font-weight:600; letter-spacing:-.02em; }
  .login-card { padding:24px 22px; border:1px solid var(--line); border-radius:16px;
    background:linear-gradient(180deg,#181412,#121010);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 30px 60px -50px #000; }
  .login-card h1 { font-size:22px; font-weight:600; letter-spacing:-.03em; }
  .login-sub { margin:4px 0 18px; color:var(--muted); font-size:13px; }
  .login-card label { display:block; margin:13px 0 5px; color:var(--muted); font-size:12px; font-weight:500; }
  .login-card label:first-of-type { margin-top:0; }
  .login-card input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px;
    background:rgba(11,9,8,.7); color:var(--text); font-size:14px; }
  .login-card input::placeholder { color:var(--faint); }
  .login-card .primary { width:100%; margin-top:16px; padding:10px 14px; font-size:13.5px; }
  .login-status { min-height:1.25em; margin-top:9px; color:#ff9a80; font-size:12.5px; }
  .login-alt { margin-top:14px; text-align:center; color:var(--faint); font-size:12px; }
  .login-alt a { color:var(--amber); text-decoration:none; }
  .login-alt a:hover { text-decoration:underline; }
  .login-foot { margin-top:14px; text-align:center; color:var(--faint); font-size:11.5px; }
  .noscript { padding:24px; color:var(--text); }

  @media (max-width:960px) {
    .app { display:block; }
    .sidebar { position:static; height:auto; flex-direction:row; flex-wrap:wrap; align-items:center;
      gap:10px; padding:11px 14px; border-right:0; border-bottom:1px solid var(--line-soft); }
    .brand { padding:0 6px 0 0; }
    .nav { flex-direction:row; flex-wrap:wrap; gap:3px; }
    .nav-item { width:auto; padding:7px 10px; font-size:12.5px; }
    .nav-item svg { width:15px; height:15px; }
    .sections { display:none; }
    .who { margin-top:0; margin-left:auto; padding:0; border-top:0; }
    .who-text { display:none; }
    .sign-out { margin-left:0; }
    .topbar { position:static; padding:13px 16px; }
    .content { padding:15px 16px 36px; }
    .sample-banner { margin:12px 16px 0; }
    .stat-row,.coverage-summary { grid-template-columns:1fr; }
    .activity-grid { grid-template-columns:1fr; }
    .chart-card { min-height:0; }
    .guide-row { grid-template-columns:1fr 1fr; }
    .guide-row .guide-reply { grid-column:1 / -1; }
    .guide-row .remove { grid-column:2; grid-row:1; justify-self:end; margin-top:16px; }
    .q-row { grid-template-columns:minmax(0,1fr) 84px; }
    .q-row .q-theme { display:none; }
    .coverage-row { grid-template-columns:110px minmax(0,1fr); }
    .coverage-row .counts { grid-column:2; text-align:left; }
  }
</style>
</head>
<body>
<noscript><p class="noscript">The StayXI host portal needs JavaScript enabled.</p></noscript>

<div class="app hidden" id="app">
  <aside class="sidebar">
    <div class="brand">
      <span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#ff9a6b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16 12 6l6 10"></path><circle cx="12" cy="18.5" r="1.2" fill="#ffc46b" stroke="none"></circle></svg></span>
      <span>StayXI</span>
    </div>
    <nav class="nav" aria-label="Host portal">
      <button class="nav-item active" data-view="activity" aria-current="page">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h4l3-4h2l3 4h4v11H4z"></path><path d="M9 13h6"></path></svg>
        Activity <span class="nav-badge hidden" id="navBadge">0</span>
      </button>
      <button class="nav-item" data-view="guide">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"></path><path d="M8 4v16"></path></svg>
        Guide
      </button>
      <button class="nav-item" data-view="questions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z"></path><path d="M9 10h6"></path></svg>
        Questions
      </button>
      <button class="nav-item" data-view="coverage">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19V11"></path><path d="M12 19V5"></path><path d="M19 19v-6"></path></svg>
        Coverage
      </button>
    </nav>
    <div class="sections">
      <p class="nav-group">Guide sections</p>
      <ul class="section-list" id="sectionList"></ul>
    </div>
    <div class="who">
      <span class="avatar" id="hostAvatar">H</span>
      <div class="who-text"><strong id="hostName">Host</strong><span id="houseCode"></span></div>
      <button class="sign-out" id="signOut" title="Sign out" aria-label="Sign out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"></path><path d="M15 8l4 4-4 4"></path><path d="M9 12h10"></path></svg>
      </button>
    </div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div>
        <p class="property-name" id="propertyName">Your property</p>
        <h1 id="viewTitle">Activity</h1>
      </div>
      <div class="range" id="rangeBar" role="group" aria-label="Time range">
        <button type="button" data-range="today">Today</button>
        <button type="button" data-range="stay" class="on">This stay</button>
        <button type="button" data-range="all">All</button>
      </div>
    </header>

    <p class="sample-banner hidden" id="sampleBanner">Sample dashboard — these are generated figures, not your traffic. <a href="/host" style="color:inherit;text-decoration:underline">Sign in for the real one</a>.</p>

    <div class="content">
      <section class="view" id="viewActivity">
        <div class="stat-row">
          <section class="card stat">
            <p class="label" id="answeredLabel">Answered today</p>
            <p class="value"><b id="answeredValue">—</b><span>auto</span></p>
          </section>
          <section class="card stat">
            <p class="label">Routed to you</p>
            <p class="value"><b id="routedValue">—</b><span class="amber">needs you</span></p>
          </section>
          <section class="card stat">
            <p class="label">Median reply</p>
            <p class="value"><b id="medianValue">—</b><span id="medianNote">from guide</span></p>
          </section>
        </div>

        <div class="activity-grid">
          <section class="card chart-card">
            <div class="card-head">
              <h2>Questions this week</h2>
              <span>Last 7 days</span>
            </div>
            <svg id="weeklyChart" viewBox="0 0 720 330" role="img" aria-label="Guest questions per day, last seven days"></svg>
            <div class="chart-foot">
              <div><span>Answered by StayXI</span><b id="answeredPct">—</b></div>
              <div><span>Routed to you</span><b id="routedPct">—</b></div>
              <div><span>Guide sections used</span><b id="sectionsUsed">—</b></div>
            </div>
          </section>

          <section class="card recent-card">
            <div class="card-head">
              <h2>Recent messages</h2>
            </div>
            <ul class="recent-list" id="recentList"></ul>
            <p class="empty hidden" id="recentEmpty">No guest messages in this range yet.</p>
          </section>
        </div>
      </section>

      <section class="view hidden" id="viewGuide">
        <div class="view-head">
          <div>
            <h2>Questions and answers</h2>
            <p>What guests get instantly, before a question ever reaches you.</p>
          </div>
          <div class="guide-actions">
            <button class="ghost" type="button" id="prefillGuide">Pre-fill common questions</button>
            <button class="ghost" type="button" id="addAnswer">+ Add a section</button>
          </div>
        </div>
        <div class="guide-list" id="guideList"></div>
        <div class="guide-save">
          <button class="primary" type="button" id="saveGuide">Save guide</button>
          <span class="status" id="guideStatus"></span>
        </div>
      </section>

      <section class="view hidden" id="viewQuestions">
        <div class="view-head">
          <div>
            <h2>Questions</h2>
            <p>What guests asked, and whether the guide answered.</p>
          </div>
        </div>
        <div class="card table-card">
          <div class="q-list" id="questionsList"></div>
          <p class="empty hidden" id="questionsEmpty">No guest questions in this range yet.</p>
        </div>
      </section>

      <section class="view hidden" id="viewCoverage">
        <div class="view-head">
          <div>
            <h2>Coverage</h2>
            <p>How often the guide answers each kind of question.</p>
          </div>
        </div>
        <div class="coverage-summary">
          <section class="card stat">
            <p class="label">Answered by the guide</p>
            <p class="value"><b id="coverageShare">—</b></p>
          </section>
          <section class="card stat">
            <p class="label">Question types covered</p>
            <p class="value"><b id="coverageTypes">—</b></p>
          </section>
          <section class="card stat">
            <p class="label">Questions in range</p>
            <p class="value"><b id="coverageTotal">—</b></p>
          </section>
        </div>
        <div class="card coverage-list" id="coverageList"></div>
        <p class="empty hidden" id="coverageEmpty">No guest questions in this range yet.</p>
      </section>
    </div>
  </main>
</div>

<section class="login-screen" id="loginScreen">
  <div class="login-panel">
    <div class="login-brand">
      <span class="logo-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#ff9a6b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16 12 6l6 10"></path><circle cx="12" cy="18.5" r="1.2" fill="#ffc46b" stroke="none"></circle></svg></span>
      <span>StayXI host portal</span>
    </div>
    <form class="login-card" id="loginForm" novalidate>
      <h1>Sign in</h1>
      <p class="login-sub">See what guests asked, what the guide answered, and what needs you.</p>
      <label for="loginCode">House code</label>
      <input id="loginCode" name="houseCode" autocomplete="organization" autocapitalize="characters" spellcheck="false" placeholder="CEDAR" required>
      <label for="loginPasscode">Host passcode</label>
      <input id="loginPasscode" name="passcode" type="password" autocomplete="current-password" placeholder="••••••••" required>
      <button class="primary" type="submit" id="loginButton">Unlock dashboard</button>
      <p class="login-status" id="loginStatus" role="status" aria-live="polite"></p>
    </form>
    <p class="login-alt">Just looking? <a href="?sample=1">Open the sample dashboard</a></p>
    <p class="login-foot">Your passcode is set by StayXI. Ask us to reset it if you lose it.</p>
  </div>
</section>

<script>
(function () {
  'use strict';

  var state = { data: null, view: 'activity', range: 'today', sample: false, draft: [], dirty: false };
  var TITLES = { activity: 'Activity', guide: 'Guide', questions: 'Questions', coverage: 'Coverage' };
  var AVATAR_COLORS = [
    ['#2a3a5c', '#cfe0ff'], ['#3a2a1d', '#ffd0a8'], ['#3a1f33', '#ffc0e2'],
    ['#1f3a32', '#bff0d8'], ['#332e1a', '#f2e6b0'], ['#2d2440', '#d8caff']
  ];
  var COMMON_GUIDE_QUESTIONS = [
    { topic: 'Wi-Fi', keywords: ['wifi', 'wi-fi', 'wireless', 'internet', 'network'] },
    { topic: 'Check-in & arrival', keywords: ['check in', 'check-in', 'arrival', 'early check-in', 'late arrival'] },
    { topic: 'Check-out & departure', keywords: ['check out', 'check-out', 'checkout', 'departure', 'leave'] },
    { topic: 'Parking', keywords: ['parking', 'park', 'driveway', 'garage', 'street parking'] },
    { topic: 'Trash & recycling', keywords: ['trash', 'garbage', 'bins', 'recycling', 'trash pickup'] },
    { topic: 'Pool & hot tub', keywords: ['pool', 'hot tub', 'spa', 'pool heater', 'pool temperature'] },
    { topic: 'Pets', keywords: ['pet', 'pets', 'dog', 'cat', 'service animal'] },
    { topic: 'House rules & quiet hours', keywords: ['quiet hours', 'quiet time', 'noise', 'smoking', 'visitors'] },
    { topic: 'Thermostat & AC', keywords: ['thermostat', 'air conditioning', 'ac', 'heat', 'temperature'] },
    { topic: 'Appliances & TV', keywords: ['coffee maker', 'washer', 'dryer', 'dishwasher', 'tv', 'remote'] },
    { topic: 'Local recommendations', keywords: ['restaurant', 'restaurants', 'groceries', 'beach', 'attractions'] },
    { topic: 'Hurricane prep', keywords: ['hurricane', 'storm', 'shutters', 'storm prep'] }
  ];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function show(node, visible) { node.classList.toggle('hidden', !visible); }
  function setText(id, value) { var node = $(id); if (node) node.textContent = value; }

  async function api(path, options) {
    var init = options || {};
    var res = await fetch(path, {
      method: init.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: init.body
    });
    var data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok) {
      var error = new Error((data && data.error) || 'Request failed. Please try again.');
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function boot() {
    var params = new URLSearchParams(window.location.search);
    state.sample = params.get('sample') === '1';
    var range = params.get('range');
    if (range === 'today' || range === 'stay' || range === 'all') state.range = range;
    var view = params.get('view');
    if (view === 'activity' || view === 'guide' || view === 'questions' || view === 'coverage') state.view = view;
    bind();
    if (state.sample) show($('loginScreen'), false);
    load();
  }

  async function load() {
    var path = '/host/api/overview?range=' + encodeURIComponent(state.range) + (state.sample ? '&sample=1' : '');
    try {
      var data = await api(path);
      state.data = data;
      state.draft = data.guide.answers.map(function (answer) {
        return { topic: answer.topic, keywords: answer.keywords.slice(), reply: answer.reply };
      });
      state.dirty = false;
      setText('loginStatus', '');
      show($('loginScreen'), false);
      show($('app'), true);
      render();
    } catch (err) {
      if (err.status === 401) { showLogin(''); return; }
      showLogin(err.message || 'Could not load your dashboard.');
    }
  }

  function showLogin(message) {
    show($('app'), false);
    show($('loginScreen'), true);
    setText('loginStatus', message);
  }

  function render() {
    var data = state.data;
    if (!data) return;
    var name = data.property.name || data.property.id || 'Your property';
    setText('propertyName', name);
    setText('hostName', data.property.hostName || 'Host');
    setText('houseCode', data.property.id);
    setText('hostAvatar', (data.property.hostName || 'H').trim().charAt(0).toUpperCase() || 'H');
    show($('sampleBanner'), Boolean(data.sample));

    var routed = Number(data.stats.routed || 0);
    var badge = $('navBadge');
    badge.textContent = routed;
    show(badge, routed > 0);

    renderSections();
    renderActivity();
    renderQuestions();
    renderCoverage();
    renderGuide();
    switchView(state.view);

    Array.prototype.forEach.call(document.querySelectorAll('#rangeBar button'), function (button) {
      button.classList.toggle('on', button.dataset.range === state.range);
    });
  }

  function renderSections() {
    var list = $('sectionList');
    list.textContent = '';
    var sections = state.data.guide.sections;
    if (!sections.length) {
      list.appendChild(el('li', 'empty-section', 'No sections yet'));
      return;
    }
    sections.forEach(function (section) {
      var item = el('li');
      var button = el('button');
      button.type = 'button';
      var dot = el('span', 'section-dot');
      dot.style.background = section.color;
      button.appendChild(dot);
      button.appendChild(el('span', '', section.topic));
      button.addEventListener('click', function () { switchView('guide'); });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function renderActivity() {
    var data = state.data;
    var stats = data.stats;
    var labels = {
      today: 'Answered today',
      stay: 'Answered this stay',
      all: 'Answered · 30 days'
    };
    setText('answeredLabel', labels[data.range] || 'Answered');
    setText('answeredValue', stats.answered);
    setText('routedValue', stats.routed);
    setText('medianValue', stats.medianReplySeconds == null ? '—' : stats.medianReplySeconds + 's');
    setText('medianNote', stats.medianReplySeconds == null ? 'no timed replies' : 'from AI replies');
    setText('answeredPct', stats.answeredPct + '%');
    setText('routedPct', stats.routedPct + '%');
    setText('sectionsUsed', stats.sectionsUsed);
    drawChart();
    renderRecent();
  }

  function drawChart() {
    var svg = $('weeklyChart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var NS = 'http://www.w3.org/2000/svg';
    function add(tag, attrs) {
      var node = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      svg.appendChild(node);
      return node;
    }
    function pathFrom(points) {
      return points.map(function (point, index) {
        return (index ? 'L' : 'M') + point.x.toFixed(1) + ',' + point.y.toFixed(1);
      }).join('');
    }

    var series = state.data.daily || [];
    var max = 4;
    series.forEach(function (day) { if (day.inbound > max) max = day.inbound; });
    var W = 720, H = 330, left = 20, right = 16, top = 34, bottom = 282;
    var grid = [0.25, 0.5, 0.75];
    grid.forEach(function (share) {
      var y = bottom - (bottom - top) * share;
      add('line', { x1: left, x2: W - right, y1: y, y2: y, stroke: '#27211d', 'stroke-width': '1' });
    });

    var points = series.map(function (day, index) {
      var x = series.length < 2 ? left : left + index * ((W - left - right) / (series.length - 1));
      var y = bottom - (Number(day.inbound || 0) / max) * (bottom - top);
      return { x: x, y: y, value: Number(day.inbound || 0) };
    });
    if (!points.length) return;

    var defs = add('defs', {});
    var gradient = document.createElementNS(NS, 'linearGradient');
    gradient.setAttribute('id', 'chartFill');
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '0');
    gradient.setAttribute('y2', '1');
    var stopTop = document.createElementNS(NS, 'stop');
    stopTop.setAttribute('offset', '0');
    stopTop.setAttribute('stop-color', 'rgba(255,138,61,0.30)');
    var stopBottom = document.createElementNS(NS, 'stop');
    stopBottom.setAttribute('offset', '1');
    stopBottom.setAttribute('stop-color', 'rgba(255,138,61,0)');
    gradient.appendChild(stopTop);
    gradient.appendChild(stopBottom);
    defs.appendChild(gradient);

    var areaPoints = points.slice();
    areaPoints.push({ x: points[points.length - 1].x, y: bottom });
    areaPoints.push({ x: points[0].x, y: bottom });
    add('path', { d: pathFrom(areaPoints) + 'Z', fill: 'url(#chartFill)' });
    add('path', {
      d: pathFrom(points), fill: 'none', stroke: '#ff8a3d', 'stroke-width': '2.5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    points.forEach(function (point, index) {
      var last = index === points.length - 1;
      if (last) add('circle', { cx: point.x, cy: point.y, r: '7', fill: 'rgba(255,138,61,0.18)' });
      add('circle', { cx: point.x, cy: point.y, r: last ? '4.5' : '2.6', fill: '#ffb547' });
    });
    var lastPoint = points[points.length - 1];
    var label = document.createElementNS(NS, 'text');
    label.setAttribute('x', Math.min(lastPoint.x, W - 34));
    label.setAttribute('y', Math.max(lastPoint.y - 12, 16));
    label.setAttribute('fill', '#ffc46b');
    label.setAttribute('font-size', '12');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = String(lastPoint.value);
    svg.appendChild(label);
  }

  function statusChip(status) {
    if (status === 'answered') return el('span', 'chip chip-answered', 'Answered');
    if (status === 'routed') return el('span', 'chip chip-routed', 'Routed');
    return el('span', 'chip chip-other', 'No answer');
  }

  function renderRecent() {
    var list = $('recentList');
    list.textContent = '';
    var rows = state.data.recent || [];
    show($('recentEmpty'), rows.length === 0);
    rows.forEach(function (row, index) {
      var item = el('li', 'recent-row');
      var colors = AVATAR_COLORS[index % AVATAR_COLORS.length];
      var avatar = el('span', 'msg-avatar', (row.text || '?').trim().charAt(0).toUpperCase() || '?');
      avatar.style.background = colors[0];
      avatar.style.color = colors[1];
      var body = el('div', 'msg-body');
      body.appendChild(el('p', 'msg-text', row.text || 'Message received'));
      body.appendChild(el('p', 'msg-meta', row.ago || ''));
      item.appendChild(avatar);
      item.appendChild(body);
      item.appendChild(statusChip(row.status));
      list.appendChild(item);
    });
  }

  function renderQuestions() {
    var list = $('questionsList');
    list.textContent = '';
    var rows = state.data.questions || [];
    show($('questionsEmpty'), rows.length === 0);
    rows.forEach(function (row) {
      var item = el('div', 'q-row');
      item.appendChild(el('p', 'q-text', row.text || 'Message received'));
      item.appendChild(el('p', 'q-theme', row.label || 'Unclassified'));
      item.appendChild(statusChip(row.status));
      item.appendChild(el('p', 'q-time', row.ago || ''));
      list.appendChild(item);
    });
  }

  function renderCoverage() {
    var list = $('coverageList');
    list.textContent = '';
    var rows = state.data.coverage || [];
    var stats = state.data.stats;
    setText('coverageShare', stats.answeredPct + '%');
    setText('coverageTypes', rows.filter(function (row) { return row.answered > 0; }).length);
    setText('coverageTotal', stats.inbound);
    show($('coverageEmpty'), rows.length === 0);
    rows.forEach(function (row) {
      var item = el('div', 'coverage-row');
      item.appendChild(el('p', 'name', row.label));
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(0, Math.min(100, row.answeredPct)) + '%';
      bar.appendChild(fill);
      item.appendChild(bar);
      item.appendChild(el('p', 'counts', row.answered + ' of ' + row.total + ' answered'));
      list.appendChild(item);
    });
  }

  function renderGuide() {
    var list = $('guideList');
    list.textContent = '';
    var sample = Boolean(state.data && state.data.sample);
    Array.prototype.forEach.call(document.querySelectorAll('.guide-row'), function (row) { row.disabled = sample; });
    $('prefillGuide').disabled = sample;
    $('addAnswer').disabled = sample;
    $('saveGuide').disabled = sample;

    if (!state.draft.length) {
      list.appendChild(el('p', 'empty', 'No questions yet. Add a section or pre-fill common questions above.'));
      return;
    }
    state.draft.forEach(function (answer, index) {
      var row = el('div', 'guide-row');
      row.dataset.index = String(index);

      var topicWrap = el('label');
      topicWrap.appendChild(el('span', 'field-label', 'Question / topic'));
      var topic = document.createElement('input');
      topic.value = answer.topic || '';
      topic.placeholder = 'Check-in & arrival';
      topic.setAttribute('aria-label', 'Section name');
      topic.disabled = sample;
      topic.addEventListener('input', function () { answer.topic = topic.value; markDirty(); });
      topicWrap.appendChild(topic);
      row.appendChild(topicWrap);

      var keywordWrap = el('label');
      keywordWrap.appendChild(el('span', 'field-label', 'Keywords'));
      var keywords = document.createElement('input');
      keywords.value = (answer.keywords || []).join(', ');
      keywords.placeholder = 'wifi, internet, network';
      keywords.setAttribute('aria-label', 'Keywords, separated by commas');
      keywords.disabled = sample;
      keywords.addEventListener('input', function () {
        answer.keywords = keywords.value.split(',').map(function (word) { return word.trim(); }).filter(Boolean);
        markDirty();
      });
      keywordWrap.appendChild(keywords);
      row.appendChild(keywordWrap);

      var replyWrap = el('label', 'guide-reply');
      replyWrap.appendChild(el('span', 'field-label', 'Reply'));
      var reply = document.createElement('textarea');
      reply.value = answer.reply || '';
      reply.placeholder = 'What the guest should be told.';
      reply.setAttribute('aria-label', 'Reply');
      reply.disabled = sample;
      reply.addEventListener('input', function () { answer.reply = reply.value; markDirty(); });
      replyWrap.appendChild(reply);
      row.appendChild(replyWrap);

      var remove = el('button', 'remove', '×');
      remove.type = 'button';
      remove.title = 'Remove this section';
      remove.setAttribute('aria-label', 'Remove ' + (answer.topic || 'section'));
      remove.disabled = sample;
      remove.addEventListener('click', function () {
        state.draft.splice(index, 1);
        state.dirty = true;
        renderGuide();
        setText('guideStatus', 'Unsaved changes');
      });
      row.appendChild(remove);

      list.appendChild(row);
    });
  }

  function markDirty() {
    state.dirty = true;
    setText('guideStatus', 'Unsaved changes');
  }

  function prefillGuide() {
    if (!state.data || state.data.sample) return;
    var existing = {};
    state.draft.forEach(function (answer) {
      (answer.keywords || []).forEach(function (keyword) {
        existing[String(keyword).trim().toLowerCase()] = true;
      });
    });
    var added = 0;
    COMMON_GUIDE_QUESTIONS.forEach(function (question) {
      var already = question.keywords.some(function (keyword) { return existing[keyword]; });
      if (already) return;
      state.draft.push({ topic: question.topic, keywords: question.keywords.slice(), reply: '' });
      question.keywords.forEach(function (keyword) { existing[keyword] = true; });
      added += 1;
    });
    if (!added) {
      setText('guideStatus', 'All common questions are already in the guide.');
      return;
    }
    state.dirty = true;
    renderGuide();
    setText('guideStatus', added + ' common question' + (added === 1 ? '' : 's') + ' added. Add a reply to each, then save.');
    var rows = document.querySelectorAll('.guide-row');
    var firstNew = rows[rows.length - added];
    var reply = firstNew && firstNew.querySelector('textarea');
    if (reply) {
      reply.focus();
      reply.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function saveGuide() {
    if (!state.data || state.data.sample) return;
    var incomplete = -1;
    state.draft.some(function (answer, index) {
      var hasQuestion = String(answer.topic || '').trim() !== '' || (answer.keywords || []).length > 0;
      if (hasQuestion && !String(answer.reply || '').trim()) {
        incomplete = index;
        return true;
      }
      return false;
    });
    if (incomplete >= 0) {
      var unanswered = state.draft[incomplete];
      setText('guideStatus', 'Add a reply for "' + (unanswered.topic || unanswered.keywords[0]) + '" before saving.');
      var rows = document.querySelectorAll('.guide-row');
      var reply = rows[incomplete] && rows[incomplete].querySelector('textarea');
      if (reply) {
        reply.focus();
        reply.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    var button = $('saveGuide');
    button.disabled = true;
    setText('guideStatus', 'Saving…');
    try {
      await api('/host/api/guide', { method: 'PUT', body: JSON.stringify({ answers: state.draft }) });
      await load();
      setText('guideStatus', 'Saved. Guests get the new answers on their next message.');
      state.dirty = false;
    } catch (err) {
      setText('guideStatus', err.message || 'Could not save the guide.');
    } finally {
      button.disabled = false;
    }
  }

  function switchView(view) {
    if (!TITLES[view]) view = 'activity';
    state.view = view;
    ['activity', 'guide', 'questions', 'coverage'].forEach(function (name) {
      show($('view' + name.charAt(0).toUpperCase() + name.slice(1)), name === view);
    });
    setText('viewTitle', TITLES[view]);
    show($('rangeBar'), view === 'activity');
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-view]'), function (button) {
      var active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item[data-view]'), function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#rangeBar button'), function (button) {
      button.addEventListener('click', function () {
        if (state.range === button.dataset.range) return;
        state.range = button.dataset.range;
        load();
      });
    });
    $('prefillGuide').addEventListener('click', prefillGuide);
    $('addAnswer').addEventListener('click', function () {
      if (!state.data || state.data.sample) return;
      state.draft.push({ topic: '', keywords: [], reply: '' });
      state.dirty = true;
      renderGuide();
      setText('guideStatus', 'Unsaved changes');
      var rows = document.querySelectorAll('.guide-row');
      if (rows.length) {
        var input = rows[rows.length - 1].querySelector('input');
        if (input) input.focus();
      }
    });
    $('saveGuide').addEventListener('click', saveGuide);
    $('signOut').addEventListener('click', async function () {
      try { await api('/host/api/logout', { method: 'POST' }); } catch (err) { /* cookie is cleared on reload anyway */ }
      window.location.href = '/host';
    });
    $('loginForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      var code = $('loginCode').value.trim().toUpperCase();
      var passcode = $('loginPasscode').value;
      setText('loginStatus', '');
      if (!code || !passcode) {
        setText('loginStatus', 'Enter your house code and passcode.');
        return;
      }
      var button = $('loginButton');
      button.disabled = true;
      try {
        await api('/host/api/login', {
          method: 'POST',
          body: JSON.stringify({ houseCode: code, passcode: passcode })
        });
        state.sample = false;
        history.replaceState(null, '', '/host');
        $('loginPasscode').value = '';
        await load();
      } catch (err) {
        setText('loginStatus', err.message || 'Could not sign in.');
      } finally {
        button.disabled = false;
      }
    });
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty || !state.data || state.data.sample) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  boot();
})();
</script>
</body>
</html>`;
