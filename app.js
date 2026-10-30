'use strict';
/*
 * AI Use Disclosure Builder
 * - Everything is held in memory (DOM + JS variables). No localStorage, cookies, or analytics.
 * - The only network call is the optional chatbot request to api.anthropic.com, made only
 *   when the user enters their own key and presses Send.
 */

// ---------- Configuration ----------
const AREAS = [
  { id: 'ideas', label: 'Ideas, research questions & study design', noun: 'developing ideas and the study design',
    ai: 'e.g., It suggested alternative framings of the research question and possible covariates.',
    human: 'e.g., I defined the research questions and chose the final study design.' },
  { id: 'lit', label: 'Literature search & summarization', noun: 'literature search and summarization',
    ai: 'e.g., It summarized 12 papers I supplied and suggested additional search terms.',
    human: 'e.g., I ran the database search, read every cited paper, and wrote the synthesis.' },
  { id: 'data', label: 'Data collection, cleaning & processing', noun: 'data cleaning and processing',
    ai: 'e.g., It wrote a script to reformat raw logger files and flag outliers.',
    human: 'e.g., I collected the field data and decided which flagged values to remove.' },
  { id: 'code', label: 'Code (writing, debugging, documentation)', noun: 'writing and debugging code',
    ai: 'e.g., It generated an initial R function for gap-filling and suggested fixes for errors.',
    human: 'e.g., I specified the algorithm, rewrote the function, and wrote unit tests.' },
  { id: 'analysis', label: 'Statistical analysis & interpretation', noun: 'analysis and interpretation',
    ai: 'e.g., It suggested a mixed-effects model structure and explained diagnostic plots.',
    human: 'e.g., I chose the final model and wrote all interpretation of the results.' },
  { id: 'text', label: 'Text (drafting, editing, translation)', noun: 'drafting and editing text',
    ai: 'e.g., It edited my draft Methods for grammar and concision and translated the abstract.',
    human: 'e.g., I wrote the original draft and accepted or rejected each suggested edit.' },
  { id: 'figures', label: 'Figures, tables & visuals', noun: 'producing figures, tables, and visuals',
    ai: 'e.g., It wrote ggplot2 code for Figures 2–4 and suggested a color-blind-safe palette.',
    human: 'e.g., I designed the figures and adjusted all layouts, labels, and scales.' },
];

const ROLES = {
  none:        { label: 'Not used' },
  minor:       { label: 'Minor: suggestions, editing, or checking my own work', short: 'minor assistance',
                 explain: we => `suggestions, editing, or checks of ${we.p} own work` },
  substantial: { label: 'Substantial: AI drafted content that I substantially revised', short: 'substantial assistance',
                 explain: we => `AI drafted content that ${we.s} substantially revised` },
  primary:     { label: 'Primary: content is mostly AI-generated, with my review', short: 'primary generation',
                 explain: we => `the content is mostly AI-generated and was reviewed by ${we.o}` },
};

const VERIFY_METHODS = {
  sources: 'comparing it against primary sources',
  rerun: 'running and testing the code',
  rawdata: 'checking results against the raw data',
  linebyline: 'line-by-line review',
  reproduce: 'independently reproducing key results',
  expert: 'review by co-authors or domain experts',
  citations: 'confirming that cited references exist and support the claims',
};

const PROMPT_STYLE = {
  single: 'through individual, self-contained prompts',
  iterative: we => `through iterative conversation, in which ${we.s} reviewed and refined the outputs`,
  agentic: we => `through an agentic workflow in which the AI carried out multi-step tasks under ${we.p} direction`,
  mixed: 'through a combination of individual prompts and iterative conversation',
};

