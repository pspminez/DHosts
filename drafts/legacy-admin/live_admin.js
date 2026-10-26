
let password = "";
let properties = [];
let current = null;
let leads = [];
let detailIndex = -1;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inject PRICING_SERVICES at build time so the browser JS has it.
const PRICING_SERVICES = [{"key":"weather","keywords":["weather","storm","hurricane","forecast","rain","temperature","alerts","wind"],"name":"Live Weather & Alerts","price":"$15/mo"},{"key":"events","keywords":["events","dining","restaurant","reservations","things to do","attraction","tickets","shows","concerts"],"name":"Local Events & Dining","price":"$20/mo"},{"key":"grocery","keywords":["grocery","groceries","essentials","stock","fridge","delivery","supplies","beach gear"],"name":"Grocery & Essentials Delivery","price":"$25/mo"},{"key":"concierge","keywords":["concierge","24/7","host backup","maintenance","personal assistant"],"name":"Full Concierge","price":"$49/mo"}];
const ADDONS = PRICING_SERVICES.map((s) => [s.key, s.name]);

const $ = (id) => document.getElementById(id);

function setButtonState(isDirty) {
  const saveButton = $("saveButton");
  if (isDirty) {
    saveButton.textContent = "Save & go live";
    saveButton.classList.remove("live");
  } else {
    saveButton.textContent = "LIVE!";
    saveButton.classList.add("live");
  }
}

function markDirty() {
  setButtonState(true);
  $("saveStatus").textContent = "";
}

// Any typing or change anywhere in the dashboard marks it dirty (rows included)
document.body.addEventListener("input", markDirty);
document.body.addEventListener("change", markDirty);

function parseKeywords(str) {
  return str.split(",").map((k) => k.trim()).filter((k) => k.length);
}

function removeButton(row) {
  const rm = document.createElement("button");
  rm.className = "remove";
  rm.type = "button";
  rm.title = "Remove";
  rm.textContent = "×";
  rm.onclick = () => { row.remove(); markDirty(); };
  return rm;
}

function addSecret(keywords, reply) {
  const row = document.createElement("div");
  row.className = "entry";
  const top = document.createElement("div");
  top.className = "top";
  const kw = document.createElement("input");
  kw.className = "kw";
  kw.placeholder = "Trigger words — gate, gate code";
  kw.value = keywords || "";
  const rp = document.createElement("input");
  rp.className = "rp";
  rp.placeholder = "Reply — Gate code is 4321, then press #";
  rp.value = reply || "";
  top.append(kw, rp, removeButton(row));
  row.append(top);
  $("secretsList").append(row);
}

