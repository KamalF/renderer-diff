// Mermaid is about 5 MB, ten times the plugin. Gerrit loads plugins on each
// page, so Mermaid is a separate file in the static/ directory of the Gerrit
// site, which the pane fetches only when a file has a diagram.
//
// Mermaid lets HTML in labels through (remote images, forms), and it
// renders into the document to measure the diagram. So each diagram renders
// in its own sandboxed iframe: an opaque origin without access to the Gerrit
// page or its cookies, no form submission, no navigation of the page, and a
// Content-Security-Policy that blocks all requests.

declare global {
  interface Window {
    CANONICAL_PATH?: string;
  }
}

/** Markdown fences, AsciiDoc [source,mermaid] and AsciiDoc [mermaid] blocks. */
const SELECTOR = 'code.language-mermaid, .mermaid pre';

const CONFIG = {
  startOnLoad: false,
  // Without this, Mermaid adds an error image to the page body.
  suppressErrorRendering: true,
  // Strict: no click handlers, and Mermaid sanitizes the labels.
  securityLevel: 'strict',
  // A diagram can change its configuration with an init directive. These
  // keys stay as set here.
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'suppressErrorRendering',
    'maxTextSize',
    'maxEdges',
    'themeCSS',
    'themeVariables',
    'fontFamily',
    'altFontFamily',
  ],
};

interface FrameMessage {
  rendererDiff: true;
  key: string;
  height?: number;
  error?: string;
}

// One listener for all frames. The key is the window of a frame, so that an
// entry goes away with its frame.
const handlers = new WeakMap<object, (message: FrameMessage) => void>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent<FrameMessage>) => {
    if (!event.source || !event.data?.rendererDiff) return;
    handlers.get(event.source)?.(event.data);
  });
}

// A sandboxed frame has an opaque origin, and the browser does not use its
// HTTP cache for it: each frame would download the 5 MB again. So the pane
// fetches mermaid.min.js once (same origin, cached) and puts it inline in
// each frame, which then makes no request at all.
let mermaidScript: Promise<string> | undefined;

function loadMermaid(): Promise<string> {
  if (!mermaidScript) {
    const url = `${window.CANONICAL_PATH ?? ''}/static/mermaid.min.js`;
    mermaidScript = fetch(url).then(async response => {
      if (!response.ok) {
        throw new Error(`cannot load ${url}: HTTP ${response.status}`);
      }
      const script = await response.text();
      // "<script" or "</script" in the text would end the inline element.
      if (/<\/?script/i.test(script)) {
        throw new Error(`cannot put ${url} inline`);
      }
      return script;
    });
    // Try again for the next file.
    mermaidScript.catch(() => (mermaidScript = undefined));
  }
  return mermaidScript;
}

// JSON in a <script> element: escape "<" so that "</script>" in a diagram
// cannot end the element.
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function frameDocument(source: string, script: string, key: string): string {
  const nonce = crypto.randomUUID();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
  ].join('; ');
  return `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html, body { margin: 0; overflow: hidden; }</style>
<script nonce="${nonce}">${script}</script>
</head><body>
<script nonce="${nonce}">
const post = message => parent.postMessage({rendererDiff: true, key: ${scriptJson(key)}, ...message}, '*');
if (!window.mermaid) {
  post({error: 'cannot run mermaid.min.js'});
} else {
  mermaid.initialize(${scriptJson(CONFIG)});
  mermaid.render('diagram', ${scriptJson(source)}).then(({svg}) => {
    document.body.innerHTML = svg;
    // A link (<a>, <area>) would load another page in the frame, inside the
    // Gerrit page. Remove each link target. Keep the elements: an <a> can
    // carry the position of a node.
    for (const element of document.querySelectorAll('*')) {
      element.removeAttribute('href');
      element.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }
    const report = () => post({height: document.documentElement.scrollHeight});
    new ResizeObserver(report).observe(document.body);
  }, error => post({error: String((error && error.message) || error)}));
}
</script>
</body></html>`;
}

function addError(element: Element, error: unknown) {
  const message = document.createElement('div');
  message.className = 'message';
  message.textContent = `Cannot render the diagram: ${error}`;
  element.after(message);
}

/** Replaces each Mermaid block in `root` with its diagram. */
export async function renderDiagrams(root: ParentNode) {
  const sources = [...root.querySelectorAll<HTMLElement>(SELECTOR)];
  if (!sources.length) return;
  let script: string;
  try {
    script = await loadMermaid();
  } catch (e) {
    for (const source of sources) addError(source.closest('pre') ?? source, e);
    return;
  }
  listen();
  for (const source of sources) {
    const pre = source.closest('pre') ?? source;
    // The pane can show another file while the script loads.
    if (!pre.isConnected) continue;
    const frame = document.createElement('iframe');
    frame.className = 'mermaid-diagram';
    frame.setAttribute('sandbox', 'allow-scripts');
    // A page that the frame loads instead of its own document does not know
    // the key, so it cannot resize the frame or send an error.
    const key = crypto.randomUUID();
    frame.srcdoc = frameDocument(source.textContent ?? '', script, key);
    // A diagram has nothing to click, and a click is the way to make the
    // frame load another page. Keep the frame out of the tab order too.
    frame.style.pointerEvents = 'none';
    frame.tabIndex = -1;
    // Not hidden: Mermaid measures text, which fails in a frame that the
    // browser does not render (display: none) in some browsers.
    frame.style.height = '0';
    // In Markdown, the source lines are on the code element, and so is the
    // mark of added lines if the pane set it before the frame existed.
    for (const name of ['data-line-start', 'data-line-end', 'data-added']) {
      const value = source.getAttribute(name);
      if (value !== null) frame.setAttribute(name, value);
    }
    pre.after(frame);
    const frameWindow = frame.contentWindow!;
    // Shows the error in place of the frame, and of the code block if it is
    // still there.
    const fail = (error: string) => {
      handlers.delete(frameWindow);
      addError(frame, error);
      frame.remove();
    };
    handlers.set(frameWindow, message => {
      if (message.key !== key) return;
      if (message.error !== undefined) {
        fail(message.error);
      } else if (message.height !== undefined) {
        frame.style.height = `${message.height}px`;
        pre.remove();
      }
    });
    // The frame loads its own document once. Another load means that the
    // diagram made the frame load a page, by a way that the link strip in
    // the frame missed. Remove the frame with that page.
    let loads = 0;
    frame.addEventListener('load', () => {
      if (++loads > 1) fail('the diagram tried to load another page');
    });
  }
}
