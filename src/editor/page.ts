export function renderEditorPage(deckId: string): string {
  const safeDeckId = escapeHtml(deckId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Deck Playground | PioltPPT</title>
  <style>
    :root { --bg: #f4f6f3; --panel: #ffffff; --ink: #17201d; --muted: #66716b; --line: #d7ddda; --accent: #087f5b; --accent-2: #d97706; --code: #111615; --code-ink: #e9efeb; --chip: #edf4f0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    body { height: 100vh; overflow: hidden; }
    button, textarea, input, select { font: inherit; }
    button, .button-link { border: 1px solid var(--line); background: var(--panel); color: var(--ink); min-height: 38px; padding: 0 14px; font-weight: 750; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    button:hover, .button-link:hover { border-color: var(--accent); color: var(--accent); }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.primary:hover { background: #066c4d; color: #fff; }
    button:disabled { cursor: wait; opacity: .6; }
    .app { --preview-pane: 57%; --navigator-pane: 230px; height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 58px; padding: 10px 18px; border-bottom: 1px solid var(--line); background: var(--panel); }
    .identity { min-width: 0; display: flex; align-items: baseline; gap: 14px; }
    .brand { font-weight: 850; font-size: 18px; white-space: nowrap; }
    .deck-id { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .status { min-width: 92px; color: var(--muted); font-size: 13px; text-align: right; }
    main { min-height: 0; display: grid; grid-template-columns: minmax(360px, var(--preview-pane)) 8px minmax(420px, 1fr); }
    .preview { min-width: 0; min-height: 0; padding: 14px; border-right: 1px solid var(--line); }
    .splitter { min-width: 8px; min-height: 8px; background: #cdd5d1; position: relative; z-index: 6; touch-action: none; }
    .splitter:hover, .splitter.dragging { background: var(--accent); }
    .splitter.vertical { cursor: col-resize; }
    .splitter.horizontal { cursor: row-resize; display: none; }
    .splitter::after { content: ""; position: absolute; inset: 0; margin: auto; background: rgba(255,255,255,.75); }
    .splitter.vertical::after { width: 2px; height: 42px; }
    .splitter.horizontal::after { width: 42px; height: 2px; }
    iframe { width: 100%; height: 100%; border: 1px solid var(--line); background: #fff; }
    .workspace { min-width: 0; min-height: 0; display: grid; grid-template-rows: 46px minmax(0, 1fr); background: var(--panel); }
    .tabs { display: flex; align-items: end; gap: 4px; padding: 0 12px; border-bottom: 1px solid var(--line); }
    .tab { border: 0; border-bottom: 3px solid transparent; height: 46px; padding: 0 16px; }
    .tab.active { border-bottom-color: var(--accent); color: var(--accent); }
    .pane { min-height: 0; display: none; }
    .pane.active { display: grid; }
    #codePane { grid-template-columns: minmax(240px, 1fr) 8px minmax(170px, var(--navigator-pane)); grid-template-rows: minmax(0, 1fr) 34px; background: var(--code); }
    .code-wrap { min-width: 0; min-height: 0; position: relative; }
    #code { width: 100%; height: 100%; resize: none; border: 0; outline: 0; padding: 18px; background: var(--code); color: var(--code-ink); font: 13px/1.55 "Cascadia Code", Consolas, monospace; tab-size: 2; white-space: pre; overflow: auto; }
    #code::selection { background: rgba(217, 119, 6, .45); }
    .navigator { min-height: 0; overflow: auto; border-left: 1px solid #303735; background: #161d1b; color: #d8e1dc; padding: 12px; }
    .navigator h3 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; color: #9fb0a8; }
    .nav-group { margin-bottom: 14px; }
    .nav-item { width: 100%; height: auto; min-height: 32px; justify-content: flex-start; text-align: left; padding: 7px 8px; margin: 0 0 6px; border-color: #34403c; background: #111615; color: #e9efeb; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
    .nav-item small { display: block; color: #98a7a0; font-weight: 550; margin-top: 2px; }
    .code-meta { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-top: 1px solid #303735; color: #aab5af; font-size: 12px; }
    #chatPane { grid-template-rows: minmax(0, 1fr) auto; }
    .messages { min-height: 0; overflow: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .message { max-width: 88%; padding: 11px 13px; border-left: 3px solid var(--line); background: var(--bg); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
    .message.user { align-self: flex-end; border-left-color: var(--accent-2); }
    .message.assistant { align-self: flex-start; border-left-color: var(--accent); }
    .composer { border-top: 1px solid var(--line); padding: 12px; display: grid; gap: 8px; }
    .chat-tools { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; flex-wrap: wrap; }
    .chat-tools input[type="number"] { width: 64px; height: 34px; border: 1px solid var(--line); padding: 0 8px; }
    .prompt-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
    #instruction { width: 100%; min-height: 82px; max-height: 180px; resize: vertical; border: 1px solid var(--line); padding: 10px; outline: none; }
    #instruction:focus { border-color: var(--accent); }
    .fatal { height: 100%; display: grid; place-items: center; padding: 28px; color: #9f1239; text-align: center; font-weight: 750; line-height: 1.4; }
    @media (max-width: 1050px) {
      body { overflow: auto; }
      .app { min-height: 100vh; height: auto; grid-template-rows: auto auto; }
      header { flex-wrap: wrap; padding: 10px 12px; }
      main { grid-template-columns: 1fr; grid-template-rows: 50vh 8px 76vh; }
      .preview { border-right: 0; border-bottom: 1px solid var(--line); padding: 8px; }
      .splitter.vertical { cursor: row-resize; }
      .splitter.vertical::after { width: 42px; height: 2px; }
      .workspace { min-height: 76vh; }
      .status { display: none; }
    }
    @media (max-width: 680px) {
      .identity { width: 100%; }
      .actions { width: 100%; justify-content: stretch; }
      .actions > * { flex: 1 1 auto; }
      #codePane { grid-template-columns: 1fr; grid-template-rows: 42% 8px minmax(0, 1fr) 34px; }
      .navigator { border-left: 0; border-top: 1px solid #303735; }
      #codePane .splitter { cursor: row-resize; }
      #codePane .splitter::after { width: 42px; height: 2px; }
      .prompt-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="identity"><span class="brand">Deck Playground</span><span class="deck-id">${safeDeckId}</span></div>
      <div class="actions"><span class="status" id="status">Loading</span><a class="button-link" id="openDeck" target="_blank" rel="noopener">Open deck</a><button id="save">Save draft</button><button class="primary" id="publish">Finish editing</button></div>
    </header>
    <main>
      <section class="preview"><iframe id="preview" title="Deck preview" sandbox="allow-scripts allow-popups"></iframe></section>
      <div class="splitter vertical" id="mainSplitter" role="separator" aria-label="Resize preview and editor panes"></div>
      <section class="workspace">
        <div class="tabs"><button class="tab active" data-pane="codePane">HTML</button><button class="tab" data-pane="chatPane">AI assistant</button></div>
        <div class="pane active" id="codePane">
          <div class="code-wrap"><textarea id="code" spellcheck="false" aria-label="Deck HTML source"></textarea></div>
          <div class="splitter vertical" id="navSplitter" role="separator" aria-label="Resize source and navigator panes"></div>
          <aside class="navigator" aria-label="Source navigator">
            <div class="nav-group"><h3>Headings</h3><div id="headingNav"></div></div>
            <div class="nav-group"><h3>Paragraphs</h3><div id="paragraphNav"></div></div>
            <div class="nav-group"><h3>Image sources</h3><div id="imageNav"></div></div>
          </aside>
          <div class="code-meta"><span>index.html</span><span id="size"></span></div>
        </div>
        <div class="pane" id="chatPane"><div class="messages" id="messages"></div><div class="composer"><div class="chat-tools"><span>Slide</span><input id="imageSlide" type="number" min="1" value="2" aria-label="Image slide number" /><input id="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden /><button id="uploadImage">Upload image</button></div><div class="prompt-row"><textarea id="instruction" placeholder="Examples: make slide 2 more concise, move the image to the left, replace slide 3 image with https://..."></textarea><button class="primary" id="apply">Apply</button></div></div></div>
      </section>
    </main>
  </div>
  <script>
    const deckId = ${JSON.stringify(deckId)};
    const fragment = new URLSearchParams(location.hash.slice(1));
    const storageKey = 'pioltppt-editor-' + deckId;
    const token = fragment.get('token') || sessionStorage.getItem(storageKey) || '';
    if (token) sessionStorage.setItem(storageKey, token);
    const code = document.getElementById('code');
    const preview = document.getElementById('preview');
    const status = document.getElementById('status');
    const size = document.getElementById('size');
    const messages = document.getElementById('messages');
    let timer;

    function setStatus(text) { status.textContent = text; }
    function tokenQuery() { return '?token=' + encodeURIComponent(token); }
    function refresh() {
      preview.srcdoc = code.value;
      size.textContent = Math.max(1, Math.round(new Blob([code.value]).size / 1024)) + ' KB';
      rebuildNavigator();
    }
    function addMessage(role, text) {
      const node = document.createElement('div');
      node.className = 'message ' + role;
      node.textContent = text;
      messages.appendChild(node);
      messages.scrollTop = messages.scrollHeight;
    }
    async function api(path, options = {}) {
      const controller = new AbortController();
      const timeoutMs = path === '/ai' ? 120000 : 18000;
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch('/api/editor/' + encodeURIComponent(deckId) + path + tokenQuery(), {
          ...options,
          signal: controller.signal,
          headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Request failed');
        return data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error(path === '/ai' ? 'The AI edit is taking too long. Try a smaller slide-specific prompt.' : 'The editor API did not respond. Restart npm run dev and keep ngrok pointed at the same port.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    async function load() {
      if (!token) throw new Error('This editor link is missing its access token. Open it again from Slack.');
      const publicPath = '/decks/' + encodeURIComponent(deckId) + '/index.html';
      const response = await fetch(publicPath, { cache: 'no-store' });
      if (!response.ok) throw new Error('The published deck HTML could not be loaded.');
      code.value = await response.text();
      document.getElementById('openDeck').href = '/decks/' + encodeURIComponent(deckId) + '/';
      refresh();
      setStatus('Ready');
    }
    function plainText(value) {
      const doc = new DOMParser().parseFromString('<div>' + value + '</div>', 'text/html');
      return (doc.body.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    function findLineAndColumn(needle) {
      const index = code.value.indexOf(needle);
      if (index < 0) return { line: 1, start: 0, end: 0 };
      const before = code.value.slice(0, index);
      return { line: before.split('\\n').length, start: index, end: index + needle.length };
    }
    function selectSource(start, end) {
      code.focus();
      code.setSelectionRange(start, end);
      const lineHeight = 20;
      const line = code.value.slice(0, start).split('\\n').length;
      code.scrollTop = Math.max(0, (line - 6) * lineHeight);
    }
    function addNavButton(container, label, detail, needle) {
      const match = findLineAndColumn(needle);
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.innerHTML = '<span></span><small></small>';
      button.querySelector('span').textContent = label || 'Untitled';
      button.querySelector('small').textContent = 'Line ' + match.line + (detail ? ' - ' + detail : '');
      button.addEventListener('click', () => selectSource(match.start, match.end));
      container.appendChild(button);
    }
    function rebuildNavigator() {
      const headingNav = document.getElementById('headingNav');
      const paragraphNav = document.getElementById('paragraphNav');
      const imageNav = document.getElementById('imageNav');
      headingNav.textContent = '';
      paragraphNav.textContent = '';
      imageNav.textContent = '';
      const html = code.value;
      for (const match of html.matchAll(/<h[12][^>]*>([\\s\\S]*?)<\\/h[12]>/gi)) {
        addNavButton(headingNav, plainText(match[1]).slice(0, 70), 'heading', match[0]);
      }
      for (const match of html.matchAll(/<(?:p|li)[^>]*>([\\s\\S]*?)<\\/(?:p|li)>/gi)) {
        const text = plainText(match[1]);
        if (text) addNavButton(paragraphNav, text.slice(0, 86), 'text', match[0]);
      }
      for (const match of html.matchAll(/<img\\b[^>]*\\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        addNavButton(imageNav, match[1].slice(0, 86), 'image URL', match[1]);
      }
      if (!headingNav.children.length) headingNav.textContent = 'No headings found.';
      if (!paragraphNav.children.length) paragraphNav.textContent = 'No paragraph text found.';
      if (!imageNav.children.length) imageNav.textContent = 'No image URLs found.';
    }
    function setSlideImage(documentCopy, slideNumber, imageUrl, altText) {
      const slide = documentCopy.querySelectorAll('.slide')[slideNumber - 1];
      if (!slide) throw new Error('That slide number does not exist.');
      slide.querySelector('.visual')?.remove();
      slide.classList.remove('visual-left', 'visual-background', 'visual-full');
      slide.classList.add('has-visual', 'visual-right');
      const figure = documentCopy.createElement('figure');
      figure.className = 'visual';
      const img = documentCopy.createElement('img');
      img.src = imageUrl;
      img.alt = altText;
      img.loading = 'lazy';
      figure.appendChild(img);
      slide.appendChild(figure);
    }
    code.addEventListener('input', () => {
      setStatus('Unsaved');
      clearTimeout(timer);
      timer = setTimeout(refresh, 350);
    });
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      document.querySelectorAll('.pane').forEach((pane) => pane.classList.toggle('active', pane.id === tab.dataset.pane));
    }));
    function makeSplitter(splitter, onMove) {
      let dragging = false;
      splitter.addEventListener('pointerdown', (event) => {
        dragging = true;
        splitter.classList.add('dragging');
        splitter.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      splitter.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        onMove(event);
      });
      function stop() {
        dragging = false;
        splitter.classList.remove('dragging');
      }
      splitter.addEventListener('pointerup', stop);
      splitter.addEventListener('pointercancel', stop);
    }
    makeSplitter(document.getElementById('mainSplitter'), (event) => {
      const isStacked = matchMedia('(max-width: 1050px)').matches;
      const app = document.querySelector('.app');
      const rect = document.querySelector('main').getBoundingClientRect();
      if (isStacked) {
        const percent = Math.min(72, Math.max(28, ((event.clientY - rect.top) / rect.height) * 100));
        document.querySelector('main').style.gridTemplateRows = percent + 'vh 8px ' + Math.max(56, 118 - percent) + 'vh';
      } else {
        const percent = Math.min(74, Math.max(32, ((event.clientX - rect.left) / rect.width) * 100));
        app.style.setProperty('--preview-pane', percent + '%');
      }
    });
    makeSplitter(document.getElementById('navSplitter'), (event) => {
      const isStacked = matchMedia('(max-width: 680px)').matches;
      const pane = document.getElementById('codePane');
      const rect = pane.getBoundingClientRect();
      if (isStacked) {
        const percent = Math.min(68, Math.max(26, ((event.clientY - rect.top) / rect.height) * 100));
        pane.style.gridTemplateRows = percent + '% 8px minmax(0, 1fr) 34px';
      } else {
        const width = Math.min(420, Math.max(170, rect.right - event.clientX));
        document.querySelector('.app').style.setProperty('--navigator-pane', width + 'px');
      }
    });
    document.getElementById('save').addEventListener('click', async () => {
      setStatus('Saving');
      try { await api('/save', { method: 'POST', body: JSON.stringify({ html: code.value }) }); setStatus('Draft saved'); }
      catch (error) { setStatus('Save failed'); addMessage('assistant', error.message); }
    });
    document.getElementById('apply').addEventListener('click', async () => {
      const instruction = document.getElementById('instruction');
      const prompt = instruction.value.trim();
      if (!prompt) return;
      addMessage('user', prompt);
      instruction.value = '';
      setStatus('AI editing');
      document.getElementById('apply').disabled = true;
      try {
        const data = await api('/ai', { method: 'POST', body: JSON.stringify({ html: code.value, instruction: prompt }) });
        code.value = data.html;
        refresh();
        addMessage('assistant', data.summary || 'The requested change is ready in the preview.');
        setStatus('Unsaved');
      } catch (error) { addMessage('assistant', error.message); setStatus('AI failed'); }
      finally { document.getElementById('apply').disabled = false; }
    });
    document.getElementById('uploadImage').addEventListener('click', () => document.getElementById('imageFile').click());
    document.getElementById('imageFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const slideNumber = Number(document.getElementById('imageSlide').value);
      setStatus('Uploading image');
      try {
        const response = await fetch('/api/editor/' + encodeURIComponent(deckId) + '/upload' + tokenQuery(), {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Image upload failed');
        const documentCopy = new DOMParser().parseFromString(code.value, 'text/html');
        setSlideImage(documentCopy, slideNumber, data.url, file.name.replace(/\\.[^.]+$/, ''));
        code.value = '<!doctype html>\\n' + documentCopy.documentElement.outerHTML;
        refresh();
        await api('/save', { method: 'POST', body: JSON.stringify({ html: code.value }) });
        addMessage('assistant', 'Image added to slide ' + slideNumber + ' and saved in the draft.');
        setStatus('Draft saved');
      } catch (error) { addMessage('assistant', error.message); setStatus('Upload failed'); }
      finally { event.target.value = ''; }
    });
    document.getElementById('publish').addEventListener('click', async () => {
      setStatus('Publishing');
      document.getElementById('publish').disabled = true;
      try {
        const data = await api('/publish', { method: 'POST', body: JSON.stringify({ html: code.value }) });
        setStatus(data.notified ? 'Published to Slack' : 'Published');
        window.open(data.publicUrl, '_blank', 'noopener');
      } catch (error) { addMessage('assistant', error.message); setStatus('Publish failed'); }
      finally { document.getElementById('publish').disabled = false; }
    });
    load().catch((error) => { document.querySelector('main').innerHTML = '<div class="fatal"></div>'; document.querySelector('.fatal').textContent = error.message; setStatus('Unavailable'); });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
