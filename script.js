/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

/* New: Cloudflare Worker endpoint (all frontend calls go here) */
const WORKER_URL = "https://loreralchatbot2.cuadra33.workers.dev/";
/* New: system instruction included on every request */
const SYSTEM_TEXT = "You are a helpful assistant.";

/* Markdown escape + formatter (simple) */
function escapeHtml(s) {
  return String(s || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        m
      ])
  );
}
function mdToHtml(md) {
  let h = escapeHtml(md || "");
  // bold then italics
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // ordered list lines (merge adjacent)
  h = h.replace(/^\s*\d+\.\s+(.+)$/gm, "<ol><li>$1</li></ol>");
  h = h.replace(/<\/ol>\s*<ol>/g, "");
  // unordered list lines (- or •) (merge adjacent)
  h = h.replace(/^\s*[-•]\s+(.+)$/gm, "<ul><li>$1</li></ul>");
  h = h.replace(/<\/ul>\s*<ul>/g, "");
  // paragraphs / line breaks
  h = h.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  return `<p>${h}</p>`;
}

/* Simple chat bubble adder (assistant gets HTML, user plain text) */
function addChat(role, text) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${
    role === "user" ? "user" : "assistant"
  } bubble-enter`;
  if (role === "assistant") {
    div.innerHTML = mdToHtml(text);
  } else {
    div.innerText = text;
  }
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  requestAnimationFrame(() => {
    div.classList.add("bubble-enter-active");
  });
  div.addEventListener(
    "transitionend",
    () => {
      div.classList.remove("bubble-enter", "bubble-enter-active");
    },
    { once: true }
  );
}

/* Initial greeting (assistant) */
addChat("assistant", "👋 Hello! How can I help you today?");

/* Helper: append a message to the chat window */
// type is 'user' or 'assistant'
// isHtml indicates that `text` is already formatted HTML (assistant responses)
function appendMessage(type, text, isHtml = false) {
  const who = type === "user" ? "You" : "Assistant";

  const wrapper = document.createElement("div");
  wrapper.className = `${type}-message message-enter`;

  if (type === "user") {
    // always escape user input
    wrapper.innerHTML = `<strong>${who}:</strong> ${escapeHtml(text)}`;
  } else {
    // assistant responses can be passed as safe HTML (isHtml = true)
    wrapper.innerHTML = isHtml
      ? `<strong>${who}:</strong> ${text}`
      : `<strong>${who}:</strong> ${escapeHtml(text)}`;
  }

  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  requestAnimationFrame(() => wrapper.classList.add("message-enter-active"));
  wrapper.addEventListener(
    "transitionend",
    () => wrapper.classList.remove("message-enter", "message-enter-active"),
    { once: true }
  );

  return wrapper;
}

/* Helper: convert an HTML string into normalized plain text with list/heading markers */
function htmlToPlain(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const lines = [];

    function walk(node) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const tag = n.tagName.toLowerCase();
          if (tag.match(/^h[1-6]$/)) {
            const text = n.textContent.trim();
            if (text) lines.push(`${text}:`);
            lines.push("");
          } else if (tag === "p") {
            const t = n.textContent.trim();
            if (t) lines.push(t);
          } else if (tag === "li") {
            const parentTag =
              n.parentElement && n.parentElement.tagName.toLowerCase();
            const text = n.textContent.trim();
            if (parentTag === "ol") {
              const idx =
                Array.prototype.indexOf.call(n.parentElement.children, n) + 1;
              lines.push(`${idx}. ${text}`);
            } else {
              lines.push(`- ${text}`);
            }
          } else if (tag === "br") {
            lines.push("");
          } else {
            walk(n);
          }
        } else if (n.nodeType === Node.TEXT_NODE) {
          const t = n.textContent.replace(/\s+/g, " ").trim();
          if (t) lines.push(t);
        }
      });
    }

    walk(doc.body);
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (e) {
    return html;
  }
}

/* Helper: sanitize assistant text but preserve headings and list markers */
function sanitizeAssistantText(text) {
  if (!text || typeof text !== "string") return text;

  // If it looks like HTML, convert to plain text (also decodes entities)
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = htmlToPlain(text);
  } else {
    // decode HTML entities in plain text
    const ta = document.createElement("textarea");
    ta.innerHTML = text;
    text = ta.value;
  }

  // Convert markdown headings "### Face" => "Face:"
  text = text.replace(/^#{1,6}\s*(.+)$/gm, "$1:");

  // Remove fenced code blocks and inline code/backticks
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`+/g, "");

  // Remove markdown emphasis while keeping the words:
  // bold/italic pairs (**text**, __text__, *text*, _text_) and ~~strikethrough~~
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // Clean up any stray emphasis markers that slipped through,
  // but don't touch bullet markers (-) at the start of a line.
  text = text.replace(/(\S)[*_]{1,3}(\s|$)/g, "$1$2"); // word* -> word
  text = text.replace(/(^|\s)[*_]{1,3}(\S)/g, "$1$2"); // *word -> word

  // Convert markdown links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // Normalize common ordered list markers (formatAssistantHTML handles building <ol>)
  // "1) item" or "(1) item" -> "1. item"
  text = text.replace(/^\s*\(?(\d+)\)?[)\.\-]\s+/gm, "$1. ");

  // Normalize line endings and collapse many blank lines
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/* Helper: convert sanitized text into structured HTML with headings, paragraphs and lists */
function formatAssistantHTML(text) {
  if (!text || typeof text !== "string") return "";

  const sanitized = sanitizeAssistantText(text);
  const lines = sanitized.split(/\n/);
  let html = "";
  let inUL = false;
  let inOL = false;
  let paraBuffer = [];

  function flushParagraph() {
    if (paraBuffer.length) {
      html += `<p>${escapeHtml(paraBuffer.join(" "))}</p>`;
      paraBuffer = [];
    }
  }

  const headingLabelRE = /^([A-Za-z][A-Za-z0-9\s]{0,60})\s*:\s*(.*)$/;

  // extra regexes to detect ordered list markers in multiple common formats
  const orderedRE = /^\s*(?:\(?\d+\)?[.)\-\s]+)\s*(.*)$/; // matches "1. ", "1) ", "(1) ", "1 - "
  const olDetectRE = /^\s*\d+\s*[.)\-\s]+/; // simpler ol detection

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\u00A0/g, " ").trim();
    if (!line) {
      flushParagraph();
      if (inUL) {
        html += "</ul>";
        inUL = false;
      }
      if (inOL) {
        html += "</ol>";
        inOL = false;
      }
      return;
    }

    const labelMatch = line.match(headingLabelRE);
    if (labelMatch) {
      flushParagraph();
      if (inUL) {
        html += "</ul>";
        inUL = false;
      }
      if (inOL) {
        html += "</ol>";
        inOL = false;
      }

      const label = labelMatch[1].trim();
      const rest = labelMatch[2].trim();
      html += `<h3>${escapeHtml(label)}</h3>`;
      if (rest) {
        if (/;/.test(rest)) {
          html += "<ul>";
          rest
            .split(";")
            .map((s) => s.trim())
            .forEach((item) => {
              if (item) html += `<li>${escapeHtml(item)}</li>`;
            });
          html += "</ul>";
        } else {
          html += `<p>${escapeHtml(rest)}</p>`;
        }
      }
      return;
    }

    // Unordered list item: "- item" or "* item" or "• item"
    if (/^[-*•]\s+/.test(line)) {
      flushParagraph();
      if (inOL) {
        html += "</ol>";
        inOL = false;
      }
      if (!inUL) {
        html += "<ul>";
        inUL = true;
      }
      html += `<li>${escapeHtml(line.replace(/^[-*•]\s+/, ""))}</li>`;
      return;
    }

    // Ordered list detection supporting variants like "1. ", "1) ", "(1) ", "1 - "
    if (olDetectRE.test(line) || orderedRE.test(line)) {
      flushParagraph();
      if (inUL) {
        html += "</ul>";
        inUL = false;
      }
      if (!inOL) {
        html += "<ol>";
        inOL = true;
      }

      // Remove the numeric prefix in its many forms before adding the <li>
      const cleaned = line.replace(/^\s*\(?(\d+)\)?[.)\-\s]+/, "");
      html += `<li>${escapeHtml(cleaned)}</li>`;
      return;
    }

    // Semicolon-separated lists -> convert into bullet list
    if (/;/.test(line) && line.split(";").length > 1 && line.length < 400) {
      flushParagraph();
      if (inOL) {
        html += "</ol>";
        inOL = false;
      }
      if (!inUL) {
        html += "<ul>";
        inUL = true;
      }
      line
        .split(";")
        .map((s) => s.trim())
        .forEach((item) => {
          if (item) html += `<li>${escapeHtml(item)}</li>`;
        });
      return;
    }

    paraBuffer.push(line);
  });

  flushParagraph();
  if (inUL) html += "</ul>";
  if (inOL) html += "</ol>";

  return html.trim() || `<p>${escapeHtml(text)}</p>`;
}

