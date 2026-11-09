// Tablas como tarjetas en teléfonos: copia el título de cada columna a sus celdas (data-label)
// y envuelve el contenido para poder alinearlo. Funciona con filas que se renderizan después.
(function () {
  function labelTable(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      const isEmpty = cells.length === 1 && (Number(cells[0].getAttribute('colspan')) > 1 || heads.length > 1);
      tr.classList.toggle('is-empty-row', isEmpty);
      let col = 0;
      cells.forEach((td) => {
        if (td.dataset.cardified !== '1') {
          td.setAttribute('data-label', isEmpty ? '' : (heads[col] || ''));
          const wrap = document.createElement('div');
          wrap.className = 'td-value';
          while (td.firstChild) wrap.appendChild(td.firstChild);
          td.appendChild(wrap);
          td.dataset.cardified = '1';
        }
        td.classList.toggle('td-actions', !isEmpty && td.querySelectorAll('button, a.btn').length >= 2);
        col += Number(td.getAttribute('colspan')) || 1;
      });
    });
  }

  function scan(root) {
    (root.matches && root.matches('table.data-table') ? [root] : []).concat(Array.from((root.querySelectorAll ? root : document).querySelectorAll('table.data-table'))).forEach(labelTable);
  }

  let queued = false;
  const observer = new MutationObserver((mutations) => {
    if (queued) return;
    if (!mutations.some((m) => m.target.closest && m.target.closest('table.data-table'))) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      observer.disconnect();
      scan(document);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });

  function start() {
    scan(document);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