const INPUT_LABELS = {
  text: 'draft text', code: 'code', data: 'data', lit: 'excerpts from published literature', figures: 'figures or images',
};

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const form = $('#survey');
const el = (tag, attrs = {}, text) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  if (text != null) n.textContent = text;
  return n;
};
const clean = s => (s || '').trim().replace(/\s+/g, ' ');
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const sent = s => { s = clean(s); if (!s) return ''; s = cap(s); return /[.!?)"”]$/.test(s) ? s : s + '.'; };
const frag = s => clean(s).replace(/[.\s]+$/, '');
const listJoin = arr => arr.length <= 1 ? (arr[0] || '') :
  arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
const val = name => (form.elements[name] && form.elements[name].value) || '';
const checked = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
const isOn = name => !!(form.elements[name] && form.elements[name].checked);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Build dynamic parts of the survey ----------
function addTool() {
  const row = el('div', { class: 'tool-row' });
  const field = (label, key, ph) => {
    const l = el('label', {}, label);
    const i = el('input', { 'data-k': key, placeholder: ph, autocomplete: 'off' });
    l.appendChild(i); return l;
  };
  row.appendChild(field('Tool name', 'name', 'e.g., Claude, ChatGPT, GitHub Copilot'));
  row.appendChild(field('Model / version', 'version', 'e.g., Claude Opus 5.5'));
  row.appendChild(field('Provider', 'provider', 'e.g., Anthropic, OpenAI'));
  const ml = el('label', {}, 'How accessed');
  const ms = el('select', { 'data-k': 'mode' });
  ['', 'chat interface', 'coding assistant in an IDE', 'agentic coding tool', 'API / script', 'built into other software']
    .forEach(o => ms.appendChild(el('option', { value: o }, o || '-')));
  ml.appendChild(ms); row.appendChild(ml);
  row.appendChild(field('When used', 'dates', 'e.g., Jan–Mar 2026'));
  const rm = el('button', { type: 'button', class: 'link remove' }, 'Remove');
  rm.addEventListener('click', () => row.remove());
  row.appendChild(rm);
  $('#tools').appendChild(row);
}

function buildAreas() {
  const box = $('#areas'), vbox = $('#verify');
  for (const a of AREAS) {
    // Contribution block
    const fs = el('fieldset', { class: 'area', 'data-area': a.id });
    fs.appendChild(el('legend', {}, a.label));
    const rl = el('label', {}, 'AI contribution');
    const rs = el('select', { name: `role_${a.id}` });
    for (const [k, r] of Object.entries(ROLES)) rs.appendChild(el('option', { value: k }, r.label));
    rl.appendChild(rs); fs.appendChild(rl);
    const det = el('div', { class: 'area-detail', hidden: '' });
    const t1 = el('label', {}, 'What did the AI do?');
    t1.appendChild(el('textarea', { name: `ai_${a.id}`, rows: '2', placeholder: a.ai }));
    const t2 = el('label', {}, 'What did you do?');
    t2.appendChild(el('textarea', { name: `human_${a.id}`, rows: '2', placeholder: a.human }));
    det.append(t1, t2); fs.appendChild(det); box.appendChild(fs);
    rs.addEventListener('change', syncAreas);

    // Verification block
    const vf = el('fieldset', { class: 'area', 'data-verify': a.id, hidden: '' });
    vf.appendChild(el('legend', {}, a.label));
    const vl = el('label', {}, 'How thoroughly did you verify the AI output?');
    const vs = el('select', { name: `ver_${a.id}` });
    [['full', 'Fully verified'], ['partial', 'Partially verified'], ['none', 'Not independently verified']]
      .forEach(([v, t]) => vs.appendChild(el('option', { value: v }, t)));
    vl.appendChild(vs); vf.appendChild(vl);
    const mwrap = el('div', { class: 'methods' });
    mwrap.appendChild(el('span', { class: 'sublabel' }, 'How?'));
    for (const [k, t] of Object.entries(VERIFY_METHODS)) {
      const ml = el('label', { class: 'inline' });
      ml.appendChild(el('input', { type: 'checkbox', name: `vm_${a.id}`, value: k }));
      ml.appendChild(document.createTextNode(' ' + cap(t)));
      mwrap.appendChild(ml);
    }
    vf.appendChild(mwrap);
    const h = el('label', {}, 'Other verification details (optional)');
    h.appendChild(el('textarea', { name: `vhow_${a.id}`, rows: '2', placeholder: 'e.g., I compared gap-filled values against an independent REddyProc run.' }));
    const n = el('label', {}, 'What did you NOT verify?');
    n.appendChild(el('textarea', { name: `vnot_${a.id}`, rows: '2', placeholder: 'e.g., the AI-written plotting helper functions beyond visual inspection of the output.' }));
    vf.append(h, n); vbox.appendChild(vf);
  }
}

function syncAreas() {
  let any = false;
  for (const a of AREAS) {
    const used = val(`role_${a.id}`) !== 'none';
    any = any || used;
    form.querySelector(`[data-area="${a.id}"] .area-detail`).hidden = !used;
    form.querySelector(`[data-verify="${a.id}"]`).hidden = !used;
  }
  $('#noVerify').hidden = any;
}

// ---------- Collect answers ----------
function collect() {
  const tools = [...document.querySelectorAll('.tool-row')].map(r => {
    const o = {}; r.querySelectorAll('[data-k]').forEach(i => { o[i.dataset.k] = clean(i.value); }); return o;
  }).filter(t => t.name);
  const areas = AREAS.map(a => ({
    ...a,
    role: val(`role_${a.id}`),
    aiDid: clean(val(`ai_${a.id}`)),
    humanDid: clean(val(`human_${a.id}`)),
    verify: val(`ver_${a.id}`),
    methods: checked(`vm_${a.id}`),
    verifyHow: clean(val(`vhow_${a.id}`)),
    notVerified: clean(val(`vnot_${a.id}`)),
  })).filter(a => a.role && a.role !== 'none');
  return {
    title: clean(val('title')), type: val('type'), voice: val('voice'), format: val('format'), length: val('stmtLength'),
    policy: clean(val('policy')), tools,
    promptStyle: (form.querySelector('input[name="promptStyle"]:checked') || {}).value || 'single',
    promptDesc: clean(val('promptDesc')), inputs: checked('inputs'), promptAvail: val('promptAvail'),
    areas, confidential: val('confidential'), confDetail: clean(val('confDetail')), citations: val('citations'),
    notAuthor: isOn('notAuthor'), responsible: isOn('responsible'), extra: clean(val('extra')),
  };
}

// ---------- Template generator (no AI involved) ----------
function pronouns(voice) {
  return voice === 'I' ? { s: 'I', o: 'me', p: 'my' } : { s: 'we', o: 'us', p: 'our' };
}

function toolText(t) {
  const bits = [t.provider, t.version, t.mode, t.dates].filter(Boolean);
  return bits.length ? `${t.name} (${bits.join('; ')})` : t.name;
}

function verifySentence(a, we) {
  const m = a.methods.map(k => VERIFY_METHODS[k]);
  const by = m.length ? ` by ${listJoin(m)}` : '';
  const out = [];
  if (a.verify === 'full') out.push(`${cap(we.s)} fully verified this output${by}.`);
  else if (a.verify === 'partial') out.push(`${cap(we.s)} partially verified this output${by}.`);
  else out.push(`${cap(we.s)} did not independently verify this AI output${m.length ? `, beyond ${listJoin(m)}` : ''}.`);
  if (a.verifyHow) out.push(sent(a.verifyHow));
  if (a.notVerified) out.push(`Not verified: ${frag(a.notVerified)}.`);
  return out.join(' ');
}

function integrityLines(d, we) {
  const out = [];
  if (d.confidential === 'no') out.push('No confidential, unpublished, proprietary, or personally identifiable data were entered into AI tools.');
  else if (d.confidential === 'approved') out.push('Confidential or unpublished data were entered only into institutionally approved AI tools.');
  else out.push('Some confidential or unpublished data were entered into AI tools.');
  if (d.confDetail) out.push(sent(d.confDetail));
  if (d.citations === 'checked') out.push('Every reference suggested by AI was checked against the original source.');
  if (d.citations === 'unchecked') out.push('Not all references suggested by AI were checked against the original sources.');
  if (d.extra) out.push(sent(d.extra));
  if (d.notAuthor) out.push('No AI tool is listed as an author, because AI tools cannot take responsibility for the work.');
  if (d.responsible) out.push(`${cap(we.s)} reviewed all AI-assisted content and take full responsibility for the accuracy, originality, and integrity of this ${d.type}.`);
  return out;
}

function promptLines(d, we) {
  const out = [];
  const style = PROMPT_STYLE[d.promptStyle];
  out.push(`${cap(we.s)} directed the AI ${typeof style === 'function' ? style(we) : style}.`);
  if (d.promptDesc) out.push(sent(d.promptDesc));
  if (d.inputs.length) out.push(`${cap(we.s)} provided the AI with ${we.p} own ${listJoin(d.inputs.map(k => INPUT_LABELS[k]))}.`);
  if (d.promptAvail === 'request') out.push('Prompts are available on request.');
  if (d.promptAvail === 'supp') out.push('Prompts are provided in the supplementary material.');
  if (d.promptAvail === 'notkept') out.push('Full prompt logs were not retained.');
  return out;
}

function generate(d) {
  const we = pronouns(d.voice);
  const work = d.title ? `this ${d.type}, "${d.title}"` : `this ${d.type}`;
  const toolsList = listJoin(d.tools.map(toolText));

  if (!d.tools.length && !d.areas.length) {
    const lines = [`No generative AI tools were used in preparing ${work}.`];
    if (d.responsible) lines.push(`${cap(we.s)} take full responsibility for its content.`);
    return lines.join(' ');
  }

  const head = d.tools.length
    ? `In preparing ${work}, ${we.s} used the following generative AI tool${d.tools.length > 1 ? 's' : ''}: ${toolsList}.`
    : `In preparing ${work}, ${we.s} used generative AI tools as described below.`;

  // Concise: one paragraph summary
  if (d.length === 'concise') {
    const uses = d.areas.map(a => `${a.noun} (${ROLES[a.role].short})`);
    const parts = [head, `AI was used for ${listJoin(uses)}.`];
    const byLevel = lvl => d.areas.filter(a => a.verify === lvl).map(a => a.noun);
    const v = [];
    if (byLevel('full').length) v.push(`fully verified the AI output for ${listJoin(byLevel('full'))}`);
    if (byLevel('partial').length) v.push(`partially verified the output for ${listJoin(byLevel('partial'))}`);
    if (byLevel('none').length) v.push(`did not independently verify the output for ${listJoin(byLevel('none'))}`);
    if (v.length) parts.push(`${cap(we.s)} ${listJoin(v)}.`);
    const nv = d.areas.filter(a => a.notVerified).map(a => frag(a.notVerified));
    if (nv.length) parts.push(`Not verified: ${nv.join('; ')}.`);
    parts.push(...integrityLines(d, we));
    return parts.join(' ');
  }

  if (d.format === 'structured') {
    const L = [];
    L.push('AI USE DISCLOSURE');
    L.push('');
    L.push(`Work: ${d.title || '(untitled)'} (${d.type})`);
    L.push('');
    L.push('AI tools used:');
    if (d.tools.length) d.tools.forEach(t => L.push(`- ${toolText(t)}`)); else L.push('- (not specified)');
    L.push('');
    L.push('How the AI was directed:');
    promptLines(d, we).forEach(s => L.push(`- ${s}`));
    L.push('');
    L.push('Contributions and verification:');
    for (const a of d.areas) {
      L.push(`- ${a.label} [AI role: ${ROLES[a.role].short}]`);
      if (a.aiDid) L.push(`    AI: ${sent(a.aiDid)}`);
      if (a.humanDid) L.push(`    Author${we.s === 'I' ? '' : 's'}: ${sent(a.humanDid)}`);
      L.push(`    Verification: ${verifySentence(a, we)}`);
    }
    L.push('');
    L.push('Data, citations and responsibility:');
    integrityLines(d, we).forEach(s => L.push(`- ${s}`));
    return L.join('\n');
  }

  // Detailed paragraph format
  const paras = [];
  paras.push([head, ...promptLines(d, we)].join(' '));
  for (const a of d.areas) {
    const s = [`For ${a.noun}, AI provided ${ROLES[a.role].short} (${ROLES[a.role].explain(we)}).`];
    if (a.aiDid) s.push(sent(a.aiDid));
    if (a.humanDid) s.push(sent(a.humanDid));
    s.push(verifySentence(a, we));
    paras.push(s.join(' '));
  }
  paras.push(integrityLines(d, we).join(' '));
  return paras.join('\n\n');
}

function warnings(d) {
  const w = [];
  if (!d.responsible) w.push('You did not confirm responsibility for the work in step 6, so the responsibility sentence is left out. Most journals and funders require it.');
  if (d.areas.length && !d.tools.length) w.push('You marked AI contributions but did not name any tools (step 2).');
  if (d.tools.length && !d.areas.length) w.push('You listed AI tools but did not mark any contributions (step 4).');
  d.areas.forEach(a => {
    if (!a.aiDid) w.push(`"${a.label}": describe what the AI did.`);
    if (!a.humanDid) w.push(`"${a.label}": describe what you did.`);
    if (a.verify !== 'none' && !a.methods.length && !a.verifyHow) w.push(`"${a.label}": say how you verified the AI output (step 5).`);
    if (a.verify !== 'full' && !a.notVerified) w.push(`"${a.label}": you marked it not fully verified. Say what you did not check.`);
  });
  if (d.citations === 'unchecked') w.push('Unchecked AI-suggested references are a major integrity risk. Consider checking them before you submit.');
  return w;
}

// ---------- Chatbot ----------
const SYSTEM_PROMPT = `You write AI use disclosure statements for research papers, proposals, software, and other scholarly projects.
Rules:
- Use ONLY facts in the survey answers. Never invent tools, model versions, uses, prompts, or verification steps.
- Make the division of labor explicit: what the human author(s) contributed (ideas, prompts, data, code, text) versus what the AI produced.
- State plainly what was verified, how, and what was NOT verified. Do not soften or omit unverified items.
- Name each tool with provider, version, and dates when given.
- Use the requested voice (I/we), format, and length. If a venue or funder policy is supplied, follow its required elements and wording.
- Be plain, specific, and neutral. No hype, no apology, no hedging filler.
- If the responsibility box was not checked, do not claim the authors take full responsibility; flag it instead.
Output format: the statement first, with no preamble. Then a line containing only "---", then at most 3 short bullet notes on gaps, inconsistencies, or questions the author should resolve. Leave the notes out if there are none.`;

function surveyForModel(d) {
  return {
    title: d.title || null, type_of_work: d.type, voice: d.voice, format: d.format, length: d.length,
    venue_policy: d.policy || null,
    ai_tools: d.tools,
    prompting: {
      style: typeof PROMPT_STYLE[d.promptStyle] === 'function' ? PROMPT_STYLE[d.promptStyle](pronouns(d.voice)) : PROMPT_STYLE[d.promptStyle],
      author_description: d.promptDesc || null,
      author_materials_given_to_ai: d.inputs.map(k => INPUT_LABELS[k]),
      prompt_availability: { request: 'available on request', supp: 'in supplementary material', notkept: 'not retained' }[d.promptAvail] || 'not stated',
    },
    contributions: d.areas.map(a => ({
      area: a.label, ai_role: ROLES[a.role].label, what_ai_did: a.aiDid || null, what_author_did: a.humanDid || null,
      verification_level: a.verify, verification_methods: a.methods.map(k => VERIFY_METHODS[k]),
      verification_details: a.verifyHow || null, not_verified: a.notVerified || null,
    })),
    areas_without_ai: AREAS.filter(x => !d.areas.find(a => a.id === x.id)).map(x => x.label),
    confidential_data_entered: { no: 'no', approved: 'yes, institutionally approved tool only', yes: 'yes' }[d.confidential],
    confidential_details: d.confDetail || null,
    ai_suggested_references: { na: 'none suggested', checked: 'all checked', unchecked: 'not all checked' }[d.citations],
    ai_listed_as_author: !d.notAuthor,
    authors_confirm_full_responsibility: d.responsible,
    other_disclosures: d.extra || null,
  };
}

function firstUserMessage() {
  const d = collect();
  return `Here are my survey answers (JSON):\n\n${JSON.stringify(surveyForModel(d), null, 2)}\n\nHere is a template draft built from those answers:\n\n${$('#draft').value}\n\nPlease write my final AI use disclosure statement.`;
}

let chat = []; // in-memory only

function renderChat() {
  const log = $('#chatLog');
  log.replaceChildren();
  chat.forEach((m, i) => {
    if (i === 0) {
      log.appendChild(el('div', { class: 'msg sys' }, 'Sent your survey answers and draft to the chatbot.'));
      return;
    }
    const b = el('div', { class: `msg ${m.role}` });
    b.appendChild(el('div', { class: 'who' }, m.role === 'user' ? 'You' : 'Chatbot'));
    b.appendChild(el('div', { class: 'body' }, m.content));
    if (m.role === 'assistant') {
      const c = el('button', { type: 'button', class: 'link' }, 'Copy statement');
      c.addEventListener('click', () => copyText(m.content.split(/\n-{3,}\n/)[0].trim(), 'Statement copied.'));
      const u = el('button', { type: 'button', class: 'link' }, 'Use as draft');
      u.addEventListener('click', () => { $('#draft').value = m.content.split(/\n-{3,}\n/)[0].trim(); toast('Draft replaced.'); });
      b.append(c, u);
    }
    log.appendChild(b);
  });
  log.scrollTop = log.scrollHeight;
}

async function sendChat() {
  const key = $('#apiKey').value.trim();
  if (!key) { toast('Enter an API key, or use Option B.'); $('#apiKey').focus(); return; }
  const typed = $('#chatMsg').value.trim();
  if (!chat.length) chat.push({ role: 'user', content: firstUserMessage() });
  if (typed) {
    if (chat[chat.length - 1].role === 'user') chat[chat.length - 1].content += `\n\n${typed}`;
    else chat.push({ role: 'user', content: typed });
  } else if (chat[chat.length - 1].role !== 'user') { toast('Type a revision request.'); return; }
  $('#chatMsg').value = '';
  renderChat();
  const btn = $('#chatSend'); btn.disabled = true; btn.textContent = 'Writing…';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: $('#model').value.trim() || 'claude-sonnet-5-5', max_tokens: 2000, system: SYSTEM_PROMPT, messages: chat }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    chat.push({ role: 'assistant', content: text || '(empty response)' });
  } catch (e) {
    $('#chatLog').appendChild(el('div', { class: 'msg error' }, `Error: ${e.message}`));
    return;
  } finally {
    btn.disabled = false; btn.textContent = 'Send';
  }
  renderChat();
}

