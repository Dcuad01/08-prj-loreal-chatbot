/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// Set initial message as an assistant bubble (use formatted HTML)
appendMessage(
  "assistant",
  formatAssistantHTML("👋 Hello! How can I help you today?"),
  true
);

/* Helper: escape HTML to prevent XSS for user content */
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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

/* Helper: append a loading assistant message (returns id)
   Restores the loading bubble used during API requests so submit() doesn't throw. */
function appendLoading() {
  const id = `loading-${Date.now()}`;
  const wrapper = document.createElement("div");
  wrapper.id = id;
  wrapper.className = "assistant-message loading message-enter";
  // Animated dots (CSS already handles the animation via .dots span)
  wrapper.innerHTML = `<strong>Assistant:</strong> <span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  // trigger entry animation
  requestAnimationFrame(() => wrapper.classList.add("message-enter-active"));
  return id;
}

/* Helper: extract plain text from various OpenAI/Worker response shapes */
function extractAssistantText(data) {
  // 1) Direct string response
  if (typeof data === "string") return data;

  // 2) Chat Completions: choices[0].message.content (string or array)
  const msgContent = data?.choices?.[0]?.message?.content;
  if (typeof msgContent === "string") return msgContent;
  if (Array.isArray(msgContent)) {
    // Items may be strings or objects like {type:'text', text:'...'}
    const parts = msgContent
      .map((p) =>
        typeof p === "string"
          ? p
          : typeof p?.text === "string"
          ? p.text
          : typeof p?.content === "string"
          ? p.content
          : ""
      )
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }

  // 3) Responses API convenience field
  const outputText = data?.output_text;
  if (typeof outputText === "string") return outputText;
  if (Array.isArray(outputText)) {
    const parts = outputText.filter((t) => typeof t === "string");
    if (parts.length) return parts.join("\n");
  }

  // 4) Responses API: output array with message/content parts
  // Typical shape: output: [{ type:'message', role:'assistant', content:[{type:'output_text', text:'...'}] }]
  const output = data?.output;
  if (Array.isArray(output)) {
    const texts = [];
    output.forEach((o) => {
      const contentArr = o?.content;
      if (Array.isArray(contentArr)) {
        contentArr.forEach((c) => {
          if (typeof c?.text === "string") texts.push(c.text);
          else if (typeof c === "string") texts.push(c);
        });
      }
    });
    if (texts.length) return texts.join("\n");
  }

  // 5) Other fallbacks we already attempted previously
  if (typeof data?.choices?.[0]?.text === "string") return data.choices[0].text;
  if (typeof data?.text === "string") return data.text;
  if (typeof data?.assistant === "string") return data.assistant;
  if (typeof data?.answer === "string") return data.answer;
  if (
    Array.isArray(data?.result) &&
    typeof data.result[0]?.output_text === "string"
  ) {
    return data.result[0].output_text;
  }

  // Nothing usable found
  return null;
}

/* Send message to Cloudflare Worker and return assistant reply
   Auto-continue if the model stops due to token limit (finish_reason === "length"). */
async function sendToWorker(messages) {
  // Cloudflare Worker URL (deployed endpoint)
  // Note: Your Worker contains the OpenAI API key and Prompt ID.
  const workerUrl = "https://lorealchatbot.cuadra33.workers.dev/";

  // Helper to make one API call
  async function callWorker(msgs) {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: msgs,
        // give the worker a generous budget; worker may override
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Worker error: ${res.status} ${text}`);
    }

    const data = await res.json();
    console.debug("Worker response:", data);

    // Normalize to a plain string to prevent "[object Object]"
    let content = extractAssistantText(data);

    const finishReason = data?.choices?.[0]?.finish_reason || null;

    if (!content || typeof content !== "string") {
      throw new Error(
        `No assistant response found. Worker returned: ${JSON.stringify(data)}`
      );
    }

    return { content, finishReason };
  }

  try {
    let attempts = 0;
    const maxAttempts = 3; // first reply + up to 2 continuations
    let msgs = messages.slice();
    let combined = "";

    while (attempts < maxAttempts) {
      const { content, finishReason } = await callWorker(msgs);

      combined += (combined ? "\n\n" : "") + content;

      // Stop if not truncated
      if (finishReason !== "length") break;

      // Otherwise, ask for continuation: include the assistant's partial and a simple "Continue."
      msgs = msgs.concat(
        { role: "assistant", content: content },
        { role: "user", content: "Continue." }
      );
      attempts++;
    }

    // Sanitize and format once at the end
    const assistantText = sanitizeAssistantText(combined);
    const assistantHtml = formatAssistantHTML(assistantText);
    return assistantHtml;
  } catch (err) {
    throw err;
  }
}

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage("user", text);
  userInput.value = "";

  const loadingId = appendLoading();

  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: text },
  ];

  try {
    const replyHtml = await sendToWorker(messages);

    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    // assistant reply is HTML (safe), so pass isHtml = true
    appendMessage("assistant", replyHtml, true);
  } catch (err) {
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();
    appendMessage("assistant", `Error: ${escapeHtml(err.message)}`);
    console.error("Error sending to worker:", err);
  }
});