/* New: single caller that posts only { messages:[...] } and returns { text } */
async function callWorker(body) {
  const r = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {}
  if (!r.ok) return data?.text || data?.error || `Worker error ${r.status}`;
  const t = typeof data?.text === "string" ? data.text.trim() : "";
  return t || "I couldn’t generate that. Please try again.";
}

/* Updated loading bubble to use same animation */
function appendLoading() {
  const id = `loading-${Date.now()}`;
  const wrapper = document.createElement("div");
  wrapper.id = id;
  wrapper.className = "chat-bubble assistant loading bubble-enter";
  wrapper.innerHTML = `<span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  requestAnimationFrame(() => {
    wrapper.classList.add("bubble-enter-active");
  });
  wrapper.addEventListener(
    "transitionend",
    () => {
      wrapper.classList.remove("bubble-enter", "bubble-enter-active");
    },
    { once: true }
  );
  return id;
}

/* Handle form submit: prevent reload, build one payload, call the Worker, render data.text */
chatForm.addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const text = userInput.value.trim();
    if (!text) return;

    addChat("user", text);
    userInput.value = "";

    const loadingId = appendLoading();
    if (sendBtn) sendBtn.disabled = true;

    const payload = {
      messages: [
        { role: "system", content: SYSTEM_TEXT },
        { role: "user", content: text },
      ],
    };

    try {
      const replyText = await callWorker(payload);

      // Remove loading bubble and create a fresh assistant bubble (so entry animation applies)
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) loadingEl.remove();
      addChat("assistant", replyText);
    } catch (err) {
      const loadingEl = document.getElementById(loadingId);
      if (loadingEl) loadingEl.remove();
      addChat("assistant", `Error: ${err.message || err}`);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      userInput.focus();
    }
  },
  { passive: false }
);
