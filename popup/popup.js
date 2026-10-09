const keys = Object.keys(VA.DEFAULTS);
const opts = document.getElementById('opts');

chrome.storage.sync.get(VA.DEFAULTS).then((s) => {
  for (const k of keys) document.getElementById(k).checked = s[k];
  opts.disabled = !s.enabled;
});

for (const k of keys) {
  document.getElementById(k).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [k]: e.target.checked });
    if (k === 'enabled') opts.disabled = !e.target.checked;
  });
}

chrome.storage.local.get('stats').then(({ stats = {} }) => {
  const today = new Date().toLocaleDateString('sv');
  document.getElementById('today').textContent = stats.day === today ? stats.today || 0 : 0;
  document.getElementById('total').textContent = stats.total || 0;
  if (stats.lastName) {
    const at = new Date(stats.lastAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('last').textContent = `Gần nhất: ${stats.lastName} (${at})`;
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://vectorizer.ai/' });
  window.close();
});