function externalPrompt() {
  return `${SYSTEM_PROMPT}\n\n${firstUserMessage()}`;
}

async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied.'); }
  catch { toast('Copy failed. Select the text and copy it manually.'); }
}

// ---------- Wizard ----------
const steps = [...document.querySelectorAll('.step')];
let current = 0;

function buildNav() {
  const nav = $('#stepNav');
  steps.forEach((s, i) => {
    const li = el('li');
    const b = el('button', { type: 'button' }, `${i + 1}. ${s.dataset.title}`);
    b.addEventListener('click', () => go(i));
    li.appendChild(b); nav.appendChild(li);
  });
}

function go(i) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, k) => { s.hidden = k !== current; });
  document.querySelectorAll('#stepNav button').forEach((b, k) => b.setAttribute('aria-current', k === current ? 'step' : 'false'));
  $('#prev').disabled = current === 0;
  $('#next').hidden = current === steps.length - 1;
  if (current === steps.length - 1) refreshStatement();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshStatement() {
  const d = collect();
  $('#draft').value = generate(d);
  const w = warnings(d), box = $('#warnings');
  box.replaceChildren();
  if (w.length) {
    box.appendChild(el('strong', {}, 'Check before you use this:'));
    const ul = el('ul'); w.forEach(t => ul.appendChild(el('li', {}, t))); box.appendChild(ul);
  }
  box.hidden = !w.length;
}