function addAnswer(topic, keywords, reply) {
  const row = document.createElement("div");
  row.className = "entry";
  const top = document.createElement("div");
  top.className = "top";
  const tp = document.createElement("input");
  tp.className = "tp";
  tp.placeholder = "Topic — Trash day";
  tp.value = topic || "";
  const kw = document.createElement("input");
  kw.className = "kw";
  kw.placeholder = "Keywords, comma separated — trash, garbage, bins";
  kw.value = keywords || "";
  top.append(tp, kw, removeButton(row));
  const rp = document.createElement("textarea");
  rp.className = "rp";
  rp.placeholder = "Reply sent to the guest…";
  rp.value = reply || "";
  row.append(top, rp);
  $("answersList").append(row);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "x-admin-password": password, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function unlock() {
  password = $("pw").value;
  try {
    await api("/admin/api/properties");
    // Persist auth cookie so subsequent visits skip the login form
    document.cookie = "admin_auth=" + btoa(password) + "; Path=/; Max-Age=259200";
    $("login").classList.add("hidden");
    $("tabBar").classList.remove("hidden");
    showList();
  } catch (err) {
    $("loginStatus").textContent = err.message;
  }
}

function pillFor(p) {
  if (!p.active) return ["Paused", "paused"];
  if (!p.answerCount) return ["Awaiting setup", "pending"];
  return ["Live", "live"];
}

function escLabel(n) {
  return n + " open escalation" + (n === 1 ? "" : "s");
}

async function showList() {
  $("propView").classList.add("hidden");
  $("listView").classList.remove("hidden");
  hideAdd();
  try {
    const data = await api("/admin/api/properties");
    properties = data.properties || [];
    renderList();
  } catch (err) {
    $("listStatus").textContent = err.message;
  }
}

function renderList() {
  const list = $("propList");
  list.textContent = "";
  $("listStatus").textContent = properties.length ? "" : "No properties yet. Create your first one.";
  properties.forEach((p) => {
    const card = document.createElement("div");
    card.className = "propcard";
    card.onclick = () => openProperty(p.id);

    const head = document.createElement("div");
    head.className = "pc-head";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = p.name || p.id;
    head.append(name);
    const pill = document.createElement("span");
    const status = pillFor(p);
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    head.append(pill);
    if (p.openEscalations > 0) {
      const esc = document.createElement("span");
      esc.className = "pill open-esc";
      esc.textContent = escLabel(p.openEscalations);
      head.append(esc);
    }
    card.append(head);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = p.id + (p.twilioNumber ? " · " + p.twilioNumber : "");
    card.append(meta);

    const statline = document.createElement("div");
    statline.className = "statline";
    statline.textContent = p.asked + " questions · " + p.escalated + " escalated · " +
      p.answerCount + " answers saved · " +
      (p.lastActivity ? "last activity " + p.lastActivity.slice(0, 10) : "no activity yet");
    card.append(statline);

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.title = "Delete property";
    del.textContent = "×";
    del.onclick = (e) => {
      e.stopPropagation();
      deleteProperty(p.id, p.name || p.id);
    };
    card.append(del);

    list.append(card);
  });
}

function showAdd() {
  $("addForm").classList.remove("hidden");
  $("addStatus").textContent = "";
  $("newId").focus();
}

function hideAdd() {
  $("addForm").classList.add("hidden");
}

async function createProperty() {
  try {
    const data = await api("/admin/api/property", {
      method: "POST",
      body: JSON.stringify({
        id: $("newId").value,
        name: $("newName").value,
        twilioNumber: $("newNumber").value,
        hostPhone: $("newHostPhone").value,
      }),
    });
    showList();
    openProperty(data.id);
  } catch (err) {
    $("addStatus").textContent = err.message;
  }
}

async function deleteProperty(id, name) {
  if (!confirm("Delete " + name + "? Messages and escalation history go with it.")) return;
  try {
    await api("/admin/api/property?id=" + encodeURIComponent(id), { method: "DELETE" });
    showList();
  } catch (err) {
    alert(err.message);
  }
}

async function openProperty(id) {
  try {
    current = await api("/admin/api/property?id=" + encodeURIComponent(id));

    $("propName").textContent = current.name || current.id;
    const status = pillFor(current);
    const pill = $("propPill");
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    const esc = $("propEsc");
    if (current.openEscalations > 0) {
      esc.className = "pill open-esc";
      esc.textContent = escLabel(current.openEscalations);
    } else {
      esc.className = "pill hidden";
      esc.textContent = "";
    }

    const stats = $("propStats");
    stats.textContent = "";
    const items = [
      [current.asked || 0, "questions asked"],
      [current.escalated || 0, "escalated"],
      [current.answerCount || 0, "answers saved"],
      [(current.addons || []).length, "add-ons on"],
    ];
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "stat";
      const b = document.createElement("b");
      b.textContent = item[0];
      el.append(b, item[1]);
      stats.append(el);
    });
    if (current.lastActivity) {
      const el = document.createElement("div");
      el.className = "stat";
      el.textContent = "last activity " + current.lastActivity.slice(0, 10);
      stats.append(el);
    }

    $("active").checked = current.active != 0;
    $("name").value = current.name || "";
    $("twilioNumber").value = current.twilioNumber || "";
    $("hostPhone").value = current.hostPhone || "";
    $("rateLimitReply").value = current.rateLimitReply || "";
    $("unknownReply").value = current.unknownReply || "";

    renderAddons();
    $("secretsList").textContent = "";
    (current.secrets || []).forEach((s) => addSecret((s.keywords || []).join(", "), s.reply || ""));
    if (!(current.secrets || []).length) addSecret();

    $("answersList").textContent = "";
    (current.answers || []).forEach((a) => addAnswer(a.topic || "", (a.keywords || []).join(", "), a.reply || ""));
    if (!(current.answers || []).length) addAnswer();

    $("listView").classList.add("hidden");
    $("propView").classList.remove("hidden");
    $("saveStatus").textContent = "";
    setButtonState(false);
  } catch (err) {
    alert(err.message);
  }
}

