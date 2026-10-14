(() => {
  const tok = location.pathname.split('/')[2];
  document.getElementById('name').textContent = decodeURIComponent(tok.split('-').slice(1).join('-'));
  document.getElementById('Download-Button').addEventListener('click', (e) => {
    e.preventDefault();
    navigator.sendBeacon('/log', `${(performance.now() / 1000).toFixed(1)} ${location.pathname} dl-click trusted=${e.isTrusted}`);
    location.href = `/download/${tok}`;
  });
})();