function eraseAll() {
  form.reset();
  $('#tools').replaceChildren(); addTool();
  chat = []; renderChat();
  $('#apiKey').value = ''; $('#chatMsg').value = ''; $('#draft').value = '';
  $('#warnings').hidden = true;
  syncAreas(); go(0);
  if (navigator.clipboard) navigator.clipboard.writeText('').catch(() => {});
  toast('All answers erased.');
}

// ---------- Init ----------
buildAreas();
addTool();
buildNav();
syncAreas();
go(0);

$('#addTool').addEventListener('click', addTool);
$('#prev').addEventListener('click', () => go(current - 1));
$('#next').addEventListener('click', () => go(current + 1));
$('#copyDraft').addEventListener('click', () => copyText($('#draft').value, 'Statement copied.'));
$('#downloadDraft').addEventListener('click', () => {
  const blob = new Blob([$('#draft').value], { type: 'text/plain' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'ai-use-statement.txt' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#chatSend').addEventListener('click', sendChat);
$('#chatMsg').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat(); });
$('#copyPrompt').addEventListener('click', () => copyText(externalPrompt(), 'Prompt copied. Paste it into your chatbot.'));
$('#openClaude').addEventListener('click', async () => {
  await copyText(externalPrompt(), 'Prompt copied. Paste it into Claude.');
  window.open('https://claude.ai/new', '_blank', 'noopener,noreferrer');
});
$('#eraseAll').addEventListener('click', eraseAll);
// Survey changes invalidate any chat context
form.addEventListener('input', e => { if (e.target.closest('.step') !== steps[steps.length - 1]) chat = []; });
// Don't let the browser's back/forward cache bring old answers back
window.addEventListener('pageshow', e => { if (e.persisted) eraseAll(); });
