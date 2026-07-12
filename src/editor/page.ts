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
    .nav-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: start; margin: 0 0 6px; border: 1px solid #34403c; background: #111615; }
    .nav-select { min-width: 0; min-height: 48px; height: auto; justify-content: flex-start; text-align: left; padding: 7px 8px; border: 0; background: transparent; color: #e9efeb; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
    .nav-select small { display: block; color: #98a7a0; font-weight: 550; margin-top: 2px; }
    .nav-edit { min-width: 38px; min-height: 32px; margin: 7px 7px 0 0; padding: 0 8px; border-color: #405049; background: #1d2723; color: #bfe2d3; font-size: 12px; }
    .code-meta { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-top: 1px solid #303735; color: #aab5af; font-size: 12px; }
    #chatPane { grid-template-rows: minmax(0, 1fr) auto; }
    #designPane { align-content: start; overflow: auto; padding: 18px; background: #f8faf8; }
    .toolbox { width: min(760px, 100%); display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .toolbox h2 { grid-column: 1 / -1; margin: 0 0 2px; font-size: 18px; }
    .toolbox p { grid-column: 1 / -1; margin: -4px 0 4px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .field { display: grid; gap: 6px; color: #405049; font-size: 13px; font-weight: 750; }
    .field input, .field select { width: 100%; min-height: 38px; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 0 10px; }
    .field input[type="color"] { padding: 3px; }
    .tool-actions { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
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
    dialog { width: min(560px, calc(100vw - 30px)); border: 1px solid var(--line); padding: 0; box-shadow: 0 20px 55px rgba(18, 31, 25, .25); }
    dialog::backdrop { background: rgba(10, 18, 14, .48); }
    .quick-edit { display: grid; gap: 14px; padding: 18px; }
    .quick-edit h2 { margin: 0; font-size: 18px; }
    .quick-edit textarea { width: 100%; min-height: 130px; resize: vertical; padding: 10px; border: 1px solid var(--line); font: 14px/1.45 "Cascadia Code", Consolas, monospace; }
    .quick-edit footer { display: flex; justify-content: flex-end; gap: 8px; }
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
        <div class="tabs"><button class="tab active" data-pane="codePane">HTML</button><button class="tab" data-pane="chatPane">AI assistant</button><button class="tab" data-pane="designPane">Design</button></div>
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
        <div class="pane" id="chatPane"><div class="messages" id="messages"></div><div class="composer"><div class="chat-tools"><span>Slide</span><input id="imageSlide" type="number" min="1" value="2" aria-label="Image slide number" /><input id="imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden /><button id="uploadImage">Upload image</button></div><div class="prompt-row"><textarea id="instruction" placeholder="Examples: turn slide 2 bullets into one paragraph, redesign slide 3 as a clean executive slide, or add an image URL to slide 2."></textarea><button class="primary" id="apply">Apply</button></div></div></div>
        <div class="pane" id="designPane"><div class="toolbox"><h2>Slide design</h2><p>Change one slide directly. These controls update the HTML source and preview immediately.</p><label class="field">Slide number<input id="designSlide" type="number" min="1" value="1" /></label><label class="field">Font family<select id="designFont"><option value="Inter, ui-sans-serif, system-ui, sans-serif">Sans serif</option><option value="Georgia, serif">Serif</option><option value="Arial, sans-serif">Arial</option><option value="Trebuchet MS, sans-serif">Trebuchet</option></select></label><label class="field">Text size (px)<input id="designSize" type="number" min="16" max="80" value="28" /></label><label class="field">Text color<input id="designTextColor" type="color" value="#17201d" /></label><label class="field">Slide background<input id="designBackground" type="color" value="#f4f6f3" /></label><label class="field">Transition<select id="designTransition"><option value="fade">Fade</option><option value="slide">Slide</option><option value="zoom">Zoom</option><option value="none">None</option></select></label><label class="field" style="grid-column: 1 / -1;">Image URL<input id="designImageUrl" type="url" placeholder="https://example.com/image.jpg" /></label><label class="field">Image position<select id="designImagePlacement"><option value="right">Right</option><option value="left">Left</option><option value="full">Full width</option><option value="background">Background</option></select></label><div class="tool-actions"><button id="clearImage" type="button">Remove image</button><button class="primary" id="applyDesign" type="button">Apply design</button></div></div></div>
      </section>
    </main>
  </div>
  <dialog id="quickEdit"><form class="quick-edit" method="dialog"><h2 id="quickEditTitle">Edit item</h2><textarea id="quickEditValue" aria-label="Editable value"></textarea><footer><button value="cancel">Cancel</button><button class="primary" id="quickEditSave" value="default">Apply change</button></footer></form></dialog>
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
    const quickEdit = document.getElementById('quickEdit');
    const quickEditTitle = document.getElementById('quickEditTitle');
    const quickEditValue = document.getElementById('quickEditValue');
    let inlineEdit;
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
      const timeoutMs = path === '/ai' ? 70000 : 18000;
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
        if (error.name === 'AbortError') throw new Error(path === '/ai' ? 'The AI provider did not return an edit in time. Try again; your draft has not been changed.' : 'The editor API did not respond. Restart npm run dev and keep ngrok pointed at the same port.');
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    async function load() {
      if (!token) throw new Error('This editor link is missing its access token. Open it again from Slack.');
      const source = await api('/source');
      code.value = source.html;
      document.getElementById('openDeck').href = source.publicUrl || '/decks/' + encodeURIComponent(deckId) + '/';
      refresh();
      setStatus(source.isDraft ? 'Draft loaded' : 'Ready');
    }
    function plainText(value) {
      const doc = new DOMParser().parseFromString('<div>' + value + '</div>', 'text/html');
      return (doc.body.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    function lineForIndex(index) { return code.value.slice(0, index).split('\\n').length; }
    function selectSource(start, end) {
      code.focus();
      code.setSelectionRange(start, end);
      const lineHeight = 20;
      const line = lineForIndex(start);
      code.scrollTop = Math.max(0, (line - 6) * lineHeight);
    }
    function openInlineEditor(label, value, start, end, type) {
      inlineEdit = { start, end, type };
      quickEditTitle.textContent = 'Edit ' + label;
      quickEditValue.value = value;
      quickEdit.showModal();
      setTimeout(() => quickEditValue.focus(), 0);
    }
    function escapeText(value) {
      const holder = document.createElement('div');
      holder.textContent = value;
      return holder.innerHTML;
    }
    function addNavButton(container, label, detail, start, end, value, type) {
      const wrapper = document.createElement('div');
      wrapper.className = 'nav-item';
      const selectButton = document.createElement('button');
      selectButton.className = 'nav-select';
      selectButton.innerHTML = '<span></span><small></small>';
      selectButton.querySelector('span').textContent = label || 'Untitled';
      selectButton.querySelector('small').textContent = 'Line ' + lineForIndex(start) + (detail ? ' - ' + detail : '');
      selectButton.addEventListener('click', () => selectSource(start, end));
      const editButton = document.createElement('button');
      editButton.className = 'nav-edit';
      editButton.type = 'button';
      editButton.textContent = 'Edit';
      editButton.title = 'Edit this item';
      editButton.addEventListener('click', () => openInlineEditor(detail || 'item', value, start, end, type));
      wrapper.append(selectButton, editButton);
      container.appendChild(wrapper);
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
        const value = plainText(match[1]);
        const start = (match.index || 0) + match[0].indexOf(match[1]);
        addNavButton(headingNav, value.slice(0, 70), 'heading', start, start + match[1].length, value, 'text');
      }
      for (const match of html.matchAll(/<(?:p|li)[^>]*>([\\s\\S]*?)<\\/(?:p|li)>/gi)) {
        const text = plainText(match[1]);
        if (text) {
          const start = (match.index || 0) + match[0].indexOf(match[1]);
          addNavButton(paragraphNav, text.slice(0, 86), 'text', start, start + match[1].length, text, 'text');
        }
      }
      for (const match of html.matchAll(/<img\\b[^>]*\\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        const start = (match.index || 0) + match[0].indexOf(match[1]);
        addNavButton(imageNav, match[1].slice(0, 86), 'image URL', start, start + match[1].length, match[1], 'url');
      }
      if (!headingNav.children.length) headingNav.textContent = 'No headings found.';
      if (!paragraphNav.children.length) paragraphNav.textContent = 'No paragraph text found.';
      if (!imageNav.children.length) imageNav.textContent = 'No image URLs found.';
    }
    document.getElementById('quickEditSave').addEventListener('click', () => {
      if (!inlineEdit) return;
      const value = quickEditValue.value.trim();
      if (!value) return;
      const replacement = inlineEdit.type === 'url' ? value.replace(/"/g, '&quot;') : escapeText(value);
      code.value = code.value.slice(0, inlineEdit.start) + replacement + code.value.slice(inlineEdit.end);
      inlineEdit = undefined;
      refresh();
      setStatus('Unsaved');
    });
    function setSlideImage(documentCopy, slideNumber, imageUrl, altText, placement = 'right') {
      const slide = documentCopy.querySelectorAll('.slide')[slideNumber - 1];
      if (!slide) throw new Error('That slide number does not exist.');
      slide.querySelector('.visual')?.remove();
      slide.classList.remove('visual-left', 'visual-right', 'visual-background', 'visual-full');
      slide.classList.add('has-visual', placement === 'right' ? 'visual-right' : 'visual-' + placement);
      if (placement === 'right' || placement === 'left') {
        slide.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(220px, .48fr)';
        slide.style.gridTemplateRows = 'minmax(0, 1fr)';
        slide.style.alignItems = 'center';
      }
      const figure = documentCopy.createElement('figure');
      figure.className = 'visual visual-contain visual-embedded';
      figure.style.height = 'min(52vh, 440px)';
      figure.style.maxHeight = '440px';
      figure.style.border = '0';
      figure.style.background = 'transparent';
      const img = documentCopy.createElement('img');
      img.src = imageUrl;
      img.alt = altText;
      img.loading = 'lazy';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.style.objectPosition = 'center';
      img.style.padding = '0';
      img.style.background = 'transparent';
      figure.appendChild(img);
      slide.appendChild(figure);
    }
    function selectedSlide(documentCopy) {
      const slideNumber = Number(document.getElementById('designSlide').value);
      const slide = documentCopy.querySelectorAll('.slide')[slideNumber - 1];
      if (!slide) throw new Error('That slide number does not exist.');
      return { slide, slideNumber };
    }
    function applyDesign() {
      const documentCopy = new DOMParser().parseFromString(code.value, 'text/html');
      const { slide, slideNumber } = selectedSlide(documentCopy);
      const font = document.getElementById('designFont').value;
      const fontSize = Math.max(16, Math.min(80, Number(document.getElementById('designSize').value) || 28));
      const textColor = document.getElementById('designTextColor').value;
      const background = document.getElementById('designBackground').value;
      const transition = document.getElementById('designTransition').value;
      const imageUrl = document.getElementById('designImageUrl').value.trim();
      const placement = document.getElementById('designImagePlacement').value;
      slide.style.background = background;
      const content = slide.querySelector('.content');
      if (content) {
        content.style.fontFamily = font;
        content.style.color = textColor;
        content.style.fontSize = fontSize + 'px';
      }
      slide.querySelectorAll('h1, h2, p, li').forEach((node) => { node.style.color = textColor; });
      slide.querySelectorAll('h1, h2').forEach((node) => { node.style.fontFamily = font; });
      slide.classList.remove('transition-fade', 'transition-slide', 'transition-zoom', 'transition-none');
      slide.classList.add('transition-' + transition);
      if (imageUrl) setSlideImage(documentCopy, slideNumber, imageUrl, 'Slide ' + slideNumber + ' image', placement);
      code.value = '<!doctype html>\\n' + documentCopy.documentElement.outerHTML;
      refresh();
      setStatus('Unsaved');
      addMessage('assistant', 'Updated slide ' + slideNumber + ' design in the preview.');
    }
    function clearSlideImage() {
      const documentCopy = new DOMParser().parseFromString(code.value, 'text/html');
      const { slide, slideNumber } = selectedSlide(documentCopy);
      slide.querySelector('.visual')?.remove();
      slide.classList.remove('has-visual', 'visual-left', 'visual-right', 'visual-background', 'visual-full');
      slide.style.removeProperty('grid-template-columns');
      slide.style.removeProperty('grid-template-rows');
      slide.style.removeProperty('align-items');
      code.value = '<!doctype html>\\n' + documentCopy.documentElement.outerHTML;
      refresh();
      setStatus('Unsaved');
      addMessage('assistant', 'Removed the image from slide ' + slideNumber + '.');
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
    document.getElementById('applyDesign').addEventListener('click', () => {
      try { applyDesign(); } catch (error) { addMessage('assistant', error.message); setStatus('Design failed'); }
    });
    document.getElementById('clearImage').addEventListener('click', () => {
      try { clearSlideImage(); } catch (error) { addMessage('assistant', error.message); setStatus('Design failed'); }
    });
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
