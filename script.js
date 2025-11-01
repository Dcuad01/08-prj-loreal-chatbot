/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

// Set initial message
chatWindow.textContent = "👋 Hello! How can I help you today?";

/* Helper: append a message to the chat window */
// type is 'user' or 'assistant'
function appendMessage(type, text) {
  // Simple formatting for beginner students
  const who = type === "user" ? "You" : "Assistant";
  chatWindow.innerHTML += `<div class="${type}-message"><strong>${who}:</strong> ${text}</div>`;
  // Scroll to bottom so new messages are visible
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Send message to Cloudflare Worker and return assistant reply */
async function sendToWorker(messages) {
  // Cloudflare Worker URL (deployed endpoint)
  const workerUrl = "https://lorealchatbot.cuadra33.workers.dev/";

  try {
    // Use fetch with async/await and send a JSON body with a `messages` array.
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // We use gpt-4o by default (beginner-friendly). The worker should forward to OpenAI.
        model: "gpt-4o",
        messages: messages,
      }),
    });

    // If the worker returns a non-OK HTTP status, throw an error
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Worker error: ${res.status} ${text}`);
    }

    // Parse JSON response and log it for debugging
    const data = await res.json();
    console.debug("Worker response:", data);

    // Try several common places the assistant text might appear
    const assistantText =
      data?.choices?.[0]?.message?.content || // standard OpenAI chat format
      data?.choices?.[0]?.text || // older/text format
      data?.text || // custom worker field
      data?.assistant || // custom worker field
      data?.answer || // another possible field
      (Array.isArray(data?.result) && data.result[0]?.output_text) || // other shapes
      (Array.isArray(data?.choices) &&
        Array.isArray(data.choices[0]?.message?.content) &&
        data.choices[0].message.content.join("\n")) || // handle arrays
      (typeof data === "string" ? data : null);

    if (!assistantText) {
      // Include the returned JSON to help debugging the worker response shape
      throw new Error(
        `No assistant response found. Worker returned: ${JSON.stringify(data)}`
      );
    }
    return assistantText;
  } catch (err) {
    // Re-throw to be handled by caller
    throw err;
  }
}

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = userInput.value.trim();
  if (!text) return;

  // Show the user's message in the chat window
  appendMessage("user", text);
  userInput.value = "";

  // Show a simple loading indicator for the assistant
  const loadingId = `loading-${Date.now()}`;
  chatWindow.innerHTML += `<div id="${loadingId}" class="assistant-message"><strong>Assistant:</strong> ...thinking...</div>`;
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Prepare messages array for the worker
  const messages = [
    // Optional system message to set assistant behavior (simple example)
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: text },
  ];

  try {
    const reply = await sendToWorker(messages);

    // Remove loading indicator
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    // Append assistant reply
    appendMessage("assistant", reply);
  } catch (err) {
    // Remove loading indicator and show error
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    appendMessage("assistant", `Error: ${err.message}`);
    console.error("Error sending to worker:", err);
  }
});
