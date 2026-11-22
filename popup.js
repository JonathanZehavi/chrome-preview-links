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
