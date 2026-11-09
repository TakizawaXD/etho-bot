// Tema claro/oscuro: respeta la preferencia del sistema y recuerda la elección. Se carga en <head> para evitar parpadeos.
(function () {
  var KEY = 'etho_theme';
  function systemTheme() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#EEF2EF' : '#0B1411');
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.className = theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });
  }
  window.toggleTheme = function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) { /* modo privado */ }
    apply(next);
  };
  window.syncThemeIcons = function () { apply(document.documentElement.getAttribute('data-theme') || 'dark'); };
  apply(saved() || systemTheme());
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (!saved()) apply(systemTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
  document.addEventListener('DOMContentLoaded', function () { apply(document.documentElement.getAttribute('data-theme')); });
})();