function renderAddons() {
  const box = $("addonChips");
  box.textContent = "";
  const on = current.addons || [];
  PRICING_SERVICES.forEach((s) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (on.indexOf(s.key) >= 0 ? " on" : "");
    chip.textContent = s.name + " - " + s.price;
    chip.dataset.key = s.key;
    chip.onclick = () => {
      chip.classList.toggle("on");
      markDirty();
    };
    box.append(chip);
  });
}

function collect(selector, mapRow) {
  return Array.from(document.querySelectorAll(selector)).map(mapRow)
    .filter((r) => r.keywords.length && r.reply);
}

async function save() {
  if (!current || !current.id) return;
  const secrets = collect("#secretsList .entry", (row) => ({
    keywords: parseKeywords(row.querySelector(".kw").value),
    reply: row.querySelector(".rp").value.trim(),
  }));
  const answers = collect("#answersList .entry", (row) => ({
    topic: row.querySelector(".tp").value.trim(),
    keywords: parseKeywords(row.querySelector(".kw").value),
    reply: row.querySelector(".rp").value.trim(),
  }));
  const addons = Array.from(document.querySelectorAll("#addonChips .chip.on"))
    .map((c) => c.dataset.key);
  try {
    await api("/admin/api/property?id=" + encodeURIComponent(current.id), {
      method: "PUT",
      body: JSON.stringify({
        name: $("name").value,
        twilioNumber: $("twilioNumber").value,
        hostPhone: $("hostPhone").value,
        rateLimitReply: $("rateLimitReply").value,
        unknownReply: $("unknownReply").value,
        active: $("active").checked ? 1 : 0,
        secrets,
        answers,
        addons,
      }),
    });
    current.active = $("active").checked ? 1 : 0;
    const status = pillFor({ active: current.active, answerCount: answers.length });
    const pill = $("propPill");
    pill.className = "pill " + status[1];
    pill.textContent = status[0];
    $("saveStatus").textContent = "Saved. Live now.";
    setButtonState(false);
  } catch (err) {
    $("saveStatus").textContent = err.message;
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab-bar .tab').forEach((t) => {
    t.classList.toggle('active', t.textContent.trim() === (tab === 'properties' ? 'Property manager' : tab === 'leads' ? 'Leads' : 'Analytics'));
  });
  // Only one view is visible at a time
  $('listView').classList.toggle('hidden', tab !== 'properties');
  $('leadsView').classList.toggle('hidden', tab !== 'leads');
  $('analyticsView').classList.toggle('hidden', tab !== 'analytics');
  $('leadDetailView').classList.add('hidden');
  $('propView').classList.add('hidden');

  if (tab === 'leads') {
    document.querySelectorAll('.sub').forEach((s) => s.classList.add('hidden'));
    $('pageTitle').classList.add('hidden');
  } else if (tab === 'analytics') {
    document.querySelectorAll('.sub').forEach((s) => s.classList.add('hidden'));
    $('pageTitle').classList.add('hidden');
  } else {
    document.querySelectorAll('.sub').forEach((s) => s.classList.remove('hidden'));
    $('pageTitle').classList.remove('hidden');
  }
  if (tab === 'properties') showList();
  else if (tab === 'leads') loadLeads();
  else loadAnalytics();
}

async function loadLeads() {
  try {
    leads = (await api('/admin/api/leads')).leads || [];
    renderLeads();
  } catch (err) {
    $('leadsStatus').textContent = err.message;
  }
}

