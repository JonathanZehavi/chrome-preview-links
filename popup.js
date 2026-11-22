const DEFAULTS = { enabled: true, disabledHosts: [], delay: 450, headlinesOnly: true };
const $ = (id) => document.getElementById(id);

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  let host = "";
  try {
    const u = new URL(tab.url);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch {}

  chrome.storage.sync.get(DEFAULTS, (s) => {
    $("enabled").checked = s.enabled;
    $("headlinesOnly").checked = s.headlinesOnly;
    $("delay").value = s.delay;
    $("delayVal").textContent = s.delay + " ms";
    $("host").textContent = host || "(not a web page)";
    $("site").disabled = !host;
    $("site").checked = host && !s.disabledHosts.includes(host);

    $("enabled").onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked });
    $("headlinesOnly").onchange = (e) => chrome.storage.sync.set({ headlinesOnly: e.target.checked });
    $("delay").oninput = (e) => ($("delayVal").textContent = e.target.value + " ms");
    $("delay").onchange = (e) => chrome.storage.sync.set({ delay: Number(e.target.value) });
    $("site").onchange = (e) => {
      chrome.storage.sync.get(DEFAULTS, ({ disabledHosts }) => {
        const set = new Set(disabledHosts);
        e.target.checked ? set.delete(host) : set.add(host);
        chrome.storage.sync.set({ disabledHosts: [...set] });
      });
    };
  });
});

// Claude settings live in storage.local (never synced to your Google account).
chrome.storage.local.get({ apiKey: "", model: "claude-opus-5-5" }, ({ apiKey, model }) => {
  const status = $("keyStatus");
  const showStatus = (has) => (status.textContent = has ? "Key saved ✓" : "No key saved");
  showStatus(!!apiKey);
  if (apiKey) $("apiKey").placeholder = "•••••••• (saved, type to replace)";
  $("model").value = model;
  $("model").onchange = (e) => chrome.storage.local.set({ model: e.target.value });
  $("saveKey").onclick = () => {
    const v = $("apiKey").value.trim();
    if (!v) {
      chrome.storage.local.remove("apiKey", () => showStatus(false));
      return;
    }
    if (!v.startsWith("sk-ant-")) {
      status.textContent = "That doesn't look like a Claude API key (should start with sk-ant-)";
      return;
    }
    chrome.storage.local.set({ apiKey: v }, () => {
      $("apiKey").value = "";
      $("apiKey").placeholder = "•••••••• (saved, type to replace)";
      showStatus(true);
    });
  };
});
