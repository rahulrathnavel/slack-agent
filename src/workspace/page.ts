export function renderWorkspacePage(userId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PioltPPT Data Studio</title>
  <style>
    :root { --ink: #14213d; --muted: #637083; --line: #d6dce5; --bg: #f4f7fb; --panel: #fff; --accent: #087f5b; --accent-dark: #066c4d; --warm: #d97706; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: 0; }
    header { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px max(20px, calc((100vw - 1280px) / 2)); background: var(--panel); border-bottom: 1px solid var(--line); }
    .brand { font-size: 20px; font-weight: 850; } .brand span { color: var(--accent); }
    .identity { color: var(--muted); font-size: 13px; }
    main { width: min(1280px, calc(100vw - 40px)); margin: 30px auto 50px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, .95fr); gap: 26px; }
    h1 { margin: 0; font-size: clamp(32px, 4vw, 52px); line-height: 1.04; } h2 { margin: 0 0 14px; font-size: 19px; }
    .intro { margin: 16px 0 26px; color: var(--muted); font-size: 17px; line-height: 1.5; max-width: 64ch; }
    .surface { background: var(--panel); border: 1px solid var(--line); padding: 22px; }
    .form { display: grid; gap: 16px; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 750; color: #41516a; }
    input, textarea, select { width: 100%; min-height: 42px; padding: 9px 11px; color: var(--ink); background: #fff; border: 1px solid var(--line); font: inherit; }
    textarea { min-height: 104px; resize: vertical; } input:focus, textarea:focus, select:focus { outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent); border-color: var(--accent); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .hint { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .file-list { display: grid; gap: 8px; min-height: 38px; }
    .file { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 11px; border: 1px solid var(--line); background: #f9fbfd; font-size: 14px; }
    .file small { color: var(--muted); } .empty { color: var(--muted); font-size: 13px; padding: 8px 0; }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
    button { min-height: 42px; padding: 0 16px; background: #fff; color: var(--ink); border: 1px solid var(--line); cursor: pointer; font: inherit; font-weight: 800; }
    button:hover { border-color: var(--accent); color: var(--accent); } button.primary { background: var(--accent); color: #fff; border-color: var(--accent); } button.primary:hover { background: var(--accent-dark); color: #fff; } button:disabled { opacity: .6; cursor: wait; }
    .side { display: grid; gap: 18px; align-content: start; }.side ul { margin: 0; padding-left: 19px; display: grid; gap: 10px; color: #405069; line-height: 1.4; }.side strong { color: var(--ink); }
    .status { min-height: 22px; color: var(--muted); font-size: 14px; }.status.error { color: #b42318; }.status.ok { color: var(--accent); }.result { display: none; gap: 10px; margin-top: 12px; padding: 14px; background: #edf8f3; border-left: 3px solid var(--accent); }.result.visible { display: grid; }.result a { color: var(--accent); font-weight: 800; }.evidence { display: none; margin-top: 12px; padding: 14px; border: 1px solid var(--line); background: #fff; }.evidence.visible { display: grid; gap: 10px; }.evidence strong { color: var(--ink); }.evidence ol { margin: 0; padding-left: 22px; display: grid; gap: 8px; }.evidence li { color: var(--muted); line-height: 1.35; }.evidence a { color: var(--accent); font-weight: 750; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; margin-top: 20px; } }.two { grid-template-columns: repeat(2, minmax(0, 1fr)); } @media (max-width: 560px) { main { width: min(100% - 24px, 1280px); }.two { grid-template-columns: 1fr; } header { padding: 12px; } }
  </style>
</head>
<body>
  <header><div class="brand">PioltPPT <span>Data Studio</span></div><div class="identity">Secure workspace for ${escapeHtml(userId)}</div></header>
  <main>
    <section>
      <h1>Turn data and Slack evidence into a presentation.</h1>
      <p class="intro">Upload CSV or Excel files and create a source-backed deck with computed charts, citations, and an editable web version. A PDF or PPTX may be stored as a design reference, but native template fidelity is not yet supported.</p>
      <form class="surface form" id="studioForm">
        <label>Deck title or question<input id="title" required placeholder="Example: Q2 revenue performance and operating risks" /></label>
        <label>What should the deck answer?<textarea id="prompt" placeholder="Example: Explain regional performance, identify the largest drivers, and prepare recommendations for leadership."></textarea></label>
        <div class="two"><label>Content slides<select id="slideCount"><option value="4">4</option><option value="5" selected>5</option><option value="6">6</option><option value="8">8</option></select></label><label>Presentation style<select id="style"><option value="executive-clean">Executive clean</option><option value="editorial">Editorial</option><option value="dark-stage">Dark stage</option><option value="minimal">Minimal</option></select></label></div>
        <label>Data files (CSV or XLSX)<input id="dataFiles" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple /></label>
        <div class="file-list" id="dataList"><span class="empty">No data files selected.</span></div>
        <label>Optional presentation template (PDF or PPTX)<input id="templateFile" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" /></label>
        <div class="file-list" id="templateList"><span class="empty">No template selected.</span></div>
        <div class="two"><label>Slack question<input id="slackQuery" placeholder="What did the team decide?" /></label><label>Person (optional)<input id="slackPerson" placeholder="Name or Slack handle" /></label></div>
        <div class="two"><label>Slack from date<input id="slackFrom" type="date" /></label><label>Slack to date<input id="slackTo" type="date" /></label></div>
        <p class="hint">Slack search uses only content the installed app or your authorized Slack identity can access. Empty Slack fields skip Slack research.</p>
        <div class="actions"><button id="researchSlack" type="button">Search Slack evidence</button><button class="primary" id="generate" type="submit">Create data deck</button></div><div class="status" id="status"></div><div class="evidence" id="evidence"></div><div class="result" id="result"></div>
      </form>
    </section>
    <aside class="side">
      <section class="surface"><h2>What PioltPPT computes</h2><ul><li><strong>Data profile:</strong> rows, columns, types, empty values, samples, and date coverage.</li><li><strong>Visuals:</strong> charts are generated from actual source values, not LLM guesses.</li><li><strong>Evidence:</strong> each data slide includes a file, worksheet, and row-range citation.</li><li><strong>Editing:</strong> adjust the finished deck in Deck Playground before publishing or exporting.</li></ul></section>
      <section class="surface"><h2>Template behavior</h2><ul><li><strong>PDF/PPTX intake:</strong> the file and metadata are stored as a reference for future styling work.</li><li><strong>Current limitation:</strong> masters, layouts, placeholders, and exact visual styling are not imported or preserved yet.</li><li><strong>Export:</strong> print/save the edited web deck as PDF, or download a clean generated PPTX based on current slide text.</li></ul></section>
    </aside>
  </main>
  <script>
    const userId = ${JSON.stringify(userId)};
    const token = new URLSearchParams(location.search).get('token') || '';
    const uploads = { data: [], template: null };
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    const evidence = document.getElementById('evidence');
    function api(path, options = {}) { return fetch('/api/workspace/' + encodeURIComponent(userId) + path + '?token=' + encodeURIComponent(token), options).then(async (response) => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }); }
    function showFiles(target, files) { target.textContent = ''; if (!files.length) { target.innerHTML = '<span class="empty">No files selected.</span>'; return; } files.forEach((file) => { const item = document.createElement('div'); item.className = 'file'; item.innerHTML = '<span></span><small></small>'; item.querySelector('span').textContent = file.name; item.querySelector('small').textContent = file.kind.toUpperCase(); target.appendChild(item); }); }
    async function upload(input, destination) { const files = Array.from(input.files || []); if (!files.length) return; status.textContent = 'Uploading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '...'; status.className = 'status'; const stored = []; for (const file of files) { const response = await api('/upload', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file }); stored.push(response.upload); } uploads[destination] = destination === 'template' ? stored[0] : stored; showFiles(destination === 'template' ? document.getElementById('templateList') : document.getElementById('dataList'), stored); status.textContent = 'Upload ready.'; status.className = 'status ok'; }
    document.getElementById('dataFiles').addEventListener('change', async (event) => { try { await upload(event.target, 'data'); } catch (error) { status.textContent = error.message; status.className = 'status error'; } });
    document.getElementById('templateFile').addEventListener('change', async (event) => { try { await upload(event.target, 'template'); } catch (error) { status.textContent = error.message; status.className = 'status error'; } });
    document.getElementById('researchSlack').addEventListener('click', async () => { const query = document.getElementById('slackQuery').value.trim(); if (!query) { status.textContent = 'Add a Slack question first.'; status.className = 'status error'; return; } const button = document.getElementById('researchSlack'); button.disabled = true; evidence.className = 'evidence'; status.textContent = 'Searching accessible Slack context...'; status.className = 'status'; try { const data = await api('/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, person: document.getElementById('slackPerson').value.trim(), fromDate: document.getElementById('slackFrom').value, toDate: document.getElementById('slackTo').value }) }); evidence.innerHTML = '<strong></strong><ol></ol>'; evidence.querySelector('strong').textContent = data.summary || 'Slack search complete.'; const list = evidence.querySelector('ol'); (data.sources || []).forEach((source) => { const item = document.createElement('li'); const link = document.createElement('a'); link.href = source.url || '#'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = source.title || 'Slack evidence'; const meta = document.createElement('span'); meta.textContent = ' ' + [source.author, source.publishedDate ? source.publishedDate.slice(0, 10) : '', source.snippet ? source.snippet.slice(0, 160) : ''].filter(Boolean).join(' | '); item.append(link, meta); list.appendChild(item); }); if (!list.children.length) { const item = document.createElement('li'); item.textContent = data.unavailableReason || 'No accessible Slack evidence matched.'; list.appendChild(item); } evidence.className = 'evidence visible'; status.textContent = 'Slack evidence ready.'; status.className = 'status ok'; } catch (error) { status.textContent = error.message; status.className = 'status error'; } finally { button.disabled = false; } });
    document.getElementById('studioForm').addEventListener('submit', async (event) => { event.preventDefault(); if (!uploads.data.length) { status.textContent = 'Upload at least one CSV or XLSX file first.'; status.className = 'status error'; return; } const button = document.getElementById('generate'); button.disabled = true; status.textContent = 'Profiling data, computing charts, and creating your deck...'; status.className = 'status'; result.className = 'result'; try { const data = await api('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.getElementById('title').value.trim(), prompt: document.getElementById('prompt').value.trim(), slideCount: Number(document.getElementById('slideCount').value), brandStyle: document.getElementById('style').value, fileIds: uploads.data.map((file) => file.id), templateFileId: uploads.template?.id, slackResearch: { query: document.getElementById('slackQuery').value.trim(), person: document.getElementById('slackPerson').value.trim(), fromDate: document.getElementById('slackFrom').value, toDate: document.getElementById('slackTo').value } }) }); result.innerHTML = '<strong></strong><a target="_blank" rel="noopener">Open deck</a><a target="_blank" rel="noopener">Open editor</a>'; result.querySelector('strong').textContent = data.title + ' is ready.'; result.querySelectorAll('a')[0].href = data.publicUrl; result.querySelectorAll('a')[1].href = data.editorUrl; result.className = 'result visible'; status.textContent = 'Deck created with source-backed data slides.'; status.className = 'status ok'; } catch (error) { status.textContent = error.message; status.className = 'status error'; } finally { button.disabled = false; } });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