function renderLeads() {
  const list = $('leadList');
  list.textContent = '';
  const q = ($('leadSearch').value || '').toLowerCase();
  let n = 0;
  leads.forEach((l, i) => {
    const key = (l.name + ' ' + (l.location || '') + ' ' + (l.email || '')).toLowerCase();
    if (q && !key.includes(q)) return;
    n++;
    const row = document.createElement('div');
    row.className = 'lead-row';
    row.onclick = () => openLeadDetail(i);

    const name = document.createElement('span');
    name.className = 'lead-name';
    name.textContent = esc(l.name);
    name.onclick = () => openLeadDetail(i);

    const city = document.createElement('span');
    city.className = 'lead-city';
    city.textContent = esc(l.location);

    const phone = document.createElement('span');
    phone.className = 'lead-phone';
    phone.textContent = esc(l.phone || '-');

    const email = document.createElement('span');
    email.className = 'lead-email';
    email.textContent = esc(l.email || '-');

    row.append(name, city, phone, email, statusSelectCell(i, l.leadStatus));
    list.appendChild(row);
  });
  if (!n) {
    const p = document.createElement('p');
    p.className = 'status';
    p.textContent = q ? 'No leads match that search.' : 'No leads yet.';
    list.appendChild(p);
  }
}

function statusSelectCell(i, cur) {
  const statuses = ['new', 'contacted', 'interested', 'closed'];
  const sel = document.createElement('select');
  sel.className = 'status-select';
  sel.onchange = (e) => {
    e.stopPropagation();
    toggleLeadStatus(i, e.target.value);
  };
  const def = document.createElement('option');
  def.textContent = cur ? cur.charAt(0).toUpperCase() + cur.slice(1) : 'status';
  def.disabled = true;
  if (!cur) def.selected = true;
  sel.appendChild(def);
  statuses.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    if (s === cur) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}

function openLeadDetail(i) {
  detailIndex = i;
  const l = leads[i];
  const d = $('leadDetailContent');
  d.textContent = '';

  const card1 = document.createElement('div');
  card1.className = 'card';
  const head = document.createElement('div');
  head.className = 'prop-head';
  const h2 = document.createElement('h2');
  h2.textContent = esc(l.name);
  head.append(h2);
  const pill = document.createElement('span');
  pill.className = 'pill' + (l.leadStatus === 'new' ? ' live' : '');
  pill.textContent = l.leadStatus;
  head.append(pill);
  card1.append(head);

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.append(makeStat(esc(l.location) + ' · ' + esc(l.propertyType)));
  stats.append(makeStat(esc(l.phone || '-')));
  stats.append(makeStat(esc(l.email || '-')));
  stats.append(makeStat(esc(l.address || '-')));
  card1.append(stats);
  d.append(card1);

  const card2 = document.createElement('div');
  card2.className = 'card lead-detail';
  card2.append(makeHeading('Lead status'));
  card2.append(makeHint('Local only — tracks your outreach progress for this lead.'));
  card2.append(statusSelectCell(i, l.leadStatus));
  d.append(card2);

  const card3 = document.createElement('div');
  card3.className = 'card lead-detail';
  card3.append(makeHeading('📧 Custom pitch email'));
  card3.append(makeHint('Subject: ' + esc(l.pitchEmail.subject)));
  const area1 = document.createElement('textarea');
  area1.readOnly = true;
  area1.textContent = esc(l.pitchEmail.body);
  card3.append(area1);
  d.append(card3);

  const card4 = document.createElement('div');
  card4.className = 'card lead-detail';
  card4.append(makeHeading('📞 Custom pitch phone'));
  card4.append(makeHint('Say this in a 30–45 second intro call'));
  const area2 = document.createElement('textarea');
  area2.readOnly = true;
  area2.textContent = esc(l.pitchPhone);
  card4.append(area2);
  d.append(card4);

  const card5 = document.createElement('div');
  card5.className = 'card lead-detail';
  card5.append(makeHeading('🔁 Follow-up email'));
  card5.append(makeHint('Subject: ' + esc(l.followUpEmail.subject)));
  const area3 = document.createElement('textarea');
  area3.readOnly = true;
  area3.textContent = esc(l.followUpEmail.body);
  card5.append(area3);
  d.append(card5);

  $('listView').classList.add('hidden');
  $('leadsView').classList.add('hidden');
  $('leadDetailView').classList.remove('hidden');
}

function makeStat(text) {
  const el = document.createElement('div');
  el.className = 'stat';
  const b = document.createElement('b');
  b.textContent = text;
  el.append(b);
  return el;
}

