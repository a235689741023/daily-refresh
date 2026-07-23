(function(){
"use strict";
const $ = s => document.querySelector(s);
const el = (t,c,x) => { const n=document.createElement(t); if(c)n.className=c; if(x!=null)n.textContent=x; return n; };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- date ---------- */
const now = new Date();
const tpe = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
const wd = "日一二三四五六"[tpe.getDay()];
const pad = n => String(n).padStart(2, "0");
$("#stamp").textContent =
  `${tpe.getFullYear()} . ${pad(tpe.getMonth()+1)} . ${pad(tpe.getDate())} 　星期${wd}`;

/* ---------- data loading ---------- */
/* 資料由 GitHub Actions 每日抓取後寫入 data/*.json。
   離線時 service worker 會回傳上次快取的版本，所以打開永遠有東西看。 */
const CREST = { esg:"var(--crest-esg)", geo:"var(--crest-geo)", us:"var(--crest-us)", tw:"var(--crest-tw)" };

async function loadJSON(name){
  const res = await fetch(`data/${name}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

function skeleton(box, n = 3){
  box.innerHTML = "";
  for (let i = 0; i < n; i++) box.appendChild(el("div", "skel"));
}

function failure(box, label, err){
  box.innerHTML = "";
  const d = el("div", "load-err");
  d.appendChild(el("b", null, `${label}讀取失敗`));
  d.appendChild(document.createTextNode(
    `${err.message}。可能是還沒跑過第一次抓取，或目前離線。稍後重新整理即可。`));
  box.appendChild(d);
}

/* 一則新聞卡 */
function newsCard(n, crest){
  const card = el("div","card");
  const a = el("a","item");
  a.href = n.url; a.target = "_blank"; a.rel = "noopener noreferrer";

  const h = el("h3","item-t"); h.textContent = n.title;
  h.insertAdjacentHTML("beforeend",
    ' <svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16 8M9.5 8H16v6.5"/></svg>');
  a.appendChild(h);

  if (n.summary) a.appendChild(el("p","item-d", n.summary));
  if (n.why){
    const w = el("span","why"); w.textContent = n.why; a.appendChild(w);
  }

  const f = el("div","item-f");
  if (n.tag){ const t = el("span","tag", n.tag); t.style.background = crest; f.appendChild(t); }
  f.appendChild(el("span","src", n.source));
  if (n.ago) f.appendChild(el("span","ago", n.ago));
  f.appendChild(el("span","read","閱讀全文"));
  a.appendChild(f);

  card.appendChild(a);
  return card;
}

/* 今日重點摘要（有設定 Claude API 才會出現） */
function digestBlock(data){
  if (!data.digest) return null;
  const d = el("div","digest");
  d.appendChild(el("h4",null,"今日重點摘要"));
  d.appendChild(el("p",null,data.digest));
  if (data.watch?.length){
    const ul = el("ul");
    data.watch.forEach(w => ul.appendChild(el("li",null,w)));
    d.appendChild(ul);
  }
  return d;
}

function staleNote(updated){
  if (!updated) return null;
  const hours = (Date.now() - new Date(updated).getTime()) / 3600000;
  if (hours < 36) return null;
  return el("p","stale",`⚠ 這份資料已 ${Math.round(hours/24)} 天沒有更新`);
}

/** 渲染一個新聞領域。geo 會再依 group 拆成空間資訊／人工智慧兩欄。 */
async function renderDomain(key, targets){
  Object.values(targets).forEach(sel => skeleton($(sel)));
  try {
    const data = await loadJSON(key);
    const crest = CREST[key];
    const groups = Object.entries(targets);

    groups.forEach(([group, sel], i) => {
      const box = $(sel);
      box.innerHTML = "";
      if (i === 0){
        const dg = digestBlock(data);
        if (dg) box.appendChild(dg);
      }
      const items = group === "*" ? data.items : data.items.filter(it => it.group === group);
      if (!items.length){
        box.appendChild(el("div","load-err","今天這個分類沒有新的內容。"));
        return;
      }
      items.forEach(n => box.appendChild(newsCard(n, crest)));
      if (i === groups.length - 1){
        const s = staleNote(data.updated);
        if (s) box.appendChild(s);
      }
    });
    return data;
  } catch (err) {
    Object.values(targets).forEach(sel => failure($(sel), key.toUpperCase(), err));
    return null;
  }
}

/* ---------- markets ---------- */
const fmt = (v, d = 2) =>
  Number.isFinite(v) ? v.toLocaleString("en-US",{minimumFractionDigits:d, maximumFractionDigits:d}) : "—";
const signed = (v, d = 2) =>
  Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d})}` : "—";

function spark(data, color){
  if (!data?.length) return "";
  const w=100,h=26,mn=Math.min(...data),mx=Math.max(...data),r=(mx-mn)||1;
  const pts = data.map((v,i)=>[i/Math.max(1,data.length-1)*w, h-2-((v-mn)/r)*(h-5)]);
  const line = pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const last = pts[pts.length-1];
  return `<svg class="mkt-s" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,${h} ${line} ${w},${h}" fill="${color}" opacity=".13"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2" fill="${color}"/></svg>`;
}

/** 一張行情卡。up/down 的色票由呼叫端給，因為美股綠漲、台股紅漲。 */
function mktCard(q, upVar, downVar, decimals = 2){
  if (!q || q.error){
    return `<div class="mkt-c"><div class="mkt-n">${q?.name ?? "—"}</div>
      <div class="mkt-v" style="color:var(--text-faint)">—</div>
      <div class="mkt-p" style="color:var(--text-faint)">暫時取不到</div></div>`;
  }
  const c = q.changePct >= 0 ? upVar : downVar;
  return `<div class="mkt-c"><div class="mkt-n">${q.name}</div>
    <div class="mkt-v" style="color:${c}">${fmt(q.value, decimals)}</div>
    <div class="mkt-p" style="color:${c}">${signed(q.change, decimals)}　${signed(q.changePct)}%</div>
    ${spark(q.spark, c)}</div>`;
}

function renderMarkets(m){
  if (!m) return;

  // 美股：綠漲紅跌
  const us = m.us || {};
  $("#us-mkt").innerHTML = (us.indices || []).map(q => mktCard(q,"var(--up)","var(--down)")).join("");
  const vixTxt = us.vix && !us.vix.error
    ? `　VIX ${fmt(us.vix.value)}（${us.sentiment?.level ?? "—"}）` : "";
  const usDate = us.indices?.find(i => i.date)?.date;
  $("#us-mkt").insertAdjacentHTML("afterend",
    `<p class="legend">${usDate ? usDate + " 收盤" : "最新收盤"} · 綠漲紅跌${vixTxt}</p>`);

  // 台股：紅漲綠跌
  const tw = m.tw || {};
  const cards = [];
  if (tw.taiex) cards.push(mktCard(tw.taiex,"var(--tw-up)","var(--tw-down)"));
  (tw.watch || []).slice(0,2).forEach(s => {
    if (!s.error) cards.push(mktCard({...s, spark:null},"var(--tw-up)","var(--tw-down)"));
  });
  $("#tw-mkt").innerHTML = cards.join("");
  const twDate = tw.taiex?.date;
  $("#tw-mkt").insertAdjacentHTML("afterend",
    `<p class="legend">${twDate ? twDate + " 收盤" : "最新收盤"} · 紅漲綠跌</p>`);

  // 三大法人
  const fl = tw.flows;
  const flowBox = $("#tw-flow");
  if (fl){
    const cell = (label, v) => {
      const c = v == null ? "var(--text-faint)" : v >= 0 ? "var(--tw-up)" : "var(--tw-down)";
      return `<div><div class="fl-n">${label}</div>
        <div class="fl-v" style="color:${c}">${v == null ? "—" : signed(v,1) + " 億"}</div></div>`;
    };
    flowBox.innerHTML = cell("外資", fl.foreign) + cell("投信", fl.trust) + cell("自營商", fl.dealer);
  } else {
    flowBox.style.display = "none";
  }

  // 聯動判讀
  const link = m.linkage || [];
  if (link.length){
    const box = el("div","digest");
    box.appendChild(el("h4",null,"美台聯動判讀"));
    const ul = el("ul");
    link.forEach(l => ul.appendChild(el("li",null,`${l.label} ${l.value} — ${l.note}`)));
    box.appendChild(ul);
    $("#tw-flow").insertAdjacentElement("afterend", box);
  }
}

/* ---------- flavour wheel ---------- */
const WHEEL = [
  {n:"花香", h:52,  subs:["茉莉","玫瑰","洋甘菊"]},
  {n:"柑橘", h:38,  subs:["檸檬","佛手柑","橘子"]},
  {n:"莓果", h:340, subs:["藍莓","草莓","黑醋栗"]},
  {n:"熱帶", h:20,  subs:["芒果","鳳梨","百香果"]},
  {n:"核果", h:10,  subs:["水蜜桃","杏桃","李子"]},
  {n:"焦糖", h:32,  subs:["蜂蜜","紅糖","楓糖"]},
  {n:"堅果", h:24,  subs:["杏仁","榛果","黑巧克力"]},
  {n:"辛香", h:14,  subs:["肉桂","丁香","黑胡椒"]},
  {n:"酒感", h:320, subs:["紅酒","蘭姆酒","威士忌"]}
];
let ANSWERS = [];          // 今日豆的標準風味，載入後填入
const picked = new Set();
let revealed = false;

/* 以「當年的第幾天」當索引，同一天永遠是同一支豆／同一句諺語／同一組動作。 */
function dayIndex(){
  const start = Date.UTC(tpe.getFullYear(), 0, 0);
  const today = Date.UTC(tpe.getFullYear(), tpe.getMonth(), tpe.getDate());
  return Math.floor((today - start) / 86400000);
}

const ROAST_LABEL = ["", "極淺焙", "淺焙", "中焙", "中深焙", "深焙"];

async function loadBean(){
  try {
    const { beans } = await loadJSON("beans");
    const idx = dayIndex() % beans.length;
    const b = beans[idx];
    ANSWERS = b.notes.slice();

    $("#bean-name").textContent = b.name;
    $("#bean-en").textContent   = `${b.en} · ${b.process}`;
    $("#bean-no").textContent   = `No. ${idx + 1} / ${beans.length}`;
    $("#bean-blurb").textContent = b.blurb;

    const dots = Array.from({length:5}, (_,i) =>
      `<i class="${i < b.roast ? "on" : ""}"></i>`).join("");
    $("#bean-specs").innerHTML =
      `<div class="spec"><dt>處理法</dt><dd>${b.process}</dd></div>
       <div class="spec"><dt>海拔</dt><dd>${b.altitude}</dd></div>
       <div class="spec"><dt>品種</dt><dd>${b.varietal}</dd></div>
       <div class="spec"><dt>烘焙度</dt><dd>${ROAST_LABEL[b.roast]}<span class="roast">${dots}</span></dd></div>`;
  } catch (err) {
    $("#bean-name").textContent = "今日豆單讀取失敗";
    $("#bean-hint").textContent = err.message;
    $("#reveal-btn").disabled = true;
  }
}

const svgNS = "http://www.w3.org/2000/svg";
function arc(cx,cy,r0,r1,a0,a1){
  const p=(r,a)=>[cx+r*Math.cos(a), cy+r*Math.sin(a)];
  const [x0,y0]=p(r1,a0),[x1,y1]=p(r1,a1),[x2,y2]=p(r0,a1),[x3,y3]=p(r0,a0);
  const lg = (a1-a0)>Math.PI?1:0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${lg} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${lg} 0 ${x3} ${y3}Z`;
}
function buildWheel(){
  const w=$("#wheel"), C=200, N=WHEEL.length, step=2*Math.PI/N, off=-Math.PI/2;
  WHEEL.forEach((cat,i)=>{
    const a0=off+i*step, a1=a0+step;
    // inner ring
    const inner=document.createElementNS(svgNS,"path");
    inner.setAttribute("d",arc(C,C,60,112,a0+.012,a1-.012));
    inner.setAttribute("fill",`hsl(${cat.h} 42% 32%)`);
    inner.setAttribute("stroke","rgba(0,0,0,.35)"); inner.setAttribute("stroke-width",".5");
    w.appendChild(inner);
    const am=(a0+a1)/2, ix=C+86*Math.cos(am), iy=C+86*Math.sin(am);
    const it=document.createElementNS(svgNS,"text");
    it.setAttribute("x",ix); it.setAttribute("y",iy);
    it.setAttribute("text-anchor","middle"); it.setAttribute("dominant-baseline","central");
    it.setAttribute("font-size","13"); it.setAttribute("fill","#F2E9D2");
    it.setAttribute("letter-spacing","1");
    it.setAttribute("transform",`rotate(${am*180/Math.PI+90} ${ix} ${iy})`);
    it.textContent=cat.n; w.appendChild(it);

    // outer ring
    const sstep=step/cat.subs.length;
    cat.subs.forEach((s,j)=>{
      const b0=a0+j*sstep, b1=b0+sstep, bm=(b0+b1)/2;
      const g=document.createElementNS(svgNS,"g");
      g.setAttribute("class","seg"); g.setAttribute("role","button");
      g.setAttribute("tabindex","0"); g.setAttribute("aria-label",s);
      g.setAttribute("aria-pressed","false"); g.dataset.name=s;
      const pa=document.createElementNS(svgNS,"path");
      pa.setAttribute("d",arc(C,C,116,186,b0+.008,b1-.008));
      pa.setAttribute("fill",`hsl(${cat.h} 40% ${44+j*7}%)`);
      pa.setAttribute("stroke","rgba(0,0,0,.3)"); pa.setAttribute("stroke-width",".5");
      g.appendChild(pa);
      const tx=C+151*Math.cos(bm), ty=C+151*Math.sin(bm);
      const t=document.createElementNS(svgNS,"text");
      t.setAttribute("x",tx); t.setAttribute("y",ty);
      t.setAttribute("text-anchor","middle"); t.setAttribute("dominant-baseline","central");
      t.setAttribute("font-size","11"); t.setAttribute("fill","#1A1206"); t.setAttribute("font-weight","600");
      let rot=bm*180/Math.PI;
      if(rot>90&&rot<270) rot+=180;
      t.setAttribute("transform",`rotate(${rot} ${tx} ${ty})`);
      t.textContent=s; g.appendChild(t);
      const toggle=()=>{
        if(revealed) return;
        if(picked.has(s)){ picked.delete(s); pa.setAttribute("stroke","rgba(0,0,0,.3)"); pa.setAttribute("stroke-width",".5"); g.setAttribute("aria-pressed","false"); }
        else { picked.add(s); pa.setAttribute("stroke","#F0D68C"); pa.setAttribute("stroke-width","2.5"); g.setAttribute("aria-pressed","true"); }
        renderPicks();
      };
      g.addEventListener("click",toggle);
      g.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();} });
      w.appendChild(g);
    });
  });
  const hub=document.createElementNS(svgNS,"circle");
  hub.setAttribute("cx",C); hub.setAttribute("cy",C); hub.setAttribute("r",59);
  hub.setAttribute("fill","#14100A"); hub.setAttribute("stroke","rgba(212,175,86,.45)");
  w.appendChild(hub);
  ["風味輪","FLAVOR"].forEach((s,i)=>{
    const t=document.createElementNS(svgNS,"text");
    t.setAttribute("class","hub-t"); t.setAttribute("x",C); t.setAttribute("y",C-4+i*20);
    t.setAttribute("text-anchor","middle"); t.setAttribute("dominant-baseline","central");
    if(i===1){ t.setAttribute("font-size","8"); t.setAttribute("letter-spacing","3"); t.style.fill="#7E6A2E"; }
    t.textContent=s; w.appendChild(t);
  });
}
function renderPicks(){
  const box=$("#picks"); box.innerHTML="";
  if(!picked.size){ box.appendChild(el("span","ph","尚未選擇任何風味")); return; }
  [...picked].forEach(p=>{
    const c=el("span","chip",p);
    if(revealed) c.classList.add(ANSWERS.includes(p)?"hit":"miss");
    box.appendChild(c);
  });
  if(revealed){
    ANSWERS.filter(a=>!picked.has(a)).forEach(a=>{
      const c=el("span","chip hit",a+" ✦"); box.appendChild(c);
    });
  }
}
buildWheel();
$("#reveal-btn").addEventListener("click",()=>{
  if(revealed || !ANSWERS.length) return;
  revealed=true;
  const hit=[...picked].filter(p=>ANSWERS.includes(p)).length;
  $("#bean-score").textContent = `你選了 ${picked.size} 項，命中 ${hit} / ${ANSWERS.length} 個標準風味。`;
  renderPicks();
  $("#bean-reveal").classList.add("on");
  $("#reveal-btn").disabled=true; $("#reveal-btn").textContent="已揭曉";
  document.querySelectorAll("#wheel .seg").forEach(g=>{
    if(ANSWERS.includes(g.dataset.name)){
      const p=g.querySelector("path");
      p.setAttribute("stroke","#F0D68C"); p.setAttribute("stroke-width","2.5");
    }
  });
});

/* ---------- proverb ---------- */
async function loadProverb(){
  try {
    const { proverbs } = await loadJSON("proverbs");
    const p = proverbs[dayIndex() % proverbs.length];
    $("#pv-text").textContent = p.de;
    $("#pv-lit").textContent  = "字面：" + p.lit;
    $("#pv-zh").textContent   = p.zh;
    $("#pv-use").textContent  = p.use;
  } catch (err) {
    $("#pv-text").textContent = "今日德諺讀取失敗";
    $("#pv-use").textContent  = err.message;
  }
}


const btn=$("#speak-btn"), label=$("#speak-label");
if(!("speechSynthesis" in window)){
  $("#voice-note").textContent="此裝置不支援語音合成";
  btn.disabled=true; btn.style.opacity=".45";
}
btn.addEventListener("click",()=>{
  if(!("speechSynthesis" in window)) return;
  if(speechSynthesis.speaking){ speechSynthesis.cancel(); return; }
  const u=new SpeechSynthesisUtterance($("#pv-text").textContent.trim());
  u.lang="de-DE"; u.rate=.85; u.pitch=1;
  const de=speechSynthesis.getVoices().find(v=>v.lang && v.lang.toLowerCase().startsWith("de"));
  if(de) u.voice=de;
  u.onstart=()=>{ btn.classList.add("playing"); label.textContent="播放中"; };
  u.onend=u.onerror=()=>{ btn.classList.remove("playing"); label.textContent="聆聽發音"; };
  speechSynthesis.speak(u);
});
if("speechSynthesis" in window){
  const chk=()=>{
    const de=speechSynthesis.getVoices().find(v=>v.lang && v.lang.toLowerCase().startsWith("de"));
    $("#voice-note").textContent = de ? `德語語音 · ${de.name}` : "德語語音 · 由裝置合成";
  };
  speechSynthesis.onvoiceschanged=chk; chk();
}

/* ---------- anatomical atlas + match game ---------- */
/* Plate I : anterior CX=140, posterior CX=310.  Plate II : deep back CX=230. */
const MIR_A = "matrix(-1 0 0 1 280 0)";
const MIR_P = "matrix(-1 0 0 1 620 0)";
const MIR_D = "matrix(-1 0 0 1 460 0)";

/* Faint silhouette, left half only */
const SIL = [
  "M140 66 C128 66 114 70 106 78 C104 96 108 120 112 142 C114 158 113 170 112 178",
  "M112 178 C114 191 120 199 128 202 L140 203",
  "M112 181 C110 199 113 223 117 247 C119 261 121 277 122 295 C123 309 124 319 125 327 L137 327 C138 315 139 299 139 281 C139 253 140 213 140 186",
  "M107 76 C99 86 96 104 97 122 C98 140 100 160 101 178 C102 192 104 202 106 210 L115 208 C113 196 112 180 111 162 C110 142 111 116 115 94"
];

/* Non-interactive detail muscles */
const DETAIL_A = [
  "M126 118 C118 122 114 133 115 146 C116 157 121 166 128 171 C124 156 124 130 126 118 Z",
  "M120 114 C116 116 114 120 115 124 C119 123 122 120 122 116 Z",
  "M119 125 C115 127 113 131 114 135 C118 134 121 131 121 127 Z",
  "M118 136 C114 138 112 142 113 146 C117 145 120 142 120 138 Z",
  "M134 264 C127 267 122 279 123 293 C124 305 129 311 133 309 C137 301 137 278 134 264 Z"
];
const DETAIL_P = [
  "M279 161 C273 167 269 181 270 195 C271 205 275 209 279 207 C283 199 283 179 282 167 Z",
  "M304 264 C296 267 291 279 292 293 C293 305 298 311 302 309 C306 301 306 278 304 264 Z"
];
/* Plate II · torso silhouette, scapula and spine (left half, CX=230) */
const DEEP_SIL = [
  "M230 12 C222 12 216 16 214 22 L214 34 C196 38 178 44 168 54 C160 64 156 82 155 100",
  "M155 100 C154 116 158 130 163 142 C167 152 169 160 170 168",
  "M214 34 C206 40 198 48 194 58",
  "M230 200 C214 200 198 196 188 190 C180 184 176 172 176 158 C176 140 180 118 184 100 C188 80 192 62 196 52"
];
const DEEP_BONE = [
  "M209 52 C196 54 180 58 167 63 C176 82 188 104 198 122 C203 100 208 74 209 52 Z",
  "M209 52 C196 55 180 60 168 66",
  "M230 16 L230 202",
  "M224 40 L236 40 M224 60 L236 60 M224 80 L236 80 M224 100 L236 100 M224 120 L236 120 M224 140 L236 140 M224 160 L236 160 M224 180 L236 180",
  "M214 44 C198 50 180 60 170 72",
  "M212 66 C196 74 180 86 172 100",
  "M210 90 C194 100 180 114 174 128",
  "M208 114 C192 126 180 140 176 154"
];

/* Interactive muscle groups. lab = [labelX, labelY, anchor]; pin = leader end point.
   fig: 1 = Plate I (whole body), 2 = Plate II (deep back) */
const MUSCLES = [
  /* ---- Plate I · posterior superficial : the back, in detail ---- */
  {id:"trapU", n:"斜方肌上部", en:"Upper Trapezius", mir:MIR_P, fig:1,
   d:["M308 53 C301 55 293 61 284 71 C288 77 294 81 300 85 C304 79 307 66 308 57 Z"],
   fib:[[307,56,286,71],[307,64,290,77],[307,72,296,82]],
   lab:[258,58,"end"], pin:[287,70]},
  {id:"trapM", n:"斜方肌中部", en:"Middle Trapezius", mir:MIR_P, fig:1,
   d:["M308 88 L290 92 C289 98 291 104 294 108 L308 111 Z"],
   fib:[[307,93,292,95],[307,100,292,101],[307,107,295,106]],
   lab:[258,92,"end"], pin:[291,99]},
  {id:"trapL", n:"斜方肌下部", en:"Lower Trapezius", mir:MIR_P, fig:1,
   d:["M308 114 C302 112 296 112 292 114 C296 125 302 137 306 148 C308 142 308 126 308 114 Z"],
   fib:[[306,146,294,116],[307,136,295,115],[307,124,296,114]],
   lab:[258,126,"end"], pin:[295,128]},
  {id:"lat", n:"背闊肌", en:"Latissimus Dorsi", mir:MIR_P, fig:1,
   d:["M308 122 C298 120 288 118 283 116 C280 124 279 138 281 150 C284 164 290 174 299 178 C305 178 308 175 308 168 Z"],
   fib:[[285,120,307,126],[282,134,307,140],[283,150,307,154],[289,168,307,166]],
   lab:[258,162,"end"], pin:[282,150]},
  {id:"deltP", n:"後三角肌", en:"Posterior Deltoid", mir:MIR_P, fig:1,
   d:["M289 74 C278 77 270 87 269 99 C268 108 272 115 278 116 C283 111 287 100 290 90 C292 82 292 75 289 74 Z"],
   fib:[[287,76,274,110],[283,76,278,113],[290,82,282,113]],
   lab:[368,76,"start"], pin:[351,96]},
  {id:"tri", n:"肱三頭肌", en:"Triceps Brachii", mir:MIR_P, fig:1,
   d:["M277 119 C271 123 268 134 269 146 C270 155 274 160 279 159 C283 154 284 140 283 129 C282 122 280 119 277 119 Z"],
   fib:[[276,122,274,156],[280,123,277,157]],
   lab:[368,126,"start"], pin:[351,140]},
  {id:"glut", n:"臀大肌", en:"Gluteus Maximus", mir:MIR_P, fig:1,
   d:["M308 176 C297 176 289 183 286 193 C283 203 287 212 294 216 C301 219 306 215 308 209 Z"],
   fib:[[288,190,307,182],[286,200,307,192],[290,211,307,203]],
   lab:[368,192,"start"], pin:[334,196]},
  {id:"ham", n:"腿後肌群", en:"Hamstrings", mir:MIR_P, fig:1,
   d:["M307 218 C296 220 289 232 288 247 C288 256 292 258 297 256 C302 250 306 236 307 224 Z"],
   fib:[[303,221,293,252]],
   lab:[368,240,"start"], pin:[332,240]},

  /* ---- Plate II · deep back ---- */
  {id:"lev", n:"提肩胛肌", en:"Levator Scapulae", mir:MIR_D, fig:2,
   d:["M227 14 C220 22 213 34 206 50 C210 55 216 54 218 49 C223 37 227 25 230 16 Z"],
   fib:[[226,18,210,50],[229,20,214,52]],
   lab:[126,32,"end"], pin:[208,44]},
  {id:"rhom", n:"菱形肌", en:"Rhomboids", mir:MIR_D, fig:2,
   d:["M229 56 C221 61 212 68 205 75 C208 81 212 84 217 85 C221 76 226 64 229 58 Z",
      "M229 88 C220 93 210 100 203 107 C206 115 212 120 218 123 C222 112 226 98 229 90 Z"],
   fib:[[228,60,209,76],[228,92,207,108],[227,102,213,118],[227,110,217,121]],
   lab:[126,78,"end"], pin:[206,80]},
  {id:"infra", n:"棘下肌", en:"Infraspinatus", mir:MIR_D, fig:2,
   d:["M203 62 C189 66 177 77 171 91 C177 101 189 107 201 105 C205 93 206 74 203 62 Z"],
   fib:[[202,68,177,87],[203,80,172,93],[202,92,177,99]],
   lab:[126,116,"end"], pin:[172,92]},
  {id:"tmin", n:"小圓肌", en:"Teres Minor", mir:MIR_D, fig:2,
   d:["M200 109 C190 109 180 113 175 119 C182 126 193 128 201 124 Z"],
   fib:[[199,112,178,120]],
   lab:[126,148,"end"], pin:[176,120]},
  {id:"tmaj", n:"大圓肌", en:"Teres Major", mir:MIR_D, fig:2,
   d:["M198 130 C187 130 176 135 171 143 C179 152 192 154 200 149 Z"],
   fib:[[197,134,175,144],[199,140,180,150]],
   lab:[334,124,"start"], pin:[289,143]},
  {id:"erec", n:"豎脊肌", en:"Erector Spinae", mir:MIR_D, fig:2,
   d:["M229 58 C223 66 220 96 220 126 C220 156 223 182 228 198 C230 188 230 90 229 58 Z"],
   fib:[[226,68,225,192],[228,64,227,194]],
   lab:[334,72,"start"], pin:[238,104]},
  {id:"ql", n:"腰方肌", en:"Quadratus Lumborum", mir:MIR_D, fig:2,
   d:["M218 142 C209 146 204 157 204 169 C204 181 209 191 217 195 C220 183 220 156 218 142 Z"],
   fib:[[216,148,210,189]],
   lab:[334,174,"start"], pin:[256,170]},

  /* ---- Plate I · anterior ---- */
  {id:"delt", n:"三角肌", en:"Deltoid", mir:MIR_A, fig:1,
   d:["M119 72 C108 75 100 85 99 97 C98 107 102 114 108 115 C113 110 117 99 120 89 C122 81 122 74 119 72 Z"],
   fib:[[117,74,104,110],[113,74,108,112],[120,80,112,112]],
   lab:[96,100,"end"], pin:[100,100]},
  {id:"pec", n:"胸大肌", en:"Pectoralis Major", mir:MIR_A, fig:1,
   d:["M138 74 C127 73 117 77 113 84 C109 92 111 104 118 111 C126 116 135 113 138 108 Z"],
   fib:[[137,78,116,84],[137,86,113,92],[137,94,114,101],[137,102,119,109]],
   lab:[96,80,"end"], pin:[100,80]},
  {id:"bic", n:"肱二頭肌", en:"Biceps Brachii", mir:MIR_A, fig:1,
   d:["M107 118 C101 122 98 133 99 145 C100 154 104 159 109 158 C113 153 114 140 113 129 C112 122 110 118 107 118 Z"],
   fib:[[106,121,104,155],[110,122,107,156]],
   lab:[96,140,"end"], pin:[100,140]},
  {id:"abs", n:"腹直肌", en:"Rectus Abdominis", mir:MIR_A, fig:1,
   d:["M138 116 L128 118 C125 128 125 158 128 170 L138 172 Z"],
   fib:[[127,131,138,130],[126,144,138,143],[126,157,138,156]],
   lab:[96,162,"end"], pin:[126,160]},
  {id:"quad", n:"股四頭肌", en:"Quadriceps", mir:MIR_A, fig:1,
   d:["M136 182 C124 184 116 195 114 211 C113 227 117 244 123 252 C127 245 129 220 131 200 Z",
      "M138 184 C132 187 129 201 129 219 C129 237 131 250 135 256 C138 249 139 220 139 197 Z",
      "M138 226 C132 229 129 240 130 250 C131 256 135 258 138 255 Z"],
   fib:[[133,186,120,246],[136,188,126,250]],
   lab:[96,216,"end"], pin:[114,214]},
  {id:"fore", n:"前臂屈肌群", en:"Forearm Flexors", mir:MIR_A, fig:1,
   d:["M109 161 C103 167 99 181 100 195 C101 205 105 209 109 207 C113 199 113 179 112 167 Z"],
   fib:[[108,164,105,204],[111,166,108,205]],
   lab:[96,190,"end"], pin:[100,188]}
];

/** 今日三個動作。以日期為種子，同一天重開頁面題目不變。 */
let MOVES = [];
const TONES = ["var(--crest-tw)", "var(--crest-geo)", "var(--crest-esg)"];

/* 以日期為種子的簡易亂數（mulberry32），確保同一天結果一致 */
function seeded(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickDaily(list, n, seed){
  const rand = seeded(seed);
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}
let sel=null, done=0;
const lines=$("#mg-lines"), movesBox=$("#mg-moves");
const bodySvg=$("#body-svg"), deepSvg=$("#deep-svg");

function mk(tag, attrs){
  const n=document.createElementNS(svgNS,tag);
  for(const k in attrs) n.setAttribute(k,attrs[k]);
  return n;
}

/* ---- Plate I : silhouette + non-interactive detail, both figures ---- */
[[0,DETAIL_A,MIR_A],[170,DETAIL_P,MIR_P]].forEach(([dx,det,mir])=>{
  const fig=mk("g",{transform:`translate(${dx},0)`});
  const skin=mk("g",{fill:"none",stroke:"var(--rule)","stroke-width":"1","stroke-linecap":"round"});
  skin.appendChild(mk("ellipse",{cx:140,cy:38,rx:15,ry:18}));
  skin.appendChild(mk("path",{d:"M132 55 L132 67"}));
  skin.appendChild(mk("path",{d:"M148 55 L148 67"}));
  SIL.forEach(d=>{
    skin.appendChild(mk("path",{d}));
    skin.appendChild(mk("path",{d,transform:MIR_A}));
  });
  fig.appendChild(skin);
  bodySvg.appendChild(fig);
  const dg=mk("g",{fill:"var(--card-2)",stroke:"var(--rule-strong)","stroke-width":".7",opacity:".85"});
  det.forEach(d=>{
    dg.appendChild(mk("path",{d}));
    dg.appendChild(mk("path",{d,transform:mir}));
  });
  bodySvg.appendChild(dg);
});

/* ---- Plate II : deep-back torso, scapula, spine ---- */
(function(){
  const skin=mk("g",{fill:"none",stroke:"var(--rule)","stroke-width":"1","stroke-linecap":"round"});
  DEEP_SIL.forEach(d=>{
    skin.appendChild(mk("path",{d}));
    skin.appendChild(mk("path",{d,transform:MIR_D}));
  });
  deepSvg.appendChild(skin);
  const bones=mk("g",{class:"bone","stroke-linejoin":"round"});
  DEEP_BONE.forEach(d=>{
    bones.appendChild(mk("path",{d}));
    bones.appendChild(mk("path",{d,transform:MIR_D}));
  });
  deepSvg.appendChild(bones);
  const cap=mk("text",{x:230,y:222,"text-anchor":"middle","font-size":"7.5",
    fill:"var(--text-faint)","letter-spacing":"1.4"});
  cap.style.fontFamily="var(--mono)";
  cap.textContent="虛線 = 肩胛骨與脊柱輪廓";
  deepSvg.appendChild(cap);
})();

/* ---- interactive muscles, routed to their plate ---- */
MUSCLES.forEach(m=>{
  const host = m.fig===2 ? deepSvg : bodySvg;
  const g=mk("g",{class:"mus",role:"button",tabindex:"0","aria-label":m.n});
  g.dataset.id=m.id;
  // hit-area + belly, both sides
  [null,m.mir].forEach(tf=>{
    m.d.forEach(d=>{
      const p=mk("path",{class:"belly",d,fill:"var(--card-2)",
        stroke:"var(--rule-strong)","stroke-width":"1","stroke-linejoin":"round"});
      if(tf) p.setAttribute("transform",tf);
      g.appendChild(p);
    });
    const fg=mk("g",{class:"fib",stroke:"var(--rule)","stroke-width":".5",fill:"none",opacity:".8"});
    if(tf) fg.setAttribute("transform",tf);
    m.fib.forEach(f=>fg.appendChild(mk("path",{d:`M${f[0]} ${f[1]} L${f[2]} ${f[3]}`})));
    g.appendChild(fg);
  });
  // leader + label (single side)
  const [lx,ly,anc]=m.lab, [px,py]=m.pin;
  const bend = anc==="end" ? lx+8 : lx-8;
  g.appendChild(mk("path",{class:"lead",d:`M${lx+(anc==="end"?4:-4)} ${ly-3} L${bend} ${ly-3} L${px} ${py}`}));
  const t=mk("text",{class:"lbl",x:lx,y:ly-6,"text-anchor":anc});
  t.textContent=m.n; g.appendChild(t);
  const t2=mk("text",{class:"lbl",x:lx,y:ly+3.5,"text-anchor":anc,
    "font-size":"6.5","letter-spacing":".5",opacity:".62"});
  t2.textContent=m.en.toUpperCase(); g.appendChild(t2);

  g.addEventListener("click",()=>hitMuscle(m,g));
  g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();hitMuscle(m,g);}});
  host.appendChild(g);
});

const musEl = id => $("#mg").querySelector('.mus[data-id="'+id+'"]');
const allMus = () => $("#mg").querySelectorAll(".mus");
const cards = [];
let solved = false, isolated = null;

function buildMoveCards(){
  movesBox.innerHTML = "";
  cards.length = 0;
  MOVES.forEach((mv,i)=>{
  const b=el("button","mv"); b.type="button"; b.setAttribute("aria-pressed","false"); b.dataset.i=i;
  const pip=el("span","mv-pip"); pip.style.background=mv.tone;
  b.appendChild(pip);
  b.appendChild(el("span","mv-n",mv.n)); b.appendChild(el("span","mv-e",mv.e));
  b.addEventListener("click",()=>{
    if(solved){ isolate(isolated===i ? null : i); return; }
    if(b.classList.contains("done")) return;
    movesBox.querySelectorAll(".mv").forEach(x=>x.setAttribute("aria-pressed","false"));
    if(sel===b){ sel=null; $("#mg-status").textContent=done+" / "+MOVES.length+" 完成"; return; }
    sel=b; b.setAttribute("aria-pressed","true");
    $("#mg-status").textContent="已選「"+mv.n+"」 · 請在解剖圖上點選主要肌群";
  });
  cards.push(b); movesBox.appendChild(b);
  });
  $("#mg-status").textContent = "0 / " + MOVES.length + " 完成";
}

async function loadExercises(){
  try {
    const { exercises } = await loadJSON("exercises");
    MOVES = pickDaily(exercises, 3, dayIndex()).map((mv, i) => ({ ...mv, tone: TONES[i] }));
    buildMoveCards();
  } catch (err) {
    $("#mg-status").textContent = "動作庫讀取失敗：" + err.message;
  }
}

function paint(g, mode, tone){
  g.classList.add(mode==="prime" ? "lit" : "syn");
  g.querySelectorAll(".belly").forEach(p=>{
    if(mode==="prime"){
      p.setAttribute("fill","var(--gold)"); p.setAttribute("stroke","var(--gold-bright)");
      p.setAttribute("stroke-width","1");
    }else{
      p.setAttribute("fill",tone); p.setAttribute("fill-opacity",".45");
      p.setAttribute("stroke",tone); p.setAttribute("stroke-width","1.1");
      p.setAttribute("stroke-dasharray","3 2");
    }
  });
  g.querySelectorAll(".fib path").forEach(p=>
    p.setAttribute("stroke", mode==="prime" ? "rgba(0,0,0,.38)" : "rgba(0,0,0,.22)"));
}

function hitMuscle(m,g){
  if(solved){
    const asPrime = MOVES.filter(x=>x.m===m.id).map(x=>x.n);
    const asSyn   = MOVES.filter(x=>x.sec.includes(m.id)).map(x=>x.n);
    const parts=[];
    if(asPrime.length) parts.push("主動肌：" + asPrime.join("、"));
    if(asSyn.length)   parts.push("協同肌：" + asSyn.join("、"));
    $("#mg-status").textContent = m.n + "　" + (parts.join("　·　") || "今日三個動作皆未主要訓練");
    return;
  }
  if(!sel){ $("#mg-status").textContent="請先點選下方的一個動作"; return; }
  const mv=MOVES[+sel.dataset.i];
  if(mv.m===m.id){
    sel.classList.add("done"); sel.setAttribute("aria-pressed","false");
    paint(g,"prime");
    drawLine(sel,g,{tone:"var(--gold)",dash:false,move:+sel.dataset.i,delay:0});
    done++;
    $("#mg-status").textContent=done+" / "+MOVES.length+" 完成";
    if(done===MOVES.length) revealChains();
    sel=null;
  } else {
    sel.classList.add("wrong");
    const s=sel; setTimeout(()=>s.classList.remove("wrong"),400);
    $("#mg-status").textContent="再想想——這不是「"+mv.n+"」的主要肌群";
  }
}

function revealChains(){
  solved = true;
  $("#mg-status").textContent="✦ 全數答對 · 以下為各動作的協同肌";
  let n=0;
  MOVES.forEach((mv,i)=>{
    mv.sec.forEach(id=>{
      const g=musEl(id); if(!g) return;
      if(!g.classList.contains("lit")) paint(g,"syn",mv.tone);
      drawLine(cards[i], g, {tone:mv.tone, dash:true, move:i, delay:260+(n++)*130});
    });
  });
  $("#mg-legend").classList.add("on");
  $("#mg-notes").innerHTML = MOVES.map(x=>{
    const secNames = x.sec.map(id=>MUSCLES.find(u=>u.id===id).n).join("、");
    const pn = MUSCLES.find(u=>u.id===x.m).n;
    return `<span class="nt-h"><span class="nt-pip" style="background:${x.tone}"></span>${x.n}</span>`
      + `<span class="nt-chain"><b>主動肌</b> ${pn} <em>→</em> <b>協同肌</b> ${secNames}</span>`
      + `<span class="nt-b">${x.note}</span>`;
  }).join("");
  $("#mg-reveal").classList.add("on");
  cards.forEach(b=>{ b.classList.add("solved"); b.title="點一下只看這個動作的肌群鏈"; });
}

function isolate(i){
  isolated = i;
  const chain = i==null ? null : new Set([MOVES[i].m, ...MOVES[i].sec]);
  lines.querySelectorAll("path").forEach(p=>{
    p.style.opacity = (i==null || +p.dataset.move===i) ? "" : ".08";
  });
  allMus().forEach(g=>{
    const on = i==null || chain.has(g.dataset.id);
    g.style.opacity = on ? "" : ".28";
  });
  cards.forEach((b,j)=>b.setAttribute("aria-pressed", String(i!=null && j===i)));
  $("#mg-status").textContent = i==null
    ? "✦ 全數答對 · 點動作卡可單獨檢視該動作的肌群鏈"
    : MOVES[i].n + "　主動肌 1 · 協同肌 " + MOVES[i].sec.length;
}

function drawLine(from,to,opt){
  const base=$("#mg").getBoundingClientRect();
  const a=from.getBoundingClientRect(), b=to.getBoundingClientRect();
  const x1=a.left+a.width/2-base.left, y1=a.top-base.top;
  const x2=b.left+b.width/2-base.left, y2=b.top+b.height/2-base.top;
  lines.setAttribute("viewBox",`0 0 ${base.width} ${base.height}`);
  lines.setAttribute("width",base.width); lines.setAttribute("height",base.height);
  const p=mk("path",{fill:"none",stroke:opt.tone,
    "stroke-width": opt.dash ? "1.1" : "1.6",
    "stroke-linecap":"round",
    opacity: opt.dash ? ".62" : ".8",
    d:`M${x1} ${y1}C${x1} ${y1-30} ${x2} ${y2+30} ${x2} ${y2}`});
  p.dataset.move = opt.move;
  lines.appendChild(p);
  const L=p.getTotalLength ? p.getTotalLength() : Math.hypot(x2-x1,y2-y1)*1.6;
  if(reduced){
    if(opt.dash) p.setAttribute("stroke-dasharray","4 3");
    return;
  }
  p.setAttribute("stroke-dasharray",L); p.setAttribute("stroke-dashoffset",L);
  p.animate([{strokeDashoffset:L},{strokeDashoffset:0}],
    {duration:520,delay:opt.delay||0,easing:"ease-out",fill:"backwards"})
   .onfinish=()=>{
     p.setAttribute("stroke-dashoffset","0");
     p.setAttribute("stroke-dasharray", opt.dash ? "4 3" : "none");
   };
}

addEventListener("resize",()=>{
  if(!solved) return;
  lines.innerHTML="";
  MOVES.forEach((mv,i)=>{
    if(!cards[i].classList.contains("done")) return;
    drawLine(cards[i], musEl(mv.m), {tone:"var(--gold)",dash:false,move:i,delay:0});
    mv.sec.forEach(id=>drawLine(cards[i], musEl(id), {tone:mv.tone,dash:true,move:i,delay:0}));
  });
  if(isolated!=null) isolate(isolated);
});

/* ---------- ambient motes ---------- */
if(!reduced){
  const cv=$("#motes"), ctx=cv.getContext("2d");
  let W,H,parts;
  function init(){
    W=cv.width=innerWidth*devicePixelRatio; H=cv.height=innerHeight*devicePixelRatio;
    cv.style.width=innerWidth+"px"; cv.style.height=innerHeight+"px";
    parts=Array.from({length:38},()=>({
      x:Math.random()*W, y:Math.random()*H,
      r:(Math.random()*1.5+.5)*devicePixelRatio,
      vy:-(Math.random()*.22+.05)*devicePixelRatio,
      vx:(Math.random()-.5)*.12*devicePixelRatio,
      o:Math.random()*.4+.12, ph:Math.random()*6.28
    }));
  }
  init(); addEventListener("resize",init);
  let t=0;
  (function loop(){
    ctx.clearRect(0,0,W,H); t+=.012;
    const light = document.documentElement.dataset.theme==="light"
      || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: light)").matches);
    parts.forEach(p=>{
      p.y+=p.vy; p.x+=p.vx+Math.sin(t+p.ph)*.14*devicePixelRatio;
      if(p.y<-6){ p.y=H+6; p.x=Math.random()*W; }
      const a=p.o*(.6+.4*Math.sin(t*1.6+p.ph));
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832);
      ctx.fillStyle= light ? `rgba(138,106,22,${a*.5})` : `rgba(226,193,110,${a})`;
      ctx.fill();
    });
    requestAnimationFrame(loop);
  })();
}

/* ---------- smooth nav ---------- */
document.querySelectorAll(".nav a").forEach(a=>{
  a.addEventListener("click",e=>{
    const t=document.querySelector(a.getAttribute("href"));
    if(t){ e.preventDefault(); t.scrollIntoView({behavior:reduced?"auto":"smooth",block:"start"}); }
  });
});

/* ---------- boot ---------- */
(async function boot(){
  // 行情要先到位，兩個股市區塊才知道該畫什麼
  const markets = await loadJSON("markets").catch(err => {
    console.warn("行情讀取失敗", err);
    return null;
  });
  renderMarkets(markets);

  // 四個領域與三個小區塊並行載入，彼此不互相阻塞
  await Promise.all([
    renderDomain("esg", { "*": "#esg-list" }),
    renderDomain("geo", { gis: "#gis-list", ai: "#ai-list" }),
    renderDomain("us",  { "*": "#us-list" }),
    renderDomain("tw",  { "*": "#tw-list" }),
    loadBean(),
    loadProverb(),
    loadExercises(),
  ]);

  const foot = document.querySelector(".foot p");
  if (foot && markets?.updatedLocal) foot.textContent = `上次更新 · ${markets.updatedLocal}`;
})();

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW 註冊失敗", err));
  });
}
})();