function makeHeading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function makeHint(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

function closeLeadDetail() {
  detailIndex = -1;
  $('leadDetailView').classList.add('hidden');
  showTab('leads');
}

async function loadAnalytics() {
  try {
    const data = await api('/admin/api/analytics');
    renderAnalytics(data);
  } catch (err) {
    $('activityList').textContent = '';
    $('noAnalytics').textContent = 'Failed to load analytics: ' + err.message;
    $('noAnalytics').style.display = 'block';
  }
}

function renderAnalytics(data) {
  const s = data.statistics || {};
  $('propCount').textContent = s.properties ?? 0;
  $('hostCount').textContent = s.hosts ?? 0;
  $('msgCount').textContent = s.messages ?? 0;
  $('escCount').textContent = data.statistics?.escalations ?? 0;

  const ai = data.resolution?.ai ?? 0;
  const human = data.resolution?.human ?? 0;
  const total = data.resolution?.total ?? 0;
  const pct = total > 0 ? Math.round(ai / total * 100) : 0;
  const resBar = document.querySelector('.res-bar');
  resBar.innerHTML = '';
  const aiFill = document.createElement('div');
  aiFill.className = 'res-fill ai';
  aiFill.style.width = pct + '%';
  const aiSpan = document.createElement('span');
  aiSpan.textContent = 'AI: ' + pct + '%';
  aiFill.appendChild(aiSpan);
  resBar.appendChild(aiFill);
  const humanFill = document.createElement('div');
  humanFill.className = 'res-fill human';
  humanFill.style.width = (100 - pct) + '%';
  const humanSpan = document.createElement('span');
  humanSpan.textContent = 'Human: ' + (100 - pct) + '%';
  humanFill.appendChild(humanSpan);
  resBar.appendChild(humanFill);

  const list = $('activityList');
  list.textContent = '';
  const recent = data.recent || {};
  const items = [];
  (recent.leads || []).forEach((l) => items.push({
    h: 'New lead',
    p: (l.email || '—') + ' · ' + new Date(l.created_at).toLocaleString(),
    time: l.created_at,
    tag: 'lead'
  }));
  (recent.questions || []).forEach((q) => items.push({
    h: 'Guest question',
    p: (q.from_number || 'Unknown') + ' · ' + (q.body || '').slice(0, 120),
    time: q.created_at,
    tag: 'message'
  }));
  (recent.escalations || []).forEach((e) => items.push({
    h: 'Escalation',
    p: (e.guest_number || 'Unknown') + ' · ' + (e.reason || 'no reason'),
    time: e.created_at,
    tag: 'escalation'
  }));
  items.sort((a, b) => new Date(b.time) - new Date(a.time));
  items.slice(0, 20).forEach((item) => {
    const el = document.createElement('div');
    el.className = 'activity-item';
    const h = document.createElement('h4');
    h.textContent = item.h;
    const p = document.createElement('p');
    p.textContent = item.p;
    const t = document.createElement('div');
    t.className = 'time';
    t.textContent = new Date(item.time).toLocaleString();
    el.append(h, p, t);
    list.appendChild(el);
  });
  if (!items.length) {
    $('noAnalytics').style.display = 'block';
    $('noAnalytics').textContent = 'No activity recorded yet.';
  } else {
    $('noAnalytics').style.display = 'none';
  }
}

function toggleLeadStatus(i, status) {
  leads[i].leadStatus = status;
  renderLeadDetail();
}

function renderLeadDetail() {
  if (detailIndex < 0) return;
  openLeadDetail(detailIndex);
}

function exportLeads() {
  const escField = (v) => {
    const s = String(v ?? '').replace(/"/g, '""');
    return /[,\n"]/.test(s) ? '"' + s + '"' : s;
  };
  const rows = [['name', 'phone', 'email', 'location', 'propertyType', 'status', 'pitchEmailSubject', 'pitchEmailBody', 'pitchPhone', 'followUpEmailSubject', 'followUpEmailBody']];
  leads.forEach((l) => {
    rows.push([
      escField(l.name), escField(l.phone), escField(l.email), escField(l.location), escField(l.propertyType),
      escField(l.leadStatus), escField(l.pitchEmail.subject), escField(l.pitchEmail.body), escField(l.pitchPhone),
      escField(l.followUpEmail.subject), escField(l.followUpEmail.body),
    ]);
  });
  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leads.csv';
  a.click();
  URL.revokeObjectURL(url);
}

$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });
