// ====================================================================
// ETHO MULTI-BOT HUB - CLIENTE JAVASCRIPT (CRM, CATÁLOGO, AJUSTES AVANZADOS)
// ====================================================================

const FACET_PRESETS = {
  recreational: {
    name: 'Comunidad & Grupos',
    icon: 'fa-gamepad',
    badgeClass: 'purple',
    tagText: 'Comunidad & Grupos',
    prefix: '#',
    autoReply: false,
    prompt: 'Eres un asistente conversacional para WhatsApp. Hablas en español de forma totalmente natural, cercana, educada y normal, sin frases raras ni maullidos. Ayudas a los usuarios y animas el chat grupal con juegos (#work, #crime, #slot), economía y stickers.'
  },
  assistant: {
    name: 'Asistente Ejecutivo & Personal',
    icon: 'fa-briefcase',
    badgeClass: 'blue',
    tagText: 'Asistente Ejecutivo',
    prefix: '!',
    autoReply: true,
    prompt: 'Eres un Asistente Personal ejecutivo, educado, organizado y conciso. Ayudas al usuario a gestionar tareas, recordatorios programados (!recordar), notas privadas (!nota), cálculos y organizar su día de forma clara.'
  },
  advisor: {
    name: 'Asesor Comercial & Ventas',
    icon: 'fa-store',
    badgeClass: 'green',
    tagText: 'Asesor Comercial',
    prefix: '/',
    autoReply: true,
    prompt: 'Eres el Asesor Comercial y de Ventas oficial del negocio. Atiendes dudas con amabilidad, informas sobre el catálogo de productos, precios, promociones, horarios y facilitas el contacto para concretar ventas y capturar datos de clientes.'
  },
  ai_autonomous: {
    name: 'Cerebro Autónomo con IA',
    icon: 'fa-brain',
    badgeClass: 'orange',
    tagText: 'Autónomo IA',
    prefix: '',
    autoReply: true,
    prompt: 'Eres un asistente conversacional autónomo de última generación con Inteligencia Artificial. Respondes con empatía, fluidez, criterio y gran inteligencia a cualquier tema o conversación en español.'
  },
  support: {
    name: 'Soporte, Turnos & Citas',
    icon: 'fa-headset',
    badgeClass: 'cyan',
    tagText: 'Soporte & Turnos',
    prefix: '.',
    autoReply: true,
    prompt: 'Eres el Asistente Oficial de Soporte y Agendamiento de Turnos o Citas. Atiendes dudas frecuentes (FAQ), pides los datos necesarios al cliente para agendar su cita y canalizas con un asesor humano si es requerido.'
  },
  tutor: {
    name: 'Tutor Educativo & Clases',
    icon: 'fa-graduation-cap',
    badgeClass: 'amber',
    tagText: 'Tutor Educativo',
    prefix: '#',
    autoReply: true,
    prompt: 'Eres un Tutor Educativo didáctico, paciente y altamente pedagógico. Explicas temas paso a paso, realizas preguntas para comprobar el aprendizaje (#trivia), resuelves ejercicios y motivas a los alumnos.'
  }
};

// Tope de bots del plan del usuario; lo informa el servidor (cuenta gratuita: 3).
let MAX_BOTS = 3;
function setMaxBots(n) { if (Number.isFinite(Number(n)) && Number(n) > 0) MAX_BOTS = Number(n); }

const state = {
  bots: [],
  functions: [],
  leads: [],
  products: [],
  logs: [],
  activeTab: 'bots',
  activeFacetFilter: 'all',
  selectedFacet: 'recreational',
  activeQrBotId: null,
  activeQrBotName: '',
  handlingQrSuccessFor: null,
  qrCloseTimeout: null,
  justConnectedBotId: null,
  activeSimBotId: null,
  activeSettingsBotId: null,
  qrPollInterval: null,
  supabaseStatus: null,
  currentUser: null,
  token: localStorage.getItem('etho_auth_token') || '',
  adminUsers: [],
  adminBots: [],
  adminStats: null,
  studioCurrentStep: 1,
  selectedTone: 'friendly',
  selectedIndustry: 'ecommerce',
};

// Toda llamada a /api/ desde el panel lleva la sesión (la API ahora exige autenticación).
const _nativeFetch = window.fetch.bind(window);
window.fetch = function (input, init = {}) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const isPublic = /^\/api\/(auth\/|status|health|events|billing\/plans)/.test(url) || (method === 'POST' && /^\/api\/tickets(\/lookup)?$/.test(url));
    // Visitante sin sesión: no se llama a rutas protegidas (evita 401 innecesarios al cargar la landing).
    if (!state.token && url.startsWith('/api/') && !isPublic) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    }
    if (state.token && url.startsWith('/api/')) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${state.token}`);
      init = { ...init, headers };
    }
  } catch { /* si algo falla, se envía tal cual */ }
  return _nativeFetch(input, init);
};

function openCreateBotStudio() {
  if (state.bots.length >= MAX_BOTS) {
    (window.promptUpgrade ? window.promptUpgrade : (m) => showToast(m, 'warning'))(`Tu plan permite hasta ${MAX_BOTS} bots. Mejora tu plan para crear más.`);
    return;
  }
  resetBotModalToCreate();
  openModal('addBotModal');
}
window.openCreateBotStudio = openCreateBotStudio;

function authFetch(url, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  return fetch(url, { ...options, headers });
}

// ==========================================
// TEMA EJECUTIVO OSCURO EXCLUSIVO & INSTALADOR DE APP (ESCRITORIO / MÓVIL)
// ==========================================
let deferredInstallPrompt = null;
let installBannerDelayDone = false;

function enforceExecutiveDarkTheme() {
  document.body.classList.remove('theme-white');
  const layout = document.getElementById('appLayout');
  if (layout) layout.classList.remove('theme-white');
  try {
    localStorage.removeItem('etho_theme');
    localStorage.removeItem('etho_white_default_applied');
  } catch {}
}

function isStandaloneApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true
  );
}

function syncInstallButtonsUI() {
  const standalone = isStandaloneApp();
  document.body.classList.toggle('is-standalone-app', standalone);

  document.querySelectorAll('.install-app-trigger').forEach((btn) => {
    btn.style.display = standalone ? 'none' : '';
  });

  const readyBox = document.getElementById('installNativeReadyBox');
  if (readyBox) {
    readyBox.style.display = deferredInstallPrompt && !standalone ? 'block' : 'none';
  }

  const banner = document.getElementById('appInstallBanner');
  if (banner) {
    let dismissed = false;
    try {
      const until = Number(localStorage.getItem('etho_install_banner_dismissed_until')) || 0;
      dismissed = until > Date.now() || sessionStorage.getItem('etho_install_banner_dismissed') === '1';
    } catch {}
    const isMobileScreen = window.matchMedia('(max-width: 768px)').matches;
    if (standalone || dismissed) {
      banner.style.display = 'none';
    } else if (deferredInstallPrompt || (isMobileScreen && installBannerDelayDone)) {
      banner.style.display = 'flex';
    }
  }
}

function highlightDeviceInstallCard() {
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);

  const desk = document.getElementById('installGuideDesktop');
  const andr = document.getElementById('installGuideAndroid');
  const ios = document.getElementById('installGuideIos');

  [desk, andr, ios].forEach((el) => {
    if (el) el.classList.remove('active-device');
  });

  if (isIos && ios) ios.classList.add('active-device');
  else if (isAndroid && andr) andr.classList.add('active-device');
  else if (desk) desk.classList.add('active-device');
}

async function confirmNativeInstallPrompt() {
  if (!deferredInstallPrompt) return false;
  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice && choice.outcome === 'accepted') {
      deferredInstallPrompt = null;
      closeModal('installAppModal');
      const banner = document.getElementById('appInstallBanner');
      if (banner) banner.style.display = 'none';
      showToast('Instalando aplicación Etho Hub en tu dispositivo...', 'success');
    }
    syncInstallButtonsUI();
    return true;
  } catch {
    return false;
  }
}
window.confirmNativeInstallPrompt = confirmNativeInstallPrompt;

async function triggerInstallApp() {
  if (isStandaloneApp()) {
    showToast('La aplicación Etho Hub ya se está ejecutando instalada.', 'info');
    return;
  }
  if (deferredInstallPrompt) {
    const triggered = await confirmNativeInstallPrompt();
    if (triggered) return;
  }
  highlightDeviceInstallCard();
  syncInstallButtonsUI();
  openModal('installAppModal');
}
window.triggerInstallApp = triggerInstallApp;

function dismissInstallBanner() {
  try {
    sessionStorage.setItem('etho_install_banner_dismissed', '1');
    localStorage.setItem('etho_install_banner_dismissed_until', String(Date.now() + 14 * 24 * 3600 * 1000));
  } catch {}
  const banner = document.getElementById('appInstallBanner');
  if (banner) banner.style.display = 'none';
}
window.dismissInstallBanner = dismissInstallBanner;

function initAppInstaller() {
  // En móvil sin aviso nativo, el banner espera un poco para no tapar la primera vista
  setTimeout(() => { installBannerDelayDone = true; syncInstallButtonsUI(); }, 20000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    syncInstallButtonsUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeModal('installAppModal');
    const banner = document.getElementById('appInstallBanner');
    if (banner) banner.style.display = 'none';
    syncInstallButtonsUI();
    showToast('Aplicación Etho Hub instalada en tu equipo con éxito', 'success');
  });

  const mq = window.matchMedia('(display-mode: standalone)');
  if (mq && typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', syncInstallButtonsUI);
  }

  syncInstallButtonsUI();
}

enforceExecutiveDarkTheme();

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  enforceExecutiveDarkTheme();
  initAppInstaller();
  initTabs();
  initSidebar();
  initMobileNav();
  initModals();
  initAuthModal();
  initFacetSelector();
  initFacetFilters();
  initSettingsSubtabs();
  initForms();
  initFilters();
  initPricingCalculator();
  initSupabaseSection();
  connectSSE();

  // Verificar sesión y cargar datos
  checkAuth();
  fetchStatus();
  fetchBots();
  fetchLeads();
  fetchProducts();
  fetchFunctions();
  fetchLogs();
  fetchModerationData();
});

// ==========================================
// NAVEGACIÓN Y ESTRUCTURA DE LA APP
// ==========================================
const SECTION_TITLES = {
  bots: 'Instancias & Bots de WhatsApp',
  leads: 'CRM: Prospectos & Clientes',
  catalog: 'Catálogo de Productos & Servicios',
  functions: 'Funciones & Reglas Personalizadas',
  moderation: 'Sistema de Reglas & Moderación Activa',
  logs: 'Registro de Actividad en Tiempo Real',
  pricing: 'Estrategia Comercial & Guía de Precios',
  settings: 'Copia de Seguridad & Nube',
  admin: 'Control Master: Clientes, Tiempos & Suscripciones'
};

function switchTab(tabName) {
  state.activeTab = tabName;
  if (tabName === 'moderation') fetchModerationData();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  const primaryMobileTabs = ['bots', 'leads', 'catalog'];
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    if (btn.dataset.moreMenu === 'true') {
      btn.classList.toggle('active', !primaryMobileTabs.includes(tabName));
    } else if (btn.dataset.tab) {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    }
  });

  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  const activeContent = document.getElementById(`tab-${tabName}`);
  if (activeContent) activeContent.classList.add('active');

  const titleEl = document.getElementById('topbarCurrentTitle');
  if (titleEl && SECTION_TITLES[tabName]) {
    titleEl.textContent = SECTION_TITLES[tabName];
  }

  // Cerrar sidebar en móviles tras navegar
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('sidebar-open');
  if (backdrop) backdrop.classList.remove('active');

  if (tabName === 'bots') fetchBots();
  if (tabName === 'leads') fetchLeads();
  if (tabName === 'catalog') fetchProducts();
  if (tabName === 'functions') fetchFunctions();
  if (tabName === 'logs') fetchLogs();
  if (tabName === 'admin') fetchAdminData();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function initSidebar() {
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  const closeBtn = document.getElementById('sidebarCloseBtn');
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (toggleBtn && sidebar && backdrop) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('sidebar-open');
      backdrop.classList.add('active');
    });
  }

  const closeSidebar = () => {
    if (sidebar) sidebar.classList.remove('sidebar-open');
    if (backdrop) backdrop.classList.remove('active');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  if (backdrop) backdrop.addEventListener('click', closeSidebar);
}

function initMobileNav() {
  document.querySelectorAll('.mobile-nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const moreMenuBtn = document.getElementById('mobileMoreMenuBtn');
  if (moreMenuBtn) {
    moreMenuBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('appSidebar');
      const backdrop = document.getElementById('sidebarBackdrop');
      if (!sidebar) return;
      const isOpen = sidebar.classList.contains('sidebar-open');
      sidebar.classList.toggle('sidebar-open', !isOpen);
      if (backdrop) backdrop.classList.toggle('active', !isOpen);
    });
  }

  const mobileFab = document.getElementById('mobileAddBotFab');
  if (mobileFab) {
    mobileFab.addEventListener('click', () => {
      openCreateBotStudio();
    });
  }
}

// ==========================================
// SELECTOR DE FACETAS
// ==========================================
function initFacetSelector() {
  const cards = document.querySelectorAll('.facet-card');
  cards.forEach(card => {
    card.addEventListener('click', () => selectFacet(card.dataset.facet));
  });
}

function selectFacet(facetKey) {
  state.selectedFacet = facetKey;
  const preset = FACET_PRESETS[facetKey] || FACET_PRESETS.recreational;

  document.querySelectorAll('.facet-card').forEach(c => {
    c.classList.toggle('active', c.dataset.facet === facetKey);
  });

  const prefixInput = document.getElementById('botPrefixInput');
  const autoReplyInput = document.getElementById('botAiAutoReplyInput');
  const promptInput = document.getElementById('botSystemPromptInput');

  if (prefixInput && (!prefixInput.value || ['#', '!', '/', '.'].includes(prefixInput.value))) {
    prefixInput.value = preset.prefix;
  }
  if (autoReplyInput) autoReplyInput.checked = preset.autoReply;
  if (promptInput) promptInput.value = preset.prompt;
  updatePreviewLive();
}

// ==========================================
// ESTUDIO WIZARD AVANZADO DE CREACIÓN DE BOTS
// ==========================================

function jumpToStudioStep(step) {
  state.studioCurrentStep = step;
  document.querySelectorAll('.studio-step-pane').forEach((pane, idx) => {
    pane.classList.toggle('active', idx + 1 === step);
  });
  document.querySelectorAll('.studio-step-btn').forEach((btn, idx) => {
    const s = idx + 1;
    btn.classList.toggle('active', s === step);
    btn.classList.toggle('completed', s < step);
  });

  const prevBtn = document.getElementById('studioPrevBtn');
  const nextBtn = document.getElementById('studioNextBtn');
  const submitBtn = document.getElementById('saveBotSubmitBtn');

  if (prevBtn) prevBtn.style.display = step > 1 ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = step < 5 ? 'inline-flex' : 'none';
  if (submitBtn) submitBtn.style.display = step === 5 ? 'inline-flex' : 'none';

  if (step === 5) {
    updateStudioSummary();
  }

  const stepper = document.getElementById('studioStepper');
  const activeStepBtn = stepper ? stepper.querySelector('.studio-step-btn.active') : null;
  if (stepper && activeStepBtn) {
    const targetLeft = activeStepBtn.offsetLeft - (stepper.clientWidth / 2) + (activeStepBtn.offsetWidth / 2);
    stepper.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }
  const studioBody = document.querySelector('#addBotModal .studio-body-layout');
  if (studioBody) {
    studioBody.scrollTop = 0;
  }

  updatePreviewLive();
}

function navigateStudioStep(delta) {
  let next = (state.studioCurrentStep || 1) + delta;
  if (next < 1) next = 1;
  if (next > 5) next = 5;

  if (delta > 0 && state.studioCurrentStep === 2) {
    const name = document.getElementById('botNameInput')?.value.trim();
    const phone = document.getElementById('botPhoneInput')?.value.trim().replace(/\D/g, '');
    const purpose = document.getElementById('botPurposeInput')?.value.trim();
    if (!name) {
      showToast('Por favor escribe un nombre para tu bot', 'warning');
      document.getElementById('botNameInput')?.focus();
      return;
    }
    if (!phone || phone.length < 8) {
      showToast('El número de WhatsApp es obligatorio para conectar el bot (código país + número, ej: 573171736519)', 'warning');
      document.getElementById('botPhoneInput')?.focus();
      return;
    }
    if (!purpose) {
      showToast('Indica para qué negocio o fin usarás el bot', 'warning');
      document.getElementById('botPurposeInput')?.focus();
      return;
    }
  }

  jumpToStudioStep(next);
}

function selectStudioFacet(facetKey) {
  state.selectedFacet = facetKey;
  selectFacet(facetKey);
  regenerateStudioWelcome();
  updatePreviewLive();
}

function selectStudioTone(tone) {
  state.selectedTone = tone;
  const input = document.getElementById('botToneInput');
  if (input) input.value = tone;
  document.querySelectorAll('.tone-card').forEach(c => {
    c.classList.toggle('active', c.dataset.tone === tone);
  });
  regenerateStudioWelcome();
  updatePreviewLive();
}

function applyIndustryPresets(industry) {
  state.selectedIndustry = industry;
  const input = document.getElementById('botIndustryInput');
  if (input) input.value = industry;
  regenerateStudioWelcome();
  updatePreviewLive();
}

function regenerateStudioWelcome() {
  const facet = state.selectedFacet || 'recreational';
  const tone = state.selectedTone || 'friendly';
  const industry = state.selectedIndustry || 'ecommerce';
  const name = document.getElementById('botNameInput')?.value.trim() || 'Mi Bot';

  let msg = '';
  if (facet === 'recreational') {
    msg = `¡Hola! Soy *${name}*. Asistente para tu comunidad en WhatsApp con dinámicas, recordatorios y utilidades. Escribe *#help* para ver las funciones disponibles.`;
  } else if (facet === 'advisor') {
    if (tone === 'formal') {
      msg = `Estimado/a cliente, le damos una cordial bienvenida. Mi nombre es *${name}*, asesor virtual. Estamos a su completa disposición para consultas sobre nuestro catálogo, cotizaciones y atención personalizada.`;
    } else if (tone === 'persuasive') {
      msg = `Bienvenido/a a nuestro canal oficial de WhatsApp. Soy *${name}*. Te atenderemos con información de productos, horarios y servicios. ¿En qué te podemos colaborar hoy?`;
    } else if (tone === 'concise') {
      msg = `Hola. Soy *${name}*. Consulta nuestro catálogo, precios y horarios escribiendo tu duda directamente.`;
    } else {
      msg = `Hola, es un placer saludarte. Soy *${name}*, tu asesor comercial. ¿En qué te puedo colaborar hoy? Puedes pedirme nuestro catálogo o consultar cualquier duda.`;
    }
  } else if (facet === 'assistant') {
    msg = `Hola. Soy tu asistente personal *${name}*. Puedes solicitar recordatorios (#recordar), notas privadas (#nota) y organizar tus pendientes del día.`;
  } else if (facet === 'ai_autonomous') {
    msg = `Hola. Soy *${name}*, tu asistente inteligente. Puedes hablar conmigo sobre cualquier tema con total naturalidad, sin necesidad de comandos. ¿En qué te puedo colaborar hoy?`;
  } else if (facet === 'support') {
    msg = `Bienvenido/a a nuestra línea de atención y soporte. Soy *${name}*. Escribe tu consulta, agenda un turno o solicita comunicarte con un asesor humano.`;
  } else if (facet === 'tutor') {
    msg = `Bienvenido/a. Soy tu tutor formativo *${name}*. Estoy a tu disposición para repasar lecciones, resolver dudas o plantear ejercicios educativos.`;
  }

  const welcomeInput = document.getElementById('botWelcomeMsgInput');
  if (welcomeInput) welcomeInput.value = msg;
  updatePreviewLive();
}

function toggleStudioPairingMode(mode) {
  const group = document.getElementById('pairingPhoneGroup');
  if (group) group.style.display = mode === 'code' ? 'block' : 'none';
}

function updatePreviewLive() {
  const name = document.getElementById('botNameInput')?.value.trim() || 'Mi Asistente';
  const welcome = document.getElementById('botWelcomeMsgInput')?.value.trim() || '¡Hola! ¿En qué puedo ayudarte hoy?';
  const facet = state.selectedFacet || 'recreational';
  const tone = state.selectedTone || 'friendly';
  const preset = FACET_PRESETS[facet] || FACET_PRESETS.recreational;

  const prevName = document.getElementById('prevWaName');
  if (prevName) prevName.textContent = name;

  const prevAvatar = document.getElementById('prevWaAvatar');
  if (prevAvatar) {
    prevAvatar.innerHTML = `<i class="fa-solid ${preset.icon}"></i>`;
  }

  const prevMsg = document.getElementById('prevWaMsg');
  if (prevMsg) prevMsg.textContent = welcome;

  const prevFacet = document.getElementById('prevBadgeFacet');
  if (prevFacet) {
    prevFacet.textContent = preset.tagText;
    prevFacet.className = `badge badge-${preset.badgeClass}`;
  }

  const prevTone = document.getElementById('prevBadgeTone');
  if (prevTone) {
    const toneLabels = { friendly: 'Amigable', formal: 'Formal', persuasive: 'Comercial', concise: 'Directo', technical: 'Analítico' };
    prevTone.textContent = toneLabels[tone] || 'Amigable';
  }

  const aiChecked = document.getElementById('botAiAutoReplyInput')?.checked;
  const prevAI = document.getElementById('prevBadgeAI');
  if (prevAI) {
    prevAI.textContent = aiChecked ? 'IA Activa' : 'Solo Comandos';
    prevAI.className = aiChecked ? 'badge badge-success' : 'badge badge-secondary';
  }

  const catChecked = document.getElementById('modCatalogToggle')?.checked;
  const pillCat = document.getElementById('prevPillCatalog');
  if (pillCat) pillCat.style.display = catChecked ? 'block' : 'none';

  const handoffChecked = document.getElementById('modHandoffToggle')?.checked;
  const pillAgent = document.getElementById('prevPillAgent');
  if (pillAgent) pillAgent.style.display = handoffChecked ? 'block' : 'none';
}

function updateStudioSummary() {
  const name = document.getElementById('botNameInput')?.value.trim() || 'Sin definir';
  const phone = document.getElementById('botPhoneInput')?.value.trim().replace(/\D/g, '') || '';
  const purpose = document.getElementById('botPurposeInput')?.value.trim() || 'Sin definir';
  const facet = state.selectedFacet || 'recreational';
  const preset = FACET_PRESETS[facet] || FACET_PRESETS.recreational;
  const indSelect = document.getElementById('botIndustrySelect');
  const industryText = indSelect ? indSelect.options[indSelect.selectedIndex]?.text : 'General';
  const tone = state.selectedTone || 'friendly';
  const toneLabels = { friendly: 'Amigable', formal: 'Formal', persuasive: 'Vendedor Persuasivo', concise: 'Directo', technical: 'Analítico' };

  const sName = document.getElementById('sumBotName');
  if (sName) sName.textContent = name;
  const sPhone = document.getElementById('sumBotPhone');
  if (sPhone) sPhone.textContent = phone ? `+${phone}` : 'No asignado';
  const sPairingPhone = document.getElementById('pairingPhoneDisplayVal');
  if (sPairingPhone) sPairingPhone.textContent = phone ? `+${phone}` : '+1234567890';
  const sFacet = document.getElementById('sumBotFacet');
  if (sFacet) sFacet.textContent = preset.name;
  const sInd = document.getElementById('sumBotIndustry');
  if (sInd) sInd.textContent = industryText;
  const sTone = document.getElementById('sumBotTone');
  if (sTone) sTone.textContent = toneLabels[tone] || tone;
  const sPurp = document.getElementById('sumBotPurpose');
  if (sPurp) sPurp.textContent = purpose;

  const notice = document.getElementById('subTrialNotice');
  if (notice && state.currentUser) {
    if (state.currentUser.role === 'admin') {
      notice.innerHTML = '<strong>Cuenta Administrador Master:</strong> Tu bot tendrá tiempo <strong>Ilimitado (VIP)</strong> sin costo ni vencimiento.';
    } else {
      notice.innerHTML = '<i class="fa-solid fa-gift text-green"></i> <strong>3 Días de Prueba Gratuita:</strong> Al registrar tu bot podrás probarlo gratis. Luego podrás renovar con el Administrador.';
    }
  }
}

function initFacetFilters() {
  document.querySelectorAll('.facet-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.facet-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFacetFilter = btn.dataset.facet;
      renderBots();
    });
  });
}

function updateFacetCounters() {
  const counts = { all: state.bots.length, recreational: 0, assistant: 0, advisor: 0, ai_autonomous: 0 };
  state.bots.forEach(b => {
    const p = b.personality || 'recreational';
    if (counts[p] !== undefined) counts[p]++;
  });

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('facetCountAll', counts.all);
  setEl('facetCountRec', counts.recreational);
  setEl('facetCountAst', counts.assistant);
  setEl('facetCountAdv', counts.advisor);
  setEl('facetCountAi', counts.ai_autonomous);
}

// ==========================================
// CONEXIÓN EN TIEMPO REAL (SSE)
// ==========================================
let sseSource = null;

function connectSSE() {
  if (sseSource) sseSource.close();
  const sseUrl = state.token
    ? `/api/events?token=${encodeURIComponent(state.token)}`
    : '/api/events';
  sseSource = new EventSource(sseUrl);

  sseSource.addEventListener('init', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.bots)) {
        state.bots = data.bots;
        setMaxBots(data.maxBots);
        renderBots();
        updateStats();
        updateFacetCounters();
      }
    } catch (err) { console.error('SSE init error:', err); }
  });

  sseSource.addEventListener('bot_update', (e) => {
    try {
      const data = JSON.parse(e.data);

      if (state.activeQrBotId === data.botId) {
        if (data.status === 'online') {
          handleBotConnectedSuccess(data.botId, state.activeQrBotName || data.name || 'Bot');
        } else if (data.status === 'connecting') {
          const st = document.getElementById('qrStatusText');
          if (st) {
            st.innerHTML = '<span class="status-dot green"></span> <strong style="color:var(--green)">Código escaneado.</strong> ' + (data.message || 'Vinculando y cargando sesión segura...');
          }
        } else if (data.status === 'qr_ready' && data.qr) {
          renderQrModal(data.qr);
        } else if (data.pairingCode) {
          renderPairingCode(data.pairingCode);
        }
      }

      const bot = state.bots.find(b => b.id === data.botId);
      if (bot) {
        Object.assign(bot, data);
        renderBots();
        updateStats();
        updateFacetCounters();
        if (state.accessModal && state.accessModal.botId === data.botId && data.settings?.accessControl) {
          syncAccessModalFromBotUpdate(data);
        }
      } else {
        fetchBots();
      }
    } catch (err) { console.error('SSE bot_update error:', err); }
  });

  sseSource.addEventListener('qr', (e) => {
    try {
      const data = JSON.parse(e.data);
      const bot = state.bots.find(b => b.id === data.botId);
      if (bot) {
        bot.status = 'qr_ready';
        bot.qr_code = data.qr;
        renderBots();
      }
      if (state.activeQrBotId === data.botId) renderQrModal(data.qr);
    } catch (err) { console.error('SSE qr error:', err); }
  });

  sseSource.addEventListener('bot_delete', (e) => {
    try {
      const data = JSON.parse(e.data);
      state.bots = state.bots.filter(b => b.id !== data.botId);
      renderBots();
      updateStats();
      updateFacetCounters();
    } catch (err) { console.error('SSE bot_delete error:', err); }
  });

  sseSource.onerror = () => {
    const badge = document.getElementById('serverStatusBadge');
    if (badge) badge.innerHTML = '<span class="status-dot red"></span><div class="sys-meta"><strong>Sistema Principal</strong><small style="color: var(--red);">Reconectando...</small></div>';
    setTimeout(connectSSE, 4000);
  };

  sseSource.onopen = () => {
    const badge = document.getElementById('serverStatusBadge');
    if (badge) badge.innerHTML = '<span class="status-dot green"></span><div class="sys-meta"><strong>Sistema Principal</strong><small>Servicio Activo</small></div>';
  };
}

// ==========================================
// ESTADO GENERAL & SUPABASE
// ==========================================
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.ok) {
      state.supabaseStatus = data.supabase;
      updateSupabaseBadge(data.supabase);
      if (data.stats) {
        setMaxBots(data.stats.maxBots);
        const el = document.getElementById('statTotalLogs');
        if (el) el.textContent = data.stats.totalLogs || 0;
        const miniEl = document.getElementById('sidebarTotalLogsMini');
        if (miniEl) miniEl.textContent = data.stats.totalLogs || 0;
      }
    }
  } catch (err) { console.error('Error fetching status:', err); }
}

function updateSupabaseBadge(supa) {
  const badge = document.getElementById('supaStatusBadge');
  if (!badge) return;
  if (!supa || !supa.ok) {
    badge.innerHTML = '<span class="status-dot red"></span><div class="sys-meta"><strong>Nube de Datos</strong><small style="color: var(--red);">Desconectado</small></div>';
  } else if (supa.tablesReady === false) {
    badge.innerHTML = '<span class="status-dot green"></span><div class="sys-meta"><strong>Nube de Datos</strong><small style="color: var(--green);">Copia Segura</small></div>';
  } else {
    badge.innerHTML = '<span class="status-dot green"></span><div class="sys-meta"><strong>Nube de Datos</strong><small style="color: var(--green);">Sincronizado OK</small></div>';
  }
}

// ==========================================
// GESTIÓN DE BOTS
// ==========================================
async function fetchBots() {
  try {
    const res = await authFetch('/api/bots');
    const data = await res.json();
    if (data.ok) {
      state.bots = Array.isArray(data.bots) ? data.bots : [];
      setMaxBots(data.maxBots);
      renderBots();
      updateStats();
      updateFacetCounters();
      updateBotFilterOptions();
      return state.bots;
    }
  } catch (err) { console.error('Error fetching bots:', err); }
  return state.bots;
}

function resetFacetFilterToAll() {
  state.activeFacetFilter = 'all';
  document.querySelectorAll('.facet-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.facet === 'all');
  });
}
window.resetFacetFilterToAll = resetFacetFilterToAll;
window.renderBots = renderBots;

function upsertBotInState(botObj) {
  if (!botObj || !botObj.id) return;
  const idx = state.bots.findIndex(b => b.id === botObj.id);
  if (idx >= 0) {
    state.bots[idx] = { ...state.bots[idx], ...botObj };
  } else {
    state.bots.unshift(botObj);
  }
}

function renderBots() {
  const grid = document.getElementById('botsGrid');
  if (!grid) return;

  const filteredBots = state.bots.filter(b => {
    if (state.activeFacetFilter === 'all') return true;
    return (b.personality || 'recreational') === state.activeFacetFilter;
  });

  if (!filteredBots.length) {
    const atLimit = state.bots.length >= MAX_BOTS;
    grid.innerHTML = `
      <div class="empty-state text-center" style="grid-column: 1 / -1; padding: 40px 20px;">
        <i class="fa-solid fa-robot" style="font-size: 48px; color: var(--text-dim); margin-bottom: 16px;"></i>
        <h3>No hay bots registrados en esta categoría</h3>
        <p class="text-muted" style="margin-bottom: 20px;">${atLimit ? `Ya alcanzaste el máximo de ${MAX_BOTS} bots en otras categorías.` : `Crea tu propio bot eligiendo su rol y funciones (máximo ${MAX_BOTS} bots).`}</p>
        ${atLimit ? `
          <button class="btn btn-secondary" onclick="resetFacetFilterToAll(); renderBots();">
            <i class="fa-solid fa-layer-group"></i> Ver Todos los Bots (${state.bots.length}/${MAX_BOTS})
          </button>
        ` : `
          <button class="btn btn-primary" onclick="openCreateBotStudio();">
            <i class="fa-solid fa-plus"></i> Crear Mi Bot
          </button>
        `}
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredBots.map(bot => {
    const isOnline = bot.status === 'online';
    const isQr = bot.status === 'qr_ready';
    const isConnecting = bot.status === 'connecting';
    const isStopped = bot.status === 'stopped' || !bot.is_active;

    const isExpired = bot.payment_status === 'suspended' || bot.payment_status === 'expired' || 
                      (bot.expires_at > 0 && Date.now() > bot.expires_at && bot.payment_status !== 'paid');

    const isPenalized = bot.isPenalized || (bot.penalty_until && bot.penalty_until > Date.now());

    let badgeClass = 'offline';
    let badgeText = 'Apagado';
    let badgeIcon = 'fa-power-off';

    if (isPenalized) {
      badgeClass = 'offline'; badgeText = 'Penalizado'; badgeIcon = 'fa-gavel';
    } else if (bot.payment_status === 'suspended') {
      badgeClass = 'offline'; badgeText = 'Suspendido'; badgeIcon = 'fa-ban';
    } else if (isExpired) {
      badgeClass = 'offline'; badgeText = 'Vencido'; badgeIcon = 'fa-triangle-exclamation';
    } else if (isOnline) {
      badgeClass = 'online'; badgeText = 'En Línea'; badgeIcon = 'fa-circle-check';
    } else if (isQr) {
      badgeClass = 'qr_ready'; badgeText = 'Escanear QR'; badgeIcon = 'fa-qrcode';
    } else if (isConnecting) {
      badgeClass = 'connecting'; badgeText = 'Conectando...'; badgeIcon = 'fa-spinner fa-spin';
    }

    const facet = FACET_PRESETS[bot.personality] || FACET_PRESETS.recreational;

    // Banner de Suscripción, Penalización y Cuenta Regresiva de Tiempo
    let subBannerHtml = '';
    if (isPenalized) {
      const pDays = bot.penaltyRemainingDays || Math.ceil((bot.penalty_until - Date.now()) / (86400000)) || 1;
      const pHours = bot.penaltyRemainingHours || Math.ceil((bot.penalty_until - Date.now()) / (3600000)) || 24;
      subBannerHtml = `
        <div class="bot-penalty-alert-banner">
          <div class="title"><i class="fa-solid fa-gavel"></i> Bot Penalizado (${pDays}d restantes)</div>
          <div class="reason"><strong>Motivo:</strong> ${escapeHtml(bot.penalty_reason || 'Abuso de las reglas')}</div>
          <div class="timer"><i class="fa-solid fa-clock"></i> Suspensión activa: ${pHours}h restantes antes de poder encender.</div>
        </div>
      `;
    } else if (bot.payment_status === 'suspended') {
      subBannerHtml = `
        <div class="bot-sub-banner expired">
          <span><i class="fa-solid fa-ban"></i> Servicio Suspendido por Admin</span>
          <a href="https://wa.me/?text=Hola%20Administrador,%20mi%20bot%20${encodeURIComponent(bot.name)}%20ha%20sido%20suspendido,%20deseo%20reactivarlo" target="_blank" class="btn-pay-whatsapp">
            <i class="fa-brands fa-whatsapp"></i> Contactar Admin
          </a>
        </div>
      `;
    } else if (isExpired) {
      subBannerHtml = `
        <div class="bot-sub-banner expired">
          <span><i class="fa-solid fa-clock-rotate-left"></i> Tiempo Vencido (Pausado)</span>
          <a href="https://wa.me/?text=Hola%20Administrador,%20deseo%20pagar%20y%20renovar%20mi%20bot%20${encodeURIComponent(bot.name)}%20(ID:%20${bot.id})" target="_blank" class="btn-pay-whatsapp">
            <i class="fa-brands fa-whatsapp"></i> Pagar y Renovar
          </a>
        </div>
      `;
    } else if (bot.payment_status === 'paid' && bot.expires_at === 0) {
      subBannerHtml = `
        <div class="bot-sub-banner paid">
          <span><i class="fa-solid fa-crown text-yellow"></i> Plan Ilimitado VIP</span>
          <span style="color: var(--green); font-weight: 700;">Activo</span>
        </div>
      `;
    } else if (bot.payment_status === 'paid') {
      const daysLeft = Math.max(0, Math.ceil((bot.expires_at - Date.now()) / (24 * 60 * 60 * 1000)));
      subBannerHtml = `
        <div class="bot-sub-banner paid">
          <span><i class="fa-solid fa-circle-check"></i> Suscripción Pagada</span>
          <span>${daysLeft} días restantes</span>
        </div>
      `;
    } else {
      const hasExpiry = Number.isFinite(Number(bot.expires_at)) && Number(bot.expires_at) > 0;
      const msLeft = hasExpiry ? Math.max(0, Number(bot.expires_at) - Date.now()) : 0;
      const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
      const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (3600 * 1000));
      subBannerHtml = `
        <div class="bot-sub-banner trial">
          <span><i class="fa-solid fa-hourglass-start"></i> Prueba Gratuita</span>
          <span>${hasExpiry ? `${days}d ${hours}h restantes` : 'Sin fecha de vencimiento'}</span>
        </div>
      `;
    }

    const isHighlighted = state.justConnectedBotId === bot.id;

    return `
      <div class="bot-card ${isHighlighted ? 'bot-card-just-connected' : ''}" data-bot-id="${bot.id}" data-facet="${bot.personality || 'recreational'}">
        <div class="bot-card-header">
          <div class="bot-title-area">
            <div class="bot-avatar ${isOnline ? 'online' : ''}">
              <i class="fa-solid ${facet.icon}"></i>
            </div>
            <div>
              <h3>${escapeHtml(bot.name)}</h3>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 3px;">
                <span class="facet-tag ${facet.badgeClass}">${facet.tagText}</span>
                <span class="bot-id">ID: ${escapeHtml(bot.id)}</span>
              </div>
            </div>
          </div>
          <span class="bot-badge ${badgeClass}" ${(isQr || isStopped) ? `onclick="openQrModalForBot('${bot.id}', '${escapeHtml(bot.name)}')" style="cursor:pointer;" title="Haz clic para vincular por código QR"` : ''}>
            <i class="fa-solid ${badgeIcon}"></i> ${badgeText}
          </span>
        </div>

        ${subBannerHtml}

        ${!isOnline ? `
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px dashed rgba(245, 158, 11, 0.4); padding: 8px 12px; margin: 6px 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="font-size: 11px; color: #fbbf24;">
              <i class="fa-solid fa-triangle-exclamation"></i> <strong>Desconectado:</strong> Requiere conexión con WhatsApp para funcionar.
            </div>
            <button type="button" class="btn btn-warning btn-sm" onclick="openQrModalForBot('${bot.id}', '${escapeHtml(bot.name)}')" style="font-size: 10px; padding: 4px 8px; flex-shrink: 0; background: #f59e0b; color: #000; border: none; font-weight: 700;">
              <i class="fa-solid fa-qrcode"></i> Vincular QR
            </button>
          </div>
        ` : ''}

        ${bot.purpose ? `
          <div style="font-size: 11.5px; color: var(--text-muted); background: rgba(255, 255, 255, 0.02); padding: 8px 12px; border-radius: 0px; border-left: 2.5px solid var(--primary); margin: 2px 0;">
            <strong style="color: var(--text-dim); font-size: 10px; text-transform: uppercase;">Para qué es:</strong> ${escapeHtml(bot.purpose)}
          </div>
        ` : ''}

        <div class="bot-meta-info">
          <div class="bot-meta-item">
            <span>Teléfono Vinculado:</span>
            <span>${bot.phone ? '+' + escapeHtml(bot.phone) : '<em class="text-muted">Sin vincular</em>'}</span>
          </div>
          <div class="bot-meta-item">
            <span>Prefijo de Comandos:</span>
            <span><code>${escapeHtml(bot.prefix || '#')}</code></span>
          </div>
          <div class="bot-meta-item">
            <span>Respuesta Autónoma IA:</span>
            <span>${bot.ai_auto_reply ? '<strong class="text-green">Activa</strong>' : '<span class="text-muted">Solo comandos</span>'}</span>
          </div>
          <div class="bot-meta-item">
            <span>Sincronización:</span>
            <span><strong class="text-green">Almacenamiento OK</strong></span>
          </div>
          <!-- PILOTO AUTOMÁTICO: HABLAR POR MÍ -->
          <div class="bot-meta-item" style="grid-column: 1 / -1; background: rgba(139, 92, 246, 0.08); padding: 8px 10px; border: 1px solid rgba(139, 92, 246, 0.25); display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="fa-solid fa-microphone-lines ${bot.auto_pilot ? 'text-purple' : 'text-dim'}" style="font-size: 14px;"></i>
              <div>
                <strong style="font-size: 11.5px; color: ${bot.auto_pilot ? '#c4b5fd' : 'var(--text-muted)'}; display: block;">
                  Hablar por Mí: ${bot.auto_pilot ? '[Activo]' : '[Pausado]'}
                </strong>
                <span style="font-size: 10px; color: var(--text-dim);">
                  ${bot.pilot_persona === 'as_assistant' ? 'Como Asistente Personal' : 'Como Clon en 1ra Persona'}
                </span>
              </div>
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" style="padding: 2px 7px; font-size: 10.5px;" onclick="openRecadosModal('${bot.id}', '${escapeHtml(bot.name)}')" title="Ver recados y mensajes atendidos por la IA">
                <i class="fa-solid fa-inbox"></i> Recados
              </button>
              <button class="btn ${bot.auto_pilot ? 'btn-success' : 'btn-secondary'} btn-sm" style="padding: 2px 7px; font-size: 10.5px;" onclick="quickTogglePilot('${bot.id}', ${!bot.auto_pilot})" title="Activar / desactivar modo hablar por mí">
                <i class="fa-solid ${bot.auto_pilot ? 'fa-toggle-on' : 'fa-toggle-off'}"></i> ${bot.auto_pilot ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          <!-- CONTROL DE ACCESO POR GRUPOS Y CHATS ("DÓNDE ACTIVAR") -->
          ${(() => {
            const acSum = getBotAccessSummary(bot);
            return `
              <div class="bot-access-strip ${acSum.stripClass}">
                <div class="bot-access-strip-left">
                  <i class="fa-solid ${acSum.icon}"></i>
                  <div class="bot-access-strip-copy">
                    <strong>${escapeHtml(acSum.title)}</strong>
                    <span>${escapeHtml(acSum.subtitle)}</span>
                  </div>
                </div>
                <button type="button" class="btn-access-trigger" onclick="openBotAccessModal('${bot.id}')" title="Elegir en qué grupos y chats se activa tu bot">
                  <i class="fa-solid fa-sliders"></i> Dónde Activar
                </button>
              </div>
            `;
          })()}
        </div>

        <div class="bot-actions">
          ${isPenalized ? `
            <button class="btn btn-sm btn-danger" disabled style="opacity: 0.6; cursor: not-allowed;" title="Bot penalizado por infracción hasta que expire la suspensión.">
              <i class="fa-solid fa-ban"></i> Penalizado (${bot.penaltyRemainingDays || 1}d)
            </button>
          ` : isExpired ? `
            <a href="https://wa.me/?text=Hola%20Administrador,%20deseo%20pagar%20para%20activar%20mi%20bot%20${encodeURIComponent(bot.name)}" target="_blank" class="btn-pay-whatsapp btn-sm">
              <i class="fa-brands fa-whatsapp"></i> Pagar p/ Encender
            </a>
          ` : `
            <button class="btn btn-sm ${isOnline || isConnecting || isQr ? 'btn-danger' : 'btn-success'}"
                    onclick="toggleBotPower('${bot.id}', ${isOnline || isConnecting || isQr})">
              <i class="fa-solid ${isOnline || isConnecting || isQr ? 'fa-power-off' : 'fa-play'}"></i>
              ${isOnline || isConnecting || isQr ? 'Apagar' : 'Encender'}
            </button>
          `}

          <button class="btn btn-secondary btn-sm" onclick="openQrModalForBot('${bot.id}', '${escapeHtml(bot.name)}')">
            <i class="fa-solid fa-qrcode"></i> QR
          </button>

          <button class="btn btn-secondary btn-sm" onclick="openBotAccessModal('${bot.id}')" title="Habilitar o bloquear grupos y chats para este bot">
            <i class="fa-solid fa-shield-halved text-green"></i> Grupos
          </button>

          ${state.currentUser?.role === 'admin' ? `
            <button class="btn btn-secondary btn-sm" onclick="openSubscriptionModal('${bot.id}')" title="Ajustar tiempo y pagos como Administrador">
              <i class="fa-solid fa-clock text-orange"></i> Tiempo
            </button>
            ${isPenalized ? `
              <button class="btn btn-success btn-sm" onclick="quickPardonBot('${bot.id}', '${escapeHtml(bot.name)}')" title="Levantar penalización como Administrador">
                <i class="fa-solid fa-dove"></i> Indultar
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm text-red" onclick="quickPenalizeBot('${bot.id}', '${escapeHtml(bot.name)}')" title="Penalizar bot con días">
                <i class="fa-solid fa-gavel"></i> Sanción
              </button>
            `}
          ` : ''}

          <!-- PERSONALIDAD Y PALABRAS -->
          <button class="btn btn-secondary btn-sm" onclick="openPersonalityModal('${bot.id}')" title="Configurar personalidad, tono y palabras prohibidas">
            <i class="fa-solid fa-sliders text-purple"></i> Personalidad
          </button>

          <!-- MODO HABLAR POR MÍ (PILOTO AUTOMÁTICO) -->
          <button class="btn btn-secondary btn-sm btn-icon" title="Ajustes de Hablar por Mí (Piloto)" onclick="openPilotSettingsModal('${bot.id}')">
            <i class="fa-solid fa-microphone-lines text-purple"></i>
          </button>

          <!-- PROBAR CHAT SIMULADO (#8) -->
          <button class="btn btn-secondary btn-sm btn-icon" title="Simular Chat en Vivo" onclick="openSimulatorModal('${bot.id}', '${escapeHtml(bot.name)}')">
            <i class="fa-solid fa-comments text-purple"></i>
          </button>

          <!-- AJUSTES AVANZADOS (#11 Horarios, #20 Humano, #42 Webhooks) -->
          <button class="btn btn-secondary btn-sm btn-icon" title="Ajustes Avanzados (Horarios, Webhook, IA)" onclick="openBotSettingsModal('${bot.id}')">
            <i class="fa-solid fa-gear"></i>
          </button>

          <!-- EDITAR FACETA -->
          <button class="btn btn-secondary btn-sm btn-icon" title="Editar Faceta" onclick="openEditBotModal('${bot.id}')">
            <i class="fa-solid fa-sliders"></i>
          </button>

          <button class="btn btn-secondary btn-sm btn-icon text-red" title="Eliminar Bot" onclick="confirmDeleteBot('${bot.id}', '${escapeHtml(bot.name)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Mostrar tarjeta para añadir nuevo bot mientras no se alcance el límite máximo de 4 bots
  if (state.bots.length < MAX_BOTS) {
    const remaining = MAX_BOTS - state.bots.length;
    grid.innerHTML += `
      <div class="bot-add-card" onclick="openCreateBotStudio();">
        <div class="bot-add-icon">
          <i class="fa-solid fa-plus"></i>
        </div>
        <h4>Crear Nuevo Bot (${state.bots.length} / ${MAX_BOTS})</h4>
        <p>Vincular otro número de WhatsApp (${remaining} espacio${remaining === 1 ? '' : 's'} disponible${remaining === 1 ? '' : 's'} de ${MAX_BOTS}).</p>
      </div>
    `;
  } else {
    grid.innerHTML += `
      <div class="bot-limit-reached-bar" style="grid-column: 1 / -1;">
        <i class="fa-solid fa-shield-halved text-purple"></i>
        <span><strong>Capacidad completa (${MAX_BOTS} / ${MAX_BOTS} bots):</strong> Has alcanzado el máximo de bots de tu plan. <a href="javascript:void(0)" onclick="switchTab('billing')">Mejorar plan</a></span>
      </div>
    `;
  }
}

function updateStats() {
  const total = state.bots.length;
  const online = state.bots.filter(b => b.status === 'online').length;
  const offline = total - online;
  const remaining = Math.max(0, MAX_BOTS - total);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('statTotalBots', `${total} / ${MAX_BOTS}`);
  setEl('statOnlineBots', online);
  setEl('statOfflineBots', offline);
  setEl('headerBotsCount', `${total} / ${MAX_BOTS} Bots (${online} en línea)`);
  setEl('headerBotsCountShort', `${total}/${MAX_BOTS}`);
  setEl('sidebarOnlineCount', `${online} / ${MAX_BOTS}`);
  setEl('sidebarBotsCount', `${total}/${MAX_BOTS}`);

  const trendEl = document.getElementById('statTotalBotsTrend');
  if (trendEl) {
    trendEl.innerHTML = total >= MAX_BOTS
      ? '<i class="fa-solid fa-lock"></i> Capacidad máxima alcanzada (4/4)'
      : `<i class="fa-solid fa-robot"></i> ${remaining} espacio${remaining === 1 ? '' : 's'} disponible${remaining === 1 ? '' : 's'} (máx. ${MAX_BOTS})`;
  }

  const addBtn = document.getElementById('openAddBotBtn');
  const addBtnText = document.getElementById('openAddBotBtnText');
  if (addBtnText) {
    addBtnText.textContent = total >= MAX_BOTS ? `Límite ${MAX_BOTS}/${MAX_BOTS}` : 'Nuevo Bot';
  }
  if (addBtn) {
    addBtn.style.opacity = total >= MAX_BOTS ? '0.68' : '1';
  }

  const progBar = document.getElementById('sidebarProgressBar');
  if (progBar) {
    const pct = Math.min(100, (online / MAX_BOTS) * 100);
    progBar.style.width = `${pct}%`;
  }
}

function updateBotFilterOptions() {
  const botOptions = state.bots.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (${b.id})</option>`).join('');
  ['logBotFilter', 'fnBotSelect', 'leadBotFilter', 'prodBotSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<option value="all">Todos los Bots</option>${botOptions}`;
  });
}

function resetBotModalToCreate() {
  document.getElementById('editBotIdInput').value = '';
  document.getElementById('botNameInput').value = '';
  document.getElementById('botPhoneInput').value = '';
  const pInput = document.getElementById('botPurposeInput');
  if (pInput) pInput.value = '';
  document.getElementById('saveBotSubmitText').textContent = 'Crear & Activar Bot';

  selectStudioFacet('recreational');
  selectStudioTone('friendly');
  const indSelect = document.getElementById('botIndustrySelect');
  if (indSelect) indSelect.value = 'ecommerce';

  if (document.getElementById('botAiAutoReplyInput')) document.getElementById('botAiAutoReplyInput').checked = true;
  if (document.getElementById('modAudioToggle')) document.getElementById('modAudioToggle').checked = true;
  if (document.getElementById('modCatalogToggle')) document.getElementById('modCatalogToggle').checked = true;
  if (document.getElementById('modCrmToggle')) document.getElementById('modCrmToggle').checked = true;
  if (document.getElementById('modHoursToggle')) document.getElementById('modHoursToggle').checked = false;
  if (document.getElementById('modHandoffToggle')) document.getElementById('modHandoffToggle').checked = true;
  if (document.getElementById('modAntispamToggle')) document.getElementById('modAntispamToggle').checked = false;
  if (document.getElementById('botInitialScopeSelect')) document.getElementById('botInitialScopeSelect').value = 'private_and_groups';

  const phoneRadio = document.querySelector('input[name="pairingMode"][value="qr"]');
  if (phoneRadio) phoneRadio.checked = true;
  toggleStudioPairingMode('qr');

  regenerateStudioWelcome();
  jumpToStudioStep(1);
  updatePreviewLive();
}

function openEditBotModal(botId) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;

  document.getElementById('editBotIdInput').value = bot.id;
  document.getElementById('botNameInput').value = bot.name;
  document.getElementById('botPhoneInput').value = bot.phone || '';
  const pInput = document.getElementById('botPurposeInput');
  if (pInput) pInput.value = bot.purpose || '';
  document.getElementById('botPrefixInput').value = bot.prefix || '#';
  document.getElementById('botAiAutoReplyInput').checked = Boolean(bot.ai_auto_reply);
  document.getElementById('botSystemPromptInput').value = bot.system_prompt || (FACET_PRESETS[bot.personality]?.prompt || '');
  document.getElementById('saveBotSubmitText').textContent = 'Guardar Cambios';

  const s = bot.settings || {};
  const indSelect = document.getElementById('botIndustrySelect');
  if (indSelect) indSelect.value = s.industry || 'ecommerce';

  selectStudioTone(s.tone || 'friendly');
  selectStudioFacet(bot.personality || 'recreational');

  const welcomeInput = document.getElementById('botWelcomeMsgInput');
  if (welcomeInput) welcomeInput.value = s.welcomeMessage || '';

  const faqInput = document.getElementById('botFaqQuickInput');
  if (faqInput) faqInput.value = s.faqQuick || '';

  const mods = s.modules || {};
  if (document.getElementById('modAudioToggle')) document.getElementById('modAudioToggle').checked = mods.audio !== false;
  if (document.getElementById('modCatalogToggle')) document.getElementById('modCatalogToggle').checked = mods.catalog !== false;
  if (document.getElementById('modCrmToggle')) document.getElementById('modCrmToggle').checked = mods.crm !== false;
  if (document.getElementById('modHoursToggle')) document.getElementById('modHoursToggle').checked = Boolean(mods.hours);
  if (document.getElementById('modHandoffToggle')) document.getElementById('modHandoffToggle').checked = mods.handoff !== false;
  if (document.getElementById('modAntispamToggle')) document.getElementById('modAntispamToggle').checked = Boolean(mods.antispam);

  const scopeSel = document.getElementById('botInitialScopeSelect');
  if (scopeSel) {
    const ac = s.accessControl || {};
    if (ac.allowPrivateChats === false) scopeSel.value = 'groups_only';
    else if (ac.groupMode === 'none') scopeSel.value = 'private_only';
    else scopeSel.value = 'private_and_groups';
  }

  jumpToStudioStep(1);
  updatePreviewLive();
  openModal('addBotModal');
}

async function toggleBotPower(botId, isRunning) {
  const endpoint = isRunning ? `/api/bots/${botId}/stop` : `/api/bots/${botId}/start`;
  showToast(isRunning ? 'Apagando bot...' : 'Iniciando bot...', 'info');

  try {
    const res = await authFetch(endpoint, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message || (isRunning ? 'Bot apagado' : 'Bot encendido'), 'success');
      await fetchBots();
      if (!isRunning) {
        const bot = state.bots.find(b => b.id === botId);
        if (!bot || bot.status !== 'online') {
          openQrModalForBot(botId, bot?.name || 'Bot');
        }
      }
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function restartBot(botId) {
  showToast('Reiniciando conexión...', 'info');
  try {
    const res = await authFetch(`/api/bots/${botId}/restart`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('Bot reiniciado correctamente', 'success');
      fetchBots();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function confirmDeleteBot(botId, botName) {
  if (!confirm(`¿Eliminar el bot "${botName}" (${botId})?`)) return;
  try {
    const res = await authFetch(`/api/bots/${botId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      showToast(`Bot "${botName}" eliminado`, 'success');
      state.bots = state.bots.filter(b => b.id !== botId);
      renderBots();
      updateStats();
      updateFacetCounters();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

function finalizeConnectedBotToDashboard(botIdOverride = null, botNameOverride = null) {
  const targetBotId = botIdOverride || state.activeQrBotId || state.handlingQrSuccessFor;
  const targetBotName = botNameOverride || state.activeQrBotName || 'Bot';

  if (state.qrCloseTimeout) {
    clearTimeout(state.qrCloseTimeout);
    state.qrCloseTimeout = null;
  }

  closeModal('qrModal');
  resetFacetFilterToAll();
  showDashboard();
  switchTab('bots');

  if (targetBotId) {
    state.justConnectedBotId = targetBotId;
    renderBots();
    setTimeout(() => {
      const cardEl = document.querySelector(`.bot-card[data-bot-id="${targetBotId}"]`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    setTimeout(() => {
      if (state.justConnectedBotId === targetBotId) {
        state.justConnectedBotId = null;
        renderBots();
      }
    }, 4500);
  }

  showToast(`Bot "${targetBotName}" conectado y agregado al panel de control.`, 'success');
}
window.finalizeConnectedBotToDashboard = finalizeConnectedBotToDashboard;

async function handleBotConnectedSuccess(botId, botName) {
  if (state.handlingQrSuccessFor === botId) return;
  state.handlingQrSuccessFor = botId;

  if (state.qrPollInterval) {
    clearInterval(state.qrPollInterval);
    state.qrPollInterval = null;
  }

  const tabsBar = document.getElementById('qrModalTabs');
  const viewCode = document.getElementById('viewPairingCode');
  const viewQr = document.getElementById('viewQrCode');
  const viewSuccess = document.getElementById('viewConnectedSuccess');
  const refreshBtn = document.getElementById('btnRefreshQr');
  const st = document.getElementById('qrStatusText');

  if (tabsBar) tabsBar.style.display = 'none';
  if (viewCode) viewCode.style.display = 'none';
  if (viewQr) viewQr.style.display = 'none';
  if (refreshBtn) refreshBtn.style.display = 'none';
  if (viewSuccess) viewSuccess.style.display = 'block';
  if (st) st.innerHTML = '<span class="status-dot green"></span> En línea &bull; Agregando al panel de control...';

  resetFacetFilterToAll();
  state.justConnectedBotId = botId;
  showDashboard();

  await fetchBots();

  // Garantizar que el bot recién conectado esté presente en state.bots y marcado en línea
  let existing = state.bots.find(b => b.id === botId);
  if (!existing) {
    try {
      const singleRes = await authFetch(`/api/bots/${botId}`);
      const singleData = await singleRes.json();
      if (singleData.ok && singleData.bot) {
        upsertBotInState({ ...singleData.bot, status: 'online' });
        existing = state.bots.find(b => b.id === botId);
      }
    } catch { /* ignorar */ }
  } else {
    existing.status = 'online';
  }

  renderBots();
  updateStats();
  updateFacetCounters();

  if (state.qrCloseTimeout) clearTimeout(state.qrCloseTimeout);
  state.qrCloseTimeout = setTimeout(() => {
    finalizeConnectedBotToDashboard(botId, botName || existing?.name || 'Bot');
  }, 900);
}

async function openQrModalForBot(botId, botName, preferredMode = null) {
  state.activeQrBotId = botId;
  state.activeQrBotName = botName;
  state.handlingQrSuccessFor = null;

  if (state.qrPollInterval) {
    clearInterval(state.qrPollInterval);
    state.qrPollInterval = null;
  }
  if (state.qrCloseTimeout) {
    clearTimeout(state.qrCloseTimeout);
    state.qrCloseTimeout = null;
  }

  const titleEl = document.getElementById('qrModalTitle');
  if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-link text-purple"></i> Vincular: ${escapeHtml(botName)}`;

  const tabsBar = document.getElementById('qrModalTabs');
  const viewSuccess = document.getElementById('viewConnectedSuccess');
  const refreshBtn = document.getElementById('btnRefreshQr');

  const bot = state.bots.find(b => b.id === botId);
  const targetPhoneEl = document.getElementById('pairingTargetPhone');
  if (targetPhoneEl) {
    targetPhoneEl.textContent = bot?.phone ? `+${bot.phone}` : 'No especificado';
  }

  if (bot && bot.status === 'online') {
    if (tabsBar) tabsBar.style.display = 'none';
    const viewCode = document.getElementById('viewPairingCode');
    const viewQr = document.getElementById('viewQrCode');
    if (viewCode) viewCode.style.display = 'none';
    if (viewQr) viewQr.style.display = 'none';
    if (refreshBtn) refreshBtn.style.display = 'none';
    if (viewSuccess) viewSuccess.style.display = 'block';
    const st = document.getElementById('qrStatusText');
    if (st) st.innerHTML = `<span class="status-dot green"></span> Sesión activa en WhatsApp (+${escapeHtml(bot.phone || '')})`;
    openModal('qrModal');
    return;
  }

  if (tabsBar) tabsBar.style.display = 'flex';
  if (refreshBtn) refreshBtn.style.display = 'inline-flex';
  if (viewSuccess) viewSuccess.style.display = 'none';

  // Precargar lo que ya exista. Por defecto se muestra el QR; el código de 8 caracteres
  // solo se genera cuando el usuario lo solicita explícitamente.
  const valEl = document.getElementById('pairingCodeVal');
  if (valEl && !bot?.pairing_code) valEl.textContent = '--------';
  if (preferredMode === 'code' || bot?.pairing_code) {
    if (bot?.pairing_code) renderPairingCode(bot.pairing_code);
    switchPairingTab('code');
  } else {
    switchPairingTab('qr');
    if (bot?.qr_code) {
      renderQrModal(bot.qr_code);
    } else {
      const box = document.getElementById('qrDisplayBox');
      if (box) box.innerHTML = `<div class="qr-loading"><i class="fa-solid fa-spinner fa-spin"></i><p>Generando código QR...</p></div>`;
      const st = document.getElementById('qrStatusText');
      if (st) st.innerHTML = '<span class="status-dot yellow"></span> Conectando con WhatsApp...';
    }
  }

  openModal('qrModal');

  if (preferredMode === 'code' && !bot?.pairing_code) {
    requestPairingCodeNow();
  } else {
    // Encender el bot si está apagado (si ya tiene un QR activo, el servidor no lo reinicia)
    authFetch(`/api/bots/${botId}/start`, { method: 'POST' }).catch(() => {});
  }

  // Polling activo para renderizado instantáneo (<500ms)
  const checkQrNow = async () => {
    if (state.activeQrBotId !== botId) return;
    try {
      const res = await authFetch(`/api/bots/${botId}/qr`);
      const data = await res.json();
      if (!data.ok) return;

      if (data.status === 'online') {
        await handleBotConnectedSuccess(botId, botName);
        return;
      }

      if (data.pairing_code) {
        renderPairingCode(data.pairing_code);
      }
      if (data.qr_code) {
        renderQrModal(data.qr_code);
      }
      if ((data.status === 'stopped' || data.status === 'logged_out') && !data.qr_code && !data.pairing_code) {
        const st = document.getElementById('qrStatusText');
        if (st && !st.innerHTML.includes('Reactivar')) {
          st.innerHTML = '<span class="status-dot yellow"></span> Código expirado. <button type="button" class="btn btn-primary btn-sm" onclick="handleRefreshQrModal()" style="margin-left:8px; padding: 3px 8px; font-size: 11px;"><i class="fa-solid fa-rotate"></i> Reactivar Código</button>';
        }
      }
    } catch (e) {
      // Ignorar errores transitorios
    }
  };

  await checkQrNow();

  let polls = 0;
  state.qrPollInterval = setInterval(async () => {
    polls++;
    if (polls > 160 || state.activeQrBotId !== botId) {
      clearInterval(state.qrPollInterval);
      state.qrPollInterval = null;
      return;
    }
    await checkQrNow();
  }, 500);
}

function switchPairingTab(mode) {
  const viewCode = document.getElementById('viewPairingCode');
  const viewQr = document.getElementById('viewQrCode');
  const tabBtnCode = document.getElementById('tabBtnCode');
  const tabBtnQr = document.getElementById('tabBtnQr');

  if (mode === 'code') {
    if (viewCode) viewCode.style.display = 'block';
    if (viewQr) viewQr.style.display = 'none';
    if (tabBtnCode) {
      tabBtnCode.className = 'btn btn-sm flex-1';
      tabBtnCode.style.borderBottom = '2px solid var(--primary)';
    }
    if (tabBtnQr) {
      tabBtnQr.className = 'btn btn-sm btn-secondary flex-1';
      tabBtnQr.style.borderBottom = '2px solid transparent';
    }
  } else {
    if (viewCode) viewCode.style.display = 'none';
    if (viewQr) viewQr.style.display = 'block';
    if (tabBtnQr) {
      tabBtnQr.className = 'btn btn-sm flex-1';
      tabBtnQr.style.borderBottom = '2px solid var(--primary)';
    }
    if (tabBtnCode) {
      tabBtnCode.className = 'btn btn-sm btn-secondary flex-1';
      tabBtnCode.style.borderBottom = '2px solid transparent';
    }
  }
}
window.switchPairingTab = switchPairingTab;

function renderQrModal(qrDataUrl) {
  const box = document.getElementById('qrDisplayBox');
  if (box && (!box.querySelector('img') || box.querySelector('img').src !== qrDataUrl)) {
    box.innerHTML = `<img src="${qrDataUrl}" alt="Código QR WhatsApp" style="max-width: 250px; width: 100%; height: auto; display: block; margin: 0 auto; border: 1px solid rgba(255,255,255,0.08);" />`;
  }
  const st = document.getElementById('qrStatusText');
  if (st) st.innerHTML = '<span class="status-dot yellow"></span> Código QR listo. Escanea con WhatsApp.';
}

function renderPairingCode(code) {
  const val = document.getElementById('pairingCodeVal');
  if (val) {
    // Formatear código en dos grupos si tiene 8 caracteres (ej: ABCD-1234)
    const raw = String(code).trim().replace(/[^a-zA-Z0-9]/g, '');
    if (raw.length === 8) {
      val.textContent = `${raw.slice(0, 4)} - ${raw.slice(4)}`;
    } else {
      val.textContent = code;
    }
  }
  const st = document.getElementById('qrStatusText');
  if (st) st.innerHTML = '<span class="status-dot green"></span> Código de 8 dígitos listo. Ingrésalo en tu WhatsApp.';
}

function copyPairingCodeVal() {
  const val = document.getElementById('pairingCodeVal');
  if (!val || val.textContent.includes('-') && val.textContent.trim() === '--------') {
    showToast('Aún no hay un código generado', 'warning');
    return;
  }
  const cleanCode = val.textContent.replace(/[\s-]/g, '').trim();
  navigator.clipboard.writeText(cleanCode).then(() => {
    showToast(`Código ${cleanCode} copiado al portapapeles`, 'success');
  }).catch(() => {
    showToast(`Código: ${cleanCode}`, 'info');
  });
}
window.copyPairingCodeVal = copyPairingCodeVal;

async function requestPairingCodeNow() {
  if (!state.activeQrBotId) return;
  const val = document.getElementById('pairingCodeVal');
  const st = document.getElementById('qrStatusText');
  if (val) val.textContent = 'GENERANDO...';
  if (st) st.innerHTML = '<span class="status-dot yellow"></span> Solicitando código a WhatsApp...';

  try {
    const res = await authFetch(`/api/bots/${state.activeQrBotId}/pairing-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.ok && data.pairingCode) {
      renderPairingCode(data.pairingCode);
      showToast('Código de vinculación generado con éxito', 'success');
    } else if (data.status === 'online') {
      await handleBotConnectedSuccess(state.activeQrBotId, state.activeQrBotName);
    } else {
      if (val) val.textContent = 'REINTENTAR';
      if (st) st.innerHTML = '<span class="status-dot red"></span> No se pudo generar código. Usa Código QR.';
    }
  } catch (err) {
    if (val) val.textContent = 'REINTENTAR';
    if (st) st.innerHTML = `<span class="status-dot red"></span> Error: ${err.message}`;
  }
}
window.requestPairingCodeNow = requestPairingCodeNow;

async function handleRefreshQrModal() {
  if (!state.activeQrBotId) return;
  const box = document.getElementById('qrDisplayBox');
  const st = document.getElementById('qrStatusText');
  const val = document.getElementById('pairingCodeVal');
  const isCodeTabVisible = document.getElementById('viewPairingCode')?.style.display !== 'none';

  if (box) box.innerHTML = '<div class="qr-loading"><i class="fa-solid fa-spinner fa-spin"></i><p>Regenerando sesión limpia...</p></div>';
  if (val) val.textContent = 'GENERANDO...';
  if (st) st.innerHTML = '<span class="status-dot yellow"></span> Reiniciando sesión segura...';

  try {
    const res = await authFetch(`/api/bots/${state.activeQrBotId}/reset-session`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('Sesión limpia regenerada con éxito', 'info');
      const bot = state.bots.find(b => b.id === state.activeQrBotId);
      if (isCodeTabVisible && bot?.phone) {
        setTimeout(requestPairingCodeNow, 800);
      }
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
  }
}
window.handleRefreshQrModal = handleRefreshQrModal;

// ==========================================
// AJUSTES AVANZADOS DEL BOT (#11 Horarios, #20 Humano, #42 Webhooks)
// ==========================================
function initSettingsSubtabs() {
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetSubtab = btn.dataset.subtab;
      document.querySelectorAll('.subtab-content').forEach(st => st.classList.remove('active'));
      const activeContent = document.getElementById(`subtab-${targetSubtab}`);
      if (activeContent) activeContent.classList.add('active');
    });
  });

  const tempSlider = document.getElementById('setAiTemp');
  const tempDisplay = document.getElementById('tempValueDisplay');
  if (tempSlider && tempDisplay) {
    tempSlider.addEventListener('input', () => { tempDisplay.textContent = tempSlider.value; });
  }
}

function openBotSettingsModal(botId) {
  state.activeSettingsBotId = botId;
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;

  document.getElementById('advancedBotIdInput').value = botId;
  document.getElementById('botSettingsModalTitle').innerHTML = `<i class="fa-solid fa-sliders text-purple"></i> Ajustes: ${escapeHtml(bot.name)}`;

  const s = bot.settings || {};
  const bh = s.businessHours || {};

  document.getElementById('setBhEnabled').checked = Boolean(bh.enabled);
  document.getElementById('setBhStart').value = bh.startTime || '09:00';
  document.getElementById('setBhEnd').value = bh.endTime || '18:00';
  document.getElementById('setBhOffMsg').value = bh.offHoursMsg || '';

  const daysAllowed = Array.isArray(bh.days) ? bh.days : [1, 2, 3, 4, 5];
  document.querySelectorAll('.day-opt').forEach(chk => {
    chk.checked = daysAllowed.includes(parseInt(chk.value, 10));
  });

  document.getElementById('setHandoffMinutes').value = s.humanHandoffMinutes || 60;
  document.getElementById('setHandoffMsg').value = s.humanHandoffMsg || '';

  document.getElementById('setAiTemp').value = s.aiTemperature || 0.7;
  document.getElementById('tempValueDisplay').textContent = s.aiTemperature || 0.7;
  document.getElementById('setAiTone').value = s.aiTone || 'friendly';

  document.getElementById('setWebhookUrl').value = s.webhookUrl || '';

  openModal('botSettingsModal');
}

// ==========================================
// SIMULADOR DE CHAT EN VIVO (#8)
// ==========================================
function openSimulatorModal(botId, botName) {
  state.activeSimBotId = botId;
  document.getElementById('simModalTitle').textContent = `Simulador: ${botName}`;
  const container = document.getElementById('simMessagesContainer');
  container.innerHTML = `<div class="chat-bubble bot"><span>¡Hola! Soy <strong>${escapeHtml(botName)}</strong> en modo simulación. Escribe algo para probar mis respuestas.</span></div>`;
  openModal('chatSimulatorModal');
  setTimeout(() => document.getElementById('simChatInput').focus(), 300);
}

// ==========================================
// CRM LEADS (PROSPECTOS)
// ==========================================
async function fetchLeads() {
  const botFilter = document.getElementById('leadBotFilter')?.value || 'all';
  const statusFilter = document.getElementById('leadStatusFilter')?.value || 'all';
  const search = document.getElementById('leadSearchInput')?.value || '';

  const params = new URLSearchParams({ botId: botFilter, status: statusFilter, search: search.trim() });
  try {
    const res = await fetch(`/api/leads?${params.toString()}`);
    const data = await res.json();
    if (data.ok) {
      state.leads = data.leads;
      renderLeads();
      const countEl = document.getElementById('navLeadsCount');
      if (countEl) countEl.textContent = state.leads.length;
    }
  } catch (err) { console.error('Error fetching leads:', err); }
}

function renderLeads() {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;

  if (!state.leads.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 40px 20px;">
      <i class="fa-solid fa-address-book" style="font-size: 32px; opacity: 0.35; margin-bottom: 10px; display: block;"></i>
      <strong style="color: var(--text-secondary); font-size: 14px; display: block;">Base de datos de leads limpia (0 prospectos)</strong>
      <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 4px;">
        Haz clic en <strong>"+ Nuevo Prospecto"</strong> para registrar uno o cuando los clientes escriban por WhatsApp a tus bots se capturarán aquí automáticamente.
      </span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = state.leads.map(lead => {
    const date = new Date(lead.created_at).toLocaleDateString('es-ES');
    return `
      <tr>
        <td><strong>${escapeHtml(lead.name || 'Sin nombre')}</strong></td>
        <td><code>+${escapeHtml(lead.phone || '-')}</code></td>
        <td>${escapeHtml(lead.email || '-')}</td>
        <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(lead.interest)}">${escapeHtml(lead.interest || '-')}</td>
        <td><span class="badge badge-info">${escapeHtml(lead.bot_id || 'all')}</span></td>
        <td>
          <select class="form-input form-input-sm" style="padding: 4px 8px; font-size: 12px;" onchange="changeLeadStatus('${lead.id}', this.value)">
            <option value="nuevo" ${lead.status === 'nuevo' ? 'selected' : ''}>Nuevo</option>
            <option value="contactado" ${lead.status === 'contactado' ? 'selected' : ''}>En Seguimiento</option>
            <option value="ganado" ${lead.status === 'ganado' ? 'selected' : ''}>Venta Cerrada</option>
            <option value="perdido" ${lead.status === 'perdido' ? 'selected' : ''}>Perdido</option>
          </select>
        </td>
        <td><small class="text-muted">${date}</small></td>
        <td>
          <button class="btn btn-secondary btn-sm btn-icon text-red" title="Eliminar Lead" onclick="deleteLeadItem('${lead.id}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function changeLeadStatus(leadId, newStatus) {
  try {
    await fetch(`/api/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    showToast('Estado del prospecto actualizado', 'success');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function deleteLeadItem(leadId) {
  if (!confirm('¿Eliminar este prospecto?')) return;
  try {
    await fetch(`/api/leads/${leadId}`, { method: 'DELETE' });
    showToast('Prospecto eliminado', 'success');
    fetchLeads();
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ==========================================
// CATÁLOGO DE PRODUCTOS (#9)
// ==========================================
async function fetchProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (data.ok) {
      state.products = data.products;
      renderProducts();
    }
  } catch (err) { console.error('Error fetching products:', err); }
}

function renderProducts() {
  const tbody = document.getElementById('catalogTableBody');
  const countEl = document.getElementById('catalogCount');
  if (countEl) countEl.textContent = `${state.products.length} productos`;
  if (!tbody) return;

  if (!state.products.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 40px 20px;">
      <i class="fa-solid fa-boxes-stacked" style="font-size: 32px; opacity: 0.35; margin-bottom: 10px; display: block;"></i>
      <strong style="color: var(--text-secondary); font-size: 14px; display: block;">Catálogo limpio (0 productos registrados)</strong>
      <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 4px;">
        Haz clic en <strong>"+ Añadir Producto"</strong> para registrar artículos, planes o servicios reales que tus bots ofrecerán.
      </span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = state.products.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><span class="badge badge-purple">${escapeHtml(p.category || 'General')}</span></td>
      <td><strong>${p.price} ${escapeHtml(p.currency || 'USD')}</strong></td>
      <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(p.description)}">${escapeHtml(p.description || '-')}</td>
      <td><span class="badge badge-info">${escapeHtml(p.bot_id || 'all')}</span></td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" ${p.is_active ? 'checked' : ''} onchange="toggleProductActive('${p.id}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm btn-icon" title="Editar Producto" onclick="openEditProductModal('${p.id}')">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-secondary btn-sm btn-icon text-red" title="Eliminar Producto" onclick="deleteProductItem('${p.id}', '${escapeHtml(p.name)}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function toggleProductActive(prodId, isActive) {
  try {
    await fetch(`/api/products/${prodId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive })
    });
    showToast(isActive ? 'Producto visible' : 'Producto oculto', 'success');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

function openEditProductModal(prodId) {
  const p = state.products.find(item => item.id === prodId);
  if (!p) return;

  document.getElementById('productIdInput').value = p.id;
  document.getElementById('prodNameInput').value = p.name;
  document.getElementById('prodPriceInput').value = p.price;
  document.getElementById('prodCurrencyInput').value = p.currency || 'USD';
  document.getElementById('prodCategoryInput').value = p.category || 'General';
  document.getElementById('prodBotSelect').value = p.bot_id || 'all';
  document.getElementById('prodDescInput').value = p.description || '';
  document.getElementById('prodActiveInput').checked = p.is_active;

  document.getElementById('productModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-green"></i> Editar Producto';
  openModal('productModal');
}

async function deleteProductItem(prodId, prodName) {
  if (!confirm(`¿Eliminar el producto "${prodName}"?`)) return;
  try {
    await fetch(`/api/products/${prodId}`, { method: 'DELETE' });
    showToast('Producto eliminado', 'success');
    fetchProducts();
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ==========================================
// FUNCIONES Y REGLAS (CRUD)
// ==========================================
async function fetchFunctions() {
  try {
    const res = await fetch('/api/functions');
    const data = await res.json();
    if (data.ok) {
      state.functions = data.functions;
      renderFunctions();
    }
  } catch (err) { console.error('Error fetching functions:', err); }
}

function renderFunctions() {
  const tbody = document.getElementById('functionsTableBody');
  const countBadge = document.getElementById('functionsCount');
  if (countBadge) countBadge.textContent = `${state.functions.length} funciones`;
  if (!tbody) return;

  if (!state.functions.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 40px 20px;">
      <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 32px; opacity: 0.35; margin-bottom: 10px; display: block;"></i>
      <strong style="color: var(--text-secondary); font-size: 14px; display: block;">Base de datos limpia (0 reglas o funciones configuradas)</strong>
      <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 4px;">
        Haz clic en <strong>"+ Añadir Función"</strong> para crear respuestas automáticas reales cuando los usuarios envíen ciertas palabras o comandos.
      </span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = state.functions.map(fn => {
    let typeBadge = 'badge-purple';
    let typeLabel = 'Comando';
    if (fn.trigger_type === 'exact') { typeBadge = 'badge-info'; typeLabel = 'Texto Exacto'; }
    if (fn.trigger_type === 'contains') { typeBadge = 'badge-warning'; typeLabel = 'Contiene'; }
    if (fn.trigger_type === 'regex') { typeBadge = 'badge-danger'; typeLabel = 'Regex'; }

    return `
      <tr>
        <td><strong>${escapeHtml(fn.name)}</strong></td>
        <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
        <td><code>${escapeHtml(fn.trigger_value)}</code></td>
        <td style="max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(fn.response_text)}">${escapeHtml(fn.response_text)}</td>
        <td><span class="badge badge-info">${escapeHtml(fn.bot_id === 'all' ? 'Todos los Bots' : fn.bot_id)}</span></td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" ${fn.is_enabled ? 'checked' : ''} onchange="toggleFunctionEnabled('${fn.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm btn-icon" title="Editar" onclick="openEditFunctionModal('${fn.id}')">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-secondary btn-sm btn-icon text-red" title="Eliminar" onclick="confirmDeleteFunction('${fn.id}', '${escapeHtml(fn.name)}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleFunctionEnabled(fnId, isEnabled) {
  try {
    await fetch(`/api/functions/${fnId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_enabled: isEnabled })
    });
    showToast(isEnabled ? 'Función activada' : 'Función desactivada', 'success');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

function openEditFunctionModal(fnId) {
  const fn = state.functions.find(f => f.id === fnId);
  if (!fn) return;

  document.getElementById('functionModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square text-purple"></i> Editar Función';
  document.getElementById('functionIdInput').value = fn.id;
  document.getElementById('fnNameInput').value = fn.name;
  document.getElementById('fnTriggerTypeInput').value = fn.trigger_type;
  document.getElementById('fnTriggerValueInput').value = fn.trigger_value;
  document.getElementById('fnBotSelect').value = fn.bot_id || 'all';
  document.getElementById('fnResponseTextInput').value = fn.response_text;
  document.getElementById('fnEnabledInput').checked = fn.is_enabled;

  openModal('functionModal');
}

async function confirmDeleteFunction(fnId, fnName) {
  if (!confirm(`¿Eliminar la función "${fnName}"?`)) return;
  try {
    await fetch(`/api/functions/${fnId}`, { method: 'DELETE' });
    showToast('Función eliminada', 'success');
    state.functions = state.functions.filter(f => f.id !== fnId);
    renderFunctions();
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ==========================================
// REGISTRO DE ACTIVIDAD (LOGS)
// ==========================================
async function fetchLogs() {
  const botFilter = document.getElementById('logBotFilter')?.value || 'all';
  const typeFilter = document.getElementById('logTypeFilter')?.value || 'all';
  const search = document.getElementById('logSearchInput')?.value || '';

  const params = new URLSearchParams({ limit: '60', botId: botFilter, type: typeFilter, search: search.trim() });
  try {
    const res = await fetch(`/api/logs?${params.toString()}`);
    const data = await res.json();
    if (data.ok) {
      state.logs = data.logs;
      renderLogs();
    }
  } catch (err) { console.error('Error fetching logs:', err); }
}

function renderLogs() {
  const tbody = document.getElementById('logsTableBody');
  if (!tbody) return;

  if (!state.logs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No se encontraron registros de actividad con los filtros aplicados.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.logs.map(log => {
    const time = new Date(log.created_at).toLocaleTimeString();
    let badgeClass = 'badge-info';
    let typeName = log.type;

    if (log.type === 'command') { badgeClass = 'badge-purple'; typeName = 'Comando'; }
    else if (log.type === 'message') { badgeClass = 'badge-info'; typeName = 'Mensaje'; }
    else if (log.type === 'ai_response') { badgeClass = 'badge-warning'; typeName = 'Respuesta IA'; }
    else if (log.type === 'custom_rule') { badgeClass = 'badge-success'; typeName = 'Regla Custom'; }
    else if (log.type === 'connection') { badgeClass = 'badge-info'; typeName = 'Conexión'; }
    else if (log.type === 'error') { badgeClass = 'badge-danger'; typeName = 'Error'; }

    return `
      <tr>
        <td><code>${time}</code></td>
        <td><span class="badge badge-info">${escapeHtml(log.bot_id || 'default')}</span></td>
        <td><span class="badge ${badgeClass}">${typeName}</span></td>
        <td><strong>${escapeHtml(log.sender_name || 'Desconocido')}</strong></td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 13px;">${escapeHtml(log.content || '')}</td>
        <td><span class="badge badge-success">Sincronizado</span></td>
      </tr>
    `;
  }).join('');
}

function initFilters() {
  ['logBotFilter', 'logTypeFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', fetchLogs);
  });

  const searchInput = document.getElementById('logSearchInput');
  let debounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchLogs, 300);
    });
  }

  const refreshLogsBtn = document.getElementById('refreshLogsBtn');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', () => { fetchLogs(); showToast('Logs actualizados', 'info'); });
  }

  ['leadBotFilter', 'leadStatusFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', fetchLeads);
  });

  const leadSearch = document.getElementById('leadSearchInput');
  let leadDebounce = null;
  if (leadSearch) {
    leadSearch.addEventListener('input', () => {
      clearTimeout(leadDebounce);
      leadDebounce = setTimeout(fetchLeads, 300);
    });
  }

  const exportBtn = document.getElementById('exportLeadsBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      window.location.href = '/api/leads/export';
    });
  }
}

// ==========================================
// CALCULADORA DE PRECIOS
// ==========================================
function initPricingCalculator() {
  const range = document.getElementById('botsSalesRange');
  const countDisplay = document.getElementById('botsSalesCount');
  const priceInput = document.getElementById('botPriceInput');
  const monthlyInput = document.getElementById('botMonthlyInput');

  function calculate() {
    const botsCount = parseInt(range.value, 10);
    const pricePerBot = parseFloat(priceInput.value) || 0;
    const monthlyFee = parseFloat(monthlyInput.value) || 0;

    countDisplay.textContent = `${botsCount} bot${botsCount > 1 ? 's' : ''}`;

    const immediateRevenue = botsCount * pricePerBot;
    const monthlyRevenue = botsCount * monthlyFee;
    const serverCost = 8;
    const netAnnual = (immediateRevenue) + (monthlyRevenue * 12) - (serverCost * 12);

    document.getElementById('calcImmediateRevenue').textContent = `$${immediateRevenue.toLocaleString()} USD`;
    document.getElementById('calcMonthlyRevenue').textContent = `$${monthlyRevenue.toLocaleString()} USD / mes`;
    document.getElementById('calcNetAnnual').textContent = `$${netAnnual.toLocaleString()} USD`;
  }

  if (range && priceInput && monthlyInput) {
    range.addEventListener('input', calculate);
    priceInput.addEventListener('input', calculate);
    monthlyInput.addEventListener('input', calculate);
    calculate();
  }
}

// ==========================================
// SECCIÓN SUPABASE & DIAGNÓSTICO
// ==========================================
function initSupabaseSection() {
  const testBtn = document.getElementById('testSupabaseBtn');
  const copySqlBtn = document.getElementById('copySqlBtn');

  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const diagBox = document.getElementById('supabaseDiagnostic');
      diagBox.innerHTML = '<p class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Verificando estado de sincronización en la nube...</p>';

      try {
        const res = await fetch('/api/supabase/test', { method: 'POST' });
        const data = await res.json();

        if (data.ok && data.tablesReady) {
          diagBox.innerHTML = `
            <div style="color: var(--green);">
              <strong><i class="fa-solid fa-circle-check"></i> ${escapeHtml(data.message)}</strong>
              <p class="text-muted" style="margin-top: 6px;">Todas las tablas requeridas ('bots', 'bot_leads', 'bot_products', 'bot_logs') están listas.</p>
            </div>
          `;
        } else if (data.tablesReady === false) {
          diagBox.innerHTML = `
            <div style="color: var(--yellow);">
              <strong><i class="fa-solid fa-circle-check text-green"></i> Almacenamiento Seguro Activo</strong>
              <p class="text-muted" style="margin-top: 6px;">${escapeHtml(data.message)}</p>
              <p style="margin-top: 6px;">Tus datos y registros están respaldados en la base de datos principal y en la nube.</p>
            </div>
          `;
        } else {
          diagBox.innerHTML = `
            <div style="color: var(--red);">
              <strong><i class="fa-solid fa-circle-xmark"></i> Error de conexión:</strong>
              <p style="margin-top: 6px;">${escapeHtml(data.error || 'No se pudo verificar el servicio en la nube')}</p>
            </div>
          `;
        }
      } catch (err) { diagBox.innerHTML = `<div style="color: var(--red);">Error: ${escapeHtml(err.message)}</div>`; }
    });
  }

  if (copySqlBtn) {
    copySqlBtn.addEventListener('click', () => {
      const code = document.getElementById('sqlCodeBlock').textContent;
      navigator.clipboard.writeText(code).then(() => showToast('¡Script SQL copiado!', 'success')).catch(() => showToast('Error al copiar', 'error'));
    });
  }
}

// ==========================================
// FORMULARIOS & MODALES
// ==========================================
function initModals() {
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });

  document.querySelectorAll('#openAddBotBtn, .open-add-bot-trigger').forEach(btn => {
    btn.addEventListener('click', () => { openCreateBotStudio(); });
  });

  const openAddFn = document.getElementById('openAddFunctionBtn');
  if (openAddFn) openAddFn.addEventListener('click', () => {
    document.getElementById('functionForm').reset();
    document.getElementById('functionIdInput').value = '';
    document.getElementById('functionModalTitle').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles text-purple"></i> Nueva Función Personalizada';
    openModal('functionModal');
  });

  const openAddProd = document.getElementById('openAddProductBtn');
  if (openAddProd) openAddProd.addEventListener('click', () => {
    document.getElementById('productForm').reset();
    document.getElementById('productIdInput').value = '';
    document.getElementById('productModalTitle').innerHTML = '<i class="fa-solid fa-box text-green"></i> Añadir Producto al Catálogo';
    openModal('productModal');
  });

  const openAddLead = document.getElementById('openAddLeadBtn');
  if (openAddLead) openAddLead.addEventListener('click', () => {
    document.getElementById('addLeadForm').reset();
    openModal('addLeadModal');
  });

  document.querySelectorAll('.var-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const v = pill.dataset.var;
      const textarea = document.getElementById('fnResponseTextInput');
      textarea.value += (textarea.value ? ' ' : '') + v;
      textarea.focus();
    });
  });
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
  document.body.style.overflow = '';
  if (id === 'qrModal') {
    if (state.qrPollInterval) {
      clearInterval(state.qrPollInterval);
      state.qrPollInterval = null;
    }
    if (state.qrCloseTimeout) {
      clearTimeout(state.qrCloseTimeout);
      state.qrCloseTimeout = null;
    }
    state.activeQrBotId = null;
    state.activeQrBotName = '';
    state.handlingQrSuccessFor = null;
  }
  if (id === 'chatSimulatorModal') {
    state.activeSimBotId = null;
  }
}

function initForms() {
  // Crear / Editar Bot
  const addBotForm = document.getElementById('addBotForm');
  if (addBotForm) {
    addBotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('editBotIdInput').value;
      const name = document.getElementById('botNameInput').value.trim();
      const phone = document.getElementById('botPhoneInput').value.trim();
      const cleanPhone = phone.replace(/\D/g, '');
      const prefix = document.getElementById('botPrefixInput').value;
      const purpose = document.getElementById('botPurposeInput')?.value.trim() || '';

      if (!editId && state.bots.length >= MAX_BOTS) {
        (window.promptUpgrade ? window.promptUpgrade : (m) => showToast(m, 'warning'))(`Tu plan permite hasta ${MAX_BOTS} bots. Mejora tu plan para crear más.`);
        return;
      }

      if (!editId && (!cleanPhone || cleanPhone.length < 8)) {
        showToast('El número de WhatsApp es obligatorio para conectar el bot (código país + número, ej: 573171736519)', 'warning');
        jumpToStudioStep(2);
        document.getElementById('botPhoneInput')?.focus();
        return;
      }
      const ai_auto_reply = document.getElementById('botAiAutoReplyInput').checked;
      const system_prompt = document.getElementById('botSystemPromptInput').value;
      const personality = state.selectedFacet || 'recreational';

      const prevBot = editId ? state.bots.find(b => b.id === editId) : null;
      const prevAc = prevBot?.settings?.accessControl || {};
      const selectedScope = document.getElementById('botInitialScopeSelect')?.value || 'private_and_groups';

      let accessControl = {
        allowPrivateChats: true,
        groupMode: 'whitelist',
        allowedGroups: Array.isArray(prevAc.allowedGroups) ? prevAc.allowedGroups : [],
        groupMetaCache: prevAc.groupMetaCache || {}
      };
      if (selectedScope === 'groups_only') {
        accessControl.allowPrivateChats = false;
        accessControl.groupMode = 'whitelist';
      } else if (selectedScope === 'private_only') {
        accessControl.allowPrivateChats = true;
        accessControl.groupMode = 'none';
      } else {
        accessControl.allowPrivateChats = true;
        accessControl.groupMode = 'whitelist';
      }

      const settings = {
        ...(prevBot?.settings || {}),
        industry: document.getElementById('botIndustrySelect')?.value || 'ecommerce',
        tone: state.selectedTone || 'friendly',
        welcomeMessage: document.getElementById('botWelcomeMsgInput')?.value.trim() || '',
        faqQuick: document.getElementById('botFaqQuickInput')?.value.trim() || '',
        pairingMode: document.querySelector('input[name="pairingMode"]:checked')?.value || 'qr',
        accessControl,
        modules: {
          ai: document.getElementById('botAiAutoReplyInput')?.checked ?? true,
          audio: document.getElementById('modAudioToggle')?.checked ?? true,
          catalog: document.getElementById('modCatalogToggle')?.checked ?? true,
          crm: document.getElementById('modCrmToggle')?.checked ?? true,
          hours: document.getElementById('modHoursToggle')?.checked ?? false,
          handoff: document.getElementById('modHandoffToggle')?.checked ?? true,
          antispam: document.getElementById('modAntispamToggle')?.checked ?? false
        }
      };

      const payload = { name, phone, prefix, personality, system_prompt, ai_auto_reply, purpose, settings };
      const url = editId ? `/api/bots/${editId}` : '/api/bots';
      const method = editId ? 'PUT' : 'POST';

      let wasOnlineAndChanged = false;
      if (editId) {
        const existingBot = state.bots.find(b => b.id === editId);
        const isOnline = existingBot && (existingBot.status === 'online' || existingBot.status === 'connecting' || existingBot.status === 'qr_ready');
        const personalityChanged = existingBot && (existingBot.personality !== personality || existingBot.system_prompt !== system_prompt);

        if (isOnline && personalityChanged) {
          const confirmStop = confirm(
            "Para cambiar la personalidad o faceta del bot es necesario apagarlo temporalmente.\n\n" +
            "Tranquilo: El bot NO será borrado y conservará todos sus chats, configuración y vinculación.\n\n" +
            "¿Deseas apagar el bot y aplicar la nueva personalidad ahora?"
          );
          if (!confirmStop) return;

          wasOnlineAndChanged = true;
          await authFetch(`/api/bots/${editId}/stop`, { method: 'POST' });
        }
      }

      try {
        const res = await authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.status === 402) {
          closeModal('addBotModal');
          (window.promptUpgrade ? window.promptUpgrade : (m) => showToast(m, 'warning'))(data.error);
          return;
        }
        if (data.ok) {
          if (wasOnlineAndChanged) {
            showToast(`El bot "${name}" fue apagado de forma segura y su personalidad actualizada (no fue borrado).`, 'success');
          } else {
            showToast(editId ? `Bot "${name}" actualizado correctamente.` : `Bot "${name}" creado. Vincula tu WhatsApp para dejarlo activo en el panel.`, 'success');
          }
          closeModal('addBotModal');
          resetFacetFilterToAll();
          if (data.bot) upsertBotInState(data.bot);
          showDashboard();
          switchTab('bots');
          renderBots();
          updateStats();
          updateFacetCounters();
          await fetchBots();
          if (!editId && data.bot) {
            setTimeout(() => openQrModalForBot(data.bot.id, data.bot.name, settings.pairingMode), 250);
          }
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Guardar Suscripción de Bot (Admin)
  const subForm = document.getElementById('subForm');
  if (subForm) {
    subForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const botId = document.getElementById('subBotId').value;
      const daysToAdd = parseInt(document.getElementById('subDaysInput').value, 10);
      const payment_status = document.getElementById('subStatusSelect').value;
      const purpose = document.getElementById('subPurposeInput').value.trim();

      const payload = { payment_status, purpose };
      if (!isNaN(daysToAdd)) payload.daysToAdd = daysToAdd;

      try {
        const res = await authFetch(`/api/admin/bots/${botId}/subscription`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Suscripción y tiempo de servicio actualizados con éxito', 'success');
          closeModal('subModal');
          fetchAdminData();
          fetchBots();
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Guardar Ajustes Avanzados del Bot (#11 Horarios, #20 Humano, #42 Webhook)
  const botSettingsForm = document.getElementById('botSettingsForm');
  if (botSettingsForm) {
    botSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const botId = document.getElementById('advancedBotIdInput').value;

      const daysSelected = Array.from(document.querySelectorAll('.day-opt:checked')).map(c => parseInt(c.value, 10));
      const payload = {
        businessHours: {
          enabled: document.getElementById('setBhEnabled').checked,
          startTime: document.getElementById('setBhStart').value,
          endTime: document.getElementById('setBhEnd').value,
          days: daysSelected,
          offHoursMsg: document.getElementById('setBhOffMsg').value
        },
        humanHandoffMinutes: parseInt(document.getElementById('setHandoffMinutes').value, 10) || 60,
        humanHandoffMsg: document.getElementById('setHandoffMsg').value,
        aiTemperature: parseFloat(document.getElementById('setAiTemp').value) || 0.7,
        aiTone: document.getElementById('setAiTone').value,
        webhookUrl: document.getElementById('setWebhookUrl').value.trim()
      };

      try {
        const res = await fetch(`/api/bots/${botId}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Ajustes avanzados guardados con éxito', 'success');
          closeModal('botSettingsModal');
          fetchBots();
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Guardar Producto (#9)
  const prodForm = document.getElementById('productForm');
  if (prodForm) {
    prodForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('productIdInput').value;
      const name = document.getElementById('prodNameInput').value;
      const price = parseFloat(document.getElementById('prodPriceInput').value) || 0;
      const currency = document.getElementById('prodCurrencyInput').value;
      const category = document.getElementById('prodCategoryInput').value;
      const bot_id = document.getElementById('prodBotSelect').value;
      const description = document.getElementById('prodDescInput').value;
      const is_active = document.getElementById('prodActiveInput').checked;

      const payload = { name, price, currency, category, bot_id, description, is_active };
      const url = id ? `/api/products/${id}` : '/api/products';
      const method = id ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast(id ? 'Producto actualizado' : 'Producto añadido al catálogo', 'success');
          closeModal('productModal');
          fetchProducts();
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Guardar Lead Manual (#10)
  const leadForm = document.getElementById('addLeadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('leadNameInput').value;
      const phone = document.getElementById('leadPhoneInput').value;
      const email = document.getElementById('leadEmailInput').value;
      const interest = document.getElementById('leadInterestInput').value;
      const status = document.getElementById('leadStatusInput').value;

      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, email, interest, status })
        });
        const data = await res.json();
        if (data.ok) {
          showToast('Prospecto guardado exitosamente', 'success');
          closeModal('addLeadModal');
          fetchLeads();
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Guardar Función Dinámica
  const fnForm = document.getElementById('functionForm');
  if (fnForm) {
    fnForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('functionIdInput').value;
      const name = document.getElementById('fnNameInput').value;
      const trigger_type = document.getElementById('fnTriggerTypeInput').value;
      const trigger_value = document.getElementById('fnTriggerValueInput').value;
      const bot_id = document.getElementById('fnBotSelect').value;
      const response_text = document.getElementById('fnResponseTextInput').value;
      const is_enabled = document.getElementById('fnEnabledInput').checked;

      const payload = { name, trigger_type, trigger_value, bot_id, response_text, is_enabled };
      const url = id ? `/api/functions/${id}` : '/api/functions';
      const method = id ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
          showToast(id ? 'Función actualizada' : '¡Función creada con éxito!', 'success');
          closeModal('functionModal');
          fetchFunctions();
        } else showToast(`Error: ${data.error}`, 'error');
      } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
    });
  }

  // Formulario Simulador de Chat (#8)
  const simForm = document.getElementById('simChatForm');
  if (simForm) {
    simForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('simChatInput');
      const text = input.value.trim();
      if (!text || !state.activeSimBotId) return;

      const container = document.getElementById('simMessagesContainer');
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble user';
      userBubble.innerHTML = `<span>${waFormat(text)}</span>`;
      container.appendChild(userBubble);
      input.value = '';
      container.scrollTop = container.scrollHeight;

      const typingBubble = document.createElement('div');
      typingBubble.className = 'chat-bubble bot';
      typingBubble.innerHTML = `<span><i class="fa-solid fa-spinner fa-spin"></i> Escribiendo...</span>`;
      container.appendChild(typingBubble);
      container.scrollTop = container.scrollHeight;

      try {
        const res = await fetch(`/api/bots/${state.activeSimBotId}/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        typingBubble.remove();

        const botBubble = document.createElement('div');
        botBubble.className = 'chat-bubble bot';
        botBubble.innerHTML = `<span>${waFormat(data.reply || 'Sin respuesta')}</span>`;
        container.appendChild(botBubble);
        container.scrollTop = container.scrollHeight;
      } catch (err) {
        typingBubble.innerHTML = `<span style="color: var(--red);">Error en la simulación</span>`;
      }
    });
  }
}

// ==========================================
// TOAST NOTIFICACIONES
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-xmark';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Formato nativo de WhatsApp para el simulador: *negrita*, _cursiva_, ~tachado~, ```código``` y enlaces.
// El texto se escapa primero, así que nunca se inserta HTML del usuario o de la IA.
function waFormat(str) {
  let h = escapeHtml(str);
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => `<code class="wa-code">${c.trim()}</code>`);
  const wrap = (tag, ch) => {
    const e = ch.replace(/[*_~]/g, '\\$&');
    h = h.replace(new RegExp(`(^|[\\s(])${e}(?=\\S)([^${e}\\n]*?\\S)${e}(?=$|[\\s.,;:!?)])`, 'g'), `$1<${tag}>$2</${tag}>`);
  };
  wrap('strong', '*'); wrap('em', '_'); wrap('s', '~');
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return h;
}
window.waFormat = waFormat;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// AUTENTICACIÓN, SESIONES & ROLES
// ==========================================
// CONTROL DE VISIBILIDAD: LANDING HERO vs DASHBOARD PRIVADO
// ==========================================

function showHeroLandingPage() {
  const hero = document.getElementById('heroLandingPage');
  const app = document.getElementById('appLayout');
  if (hero) hero.style.display = 'flex';
  if (app) app.style.display = 'none';
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDashboard() {
  const hero = document.getElementById('heroLandingPage');
  const app = document.getElementById('appLayout');
  if (hero) hero.style.display = 'none';
  if (app) app.style.display = 'grid';
}

function openAuthModal(tab = 'login') {
  openModal('authModal');
  const tabLogin = document.getElementById('authTabLogin');
  const tabReg = document.getElementById('authTabRegister');
  if (tab === 'register' && tabReg) {
    tabReg.click();
  } else if (tabLogin) {
    tabLogin.click();
  }
}

async function handleHeroRegister(e) {
  e.preventDefault();
  const name = document.getElementById('heroName')?.value.trim();
  const username = document.getElementById('heroUsername')?.value.trim();
  const whatsapp = document.getElementById('heroWhatsapp')?.value.trim();
  const password = document.getElementById('heroPassword')?.value;
  const botPurpose = document.getElementById('heroPurpose')?.value.trim();
  const botPersonality = document.querySelector('input[name="heroFacet"]:checked')?.value || 'advisor';
  const submitBtn = document.getElementById('heroSubmitBtn');

  if (!name || !username || !password || !botPurpose) {
    showToast('Por favor completa todos los campos obligatorios (*)', 'warning');
    return;
  }

  const cleanPhone = (whatsapp || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) {
    showToast('El WhatsApp de contacto es obligatorio para vincular tu bot (mínimo 8 dígitos con código país)', 'warning');
    document.getElementById('heroWhatsapp')?.focus();
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando tu cuenta y tu bot...';
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        username,
        whatsapp,
        password,
        botPurpose,
        botPersonality,
        botName: `Bot de ${name.split(' ')[0]}`
      })
    });
    const data = await res.json();
    if (data.ok && data.token) {
      localStorage.setItem('etho_auth_token', data.token);
      state.token = data.token;
      state.currentUser = data.user;
      connectSSE();
      renderUserUI(data.user);
      resetFacetFilterToAll();
      if (data.bot) upsertBotInState(data.bot);
      showDashboard();
      switchTab('bots');
      showToast('Cuenta creada. Tu bot tiene 7 días de prueba gratis; escanea el QR para conectarlo al panel.', 'success');
      await fetchBots();
      if (data.bot) {
        setTimeout(() => openQrModalForBot(data.bot.id, data.bot.name), 350);
      }
    } else {
      showToast(data.error || 'Error al crear tu cuenta', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Crear Mi Cuenta y Obtener Bot Gratis';
    }
  }
}

async function checkAuth() {
  if (!state.token) {
    showHeroLandingPage();
    renderUserUI(null);
    return;
  }
  try {
    const res = await authFetch('/api/auth/me');
    const data = await res.json();
    if (data.ok && data.user) {
      state.currentUser = data.user;
      renderUserUI(data.user);
      showDashboard();
      await fetchBots();
    } else {
      localStorage.removeItem('etho_auth_token');
      state.token = '';
      state.currentUser = null;
      renderUserUI(null);
      showHeroLandingPage();
    }
  } catch {
    renderUserUI(null);
    showHeroLandingPage();
  }
}

function logout() {
  if (state.currentUser && !confirm(`¿Deseas cerrar la sesión de ${state.currentUser.name}?`)) {
    return;
  }
  localStorage.removeItem('etho_auth_token');
  state.token = '';
  state.currentUser = null;
  state.bots = [];
  connectSSE();
  renderUserUI(null);
  renderBots();
  updateStats();
  updateFacetCounters();
  showHeroLandingPage();
  showToast('Sesión cerrada correctamente', 'info');
}
window.logout = logout;

function renderUserUI(user) {
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarUserAvatar');
  const authBtn = document.getElementById('authBtn');
  const adminSection = document.getElementById('adminNavSection');

  const heroNav = document.getElementById('heroNavActions');

  if (user) {
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) {
      roleEl.textContent = user.role === 'admin' ? 'Admin Master' : 'Cliente';
      roleEl.style.color = user.role === 'admin' ? '#fbbf24' : '#60a5fa';
    }
    if (avatarEl) {
      avatarEl.innerHTML = user.role === 'admin' ? '<i class="fa-solid fa-crown" style="color: #fbbf24;"></i>' : '<i class="fa-solid fa-user"></i>';
    }
    if (authBtn) {
      authBtn.title = 'Cerrar Sesión';
      authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
    }
    if (adminSection) {
      adminSection.style.display = user.role === 'admin' ? 'block' : 'none';
    }
    document.querySelectorAll('.admin-only-btn').forEach(btn => {
      btn.style.display = user.role === 'admin' ? 'inline-flex' : 'none';
    });
    if (heroNav) {
      heroNav.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm nav-btn-install install-app-trigger" onclick="triggerInstallApp()" title="Instalar aplicación en Escritorio o Celular">
          <i class="fa-solid fa-desktop"></i> <span class="nav-text-full">Instalar en Escritorio</span><span class="nav-text-short">App</span>
        </button>
        <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="Cambiar entre tema claro y oscuro" title="Cambiar tema"><i data-theme-icon class="fa-solid fa-sun"></i></button>
        <button type="button" class="btn btn-secondary btn-sm nav-btn-report" onclick="openTicketModal()" title="Reportar un error o pedir ayuda">
          <i class="fa-solid fa-bug"></i> <span class="nav-text-full">Reportar error</span><span class="nav-text-short">Error</span>
        </button>
        <button type="button" class="btn btn-primary btn-sm nav-btn-login" onclick="showDashboard()">
          <i class="fa-solid fa-gauge-high"></i> <span class="nav-text-full">Ir a Mi Panel</span><span class="nav-text-short">Panel</span>
        </button>
        <button type="button" class="btn btn-secondary btn-sm nav-btn-cta" onclick="logout()">
          <i class="fa-solid fa-right-from-bracket"></i> <span class="nav-text-full">Salir (${escapeHtml(user.username)})</span><span class="nav-text-short">Salir</span>
        </button>
        <button type="button" class="hero-mobile-toggle" id="heroMobileToggle" onclick="toggleHeroMobileMenu()" aria-label="Abrir Menú">
          <i class="fa-solid fa-bars"></i>
        </button>
      `;
      if (window.syncThemeIcons) window.syncThemeIcons();
    }
  } else {
    if (nameEl) nameEl.textContent = 'Invitado / Login';
    if (roleEl) {
      roleEl.textContent = 'Acceso & Registro';
      roleEl.style.color = 'var(--text-dim)';
    }
    if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
    if (authBtn) {
      authBtn.title = 'Iniciar Sesión / Registrarse';
      authBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i>';
    }
    if (adminSection) adminSection.style.display = 'none';
    document.querySelectorAll('.admin-only-btn').forEach(btn => {
      btn.style.display = 'none';
    });
    if (heroNav) {
      heroNav.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm nav-btn-install install-app-trigger" onclick="triggerInstallApp()" title="Instalar aplicación en Escritorio o Celular">
          <i class="fa-solid fa-desktop"></i> <span class="nav-text-full">Instalar en Escritorio</span><span class="nav-text-short">App</span>
        </button>
        <button type="button" class="theme-toggle" onclick="toggleTheme()" aria-label="Cambiar entre tema claro y oscuro" title="Cambiar tema"><i data-theme-icon class="fa-solid fa-sun"></i></button>
        <button type="button" class="btn btn-secondary btn-sm nav-btn-login" onclick="openAuthModal('login')">
          <i class="fa-solid fa-right-to-bracket"></i> <span class="nav-text-full">Iniciar Sesión</span><span class="nav-text-short">Entrar</span>
        </button>
        <a href="#heroRegisterCard" class="btn btn-primary btn-sm nav-btn-cta">
          <i class="fa-solid fa-bolt"></i> <span class="nav-text-full">Crear Mi Bot Gratis</span><span class="nav-text-short">Crear</span>
        </a>
        <button type="button" class="hero-mobile-toggle" id="heroMobileToggle" onclick="toggleHeroMobileMenu()" aria-label="Abrir Menú">
          <i class="fa-solid fa-bars"></i>
        </button>
      `;
      if (window.syncThemeIcons) window.syncThemeIcons();
    }
  }
  syncInstallButtonsUI();
}

function toggleHeroMobileMenu(force) {
  const menu = document.getElementById('heroMobileMenu');
  const backdrop = document.getElementById('heroMobileBackdrop');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  const shouldOpen = typeof force === 'boolean' ? force : !isOpen;
  if (shouldOpen) {
    menu.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
  } else {
    menu.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }
}
window.toggleHeroMobileMenu = toggleHeroMobileMenu;

function initAuthModal() {
  const authBtn = document.getElementById('authBtn');
  const sidebarUserCard = document.getElementById('sidebarUserCard');
  if (authBtn) {
    authBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.currentUser) {
        logout();
      } else {
        openModal('authModal');
      }
    });
  }

  if (sidebarUserCard) {
    sidebarUserCard.addEventListener('click', () => {
      if (!state.currentUser) openModal('authModal');
    });
  }

  // Alternar pestañas del modal (Login / Registro)
  const tabLogin = document.getElementById('authTabLogin');
  const tabReg = document.getElementById('authTabRegister');
  const formLogin = document.getElementById('loginForm');
  const formReg = document.getElementById('registerForm');
  const switchToReg = document.getElementById('switchToRegisterLink');
  const switchToLog = document.getElementById('switchToLoginLink');

  function setAuthTab(mode) {
    if (mode === 'register') {
      if (tabReg) tabReg.classList.add('active');
      if (tabLogin) tabLogin.classList.remove('active');
      if (formReg) formReg.style.display = 'block';
      if (formLogin) formLogin.style.display = 'none';
    } else {
      if (tabLogin) tabLogin.classList.add('active');
      if (tabReg) tabReg.classList.remove('active');
      if (formLogin) formLogin.style.display = 'block';
      if (formReg) formReg.style.display = 'none';
    }
  }

  if (tabLogin) tabLogin.addEventListener('click', () => setAuthTab('login'));
  if (tabReg) tabReg.addEventListener('click', () => setAuthTab('register'));
  if (switchToReg) switchToReg.addEventListener('click', () => setAuthTab('register'));
  if (switchToLog) switchToLog.addEventListener('click', () => setAuthTab('login'));

  // Visibilidad de contraseñas (Toggle Ojo)
  function setupPassToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      }
    });
  }

  setupPassToggle('toggleLoginPassBtn', 'loginPassword');
  setupPassToggle('toggleRegPassBtn', 'regPassword');
  setupPassToggle('toggleRegConfirmPassBtn', 'regConfirmPassword');

  // Enlace "¿Olvidaste tu contraseña?"
  const forgotPassLink = document.getElementById('authForgotPassLink');
  if (forgotPassLink) {
    forgotPassLink.addEventListener('click', (e) => {
      e.preventDefault();
      alert('Para restablecer tus credenciales de acceso o recuperar tu cuenta administrativa, contacta a Soporte Técnico por WhatsApp o comunícate con el Administrador del servidor.');
    });
  }

  // Recordar usuario en este navegador
  const savedUser = localStorage.getItem('etho_remember_username');
  const loginUserField = document.getElementById('loginUsername');
  const loginRemField = document.getElementById('loginRemember');
  if (savedUser && loginUserField) {
    loginUserField.value = savedUser;
    if (loginRemField) loginRemField.checked = true;
  }

  // Medidor en tiempo real de seguridad de contraseña
  const regPassInput = document.getElementById('regPassword');
  const regConfirmInput = document.getElementById('regConfirmPassword');
  const regMeterFill = document.getElementById('regPassMeterFill');
  const regMeterLabel = document.getElementById('regPassMeterLabel');
  const regMatchLabel = document.getElementById('regPassMatchLabel');

  if (regPassInput && regMeterFill && regMeterLabel) {
    regPassInput.addEventListener('input', () => {
      const val = regPassInput.value;
      if (!val) {
        regMeterFill.style.width = '0%';
        regMeterFill.style.backgroundColor = 'var(--red)';
        regMeterLabel.textContent = 'Mínimo 8 caracteres';
        regMeterLabel.style.color = 'var(--text-muted)';
      } else if (val.length < 8) {
        regMeterFill.style.width = '25%';
        regMeterFill.style.backgroundColor = '#ef4444';
        regMeterLabel.textContent = 'Muy corta (mínimo 8 caracteres)';
        regMeterLabel.style.color = '#f87171';
      } else if (val.length < 10) {
        regMeterFill.style.width = '60%';
        regMeterFill.style.backgroundColor = '#f59e0b';
        regMeterLabel.textContent = 'Nivel medio de seguridad';
        regMeterLabel.style.color = '#fbbf24';
      } else {
        regMeterFill.style.width = '100%';
        regMeterFill.style.backgroundColor = '#10b981';
        regMeterLabel.textContent = 'Contraseña robusta y segura';
        regMeterLabel.style.color = '#34d399';
      }
      checkPassMatch();
    });
  }

  function checkPassMatch() {
    if (!regConfirmInput || !regMatchLabel) return;
    const p1 = regPassInput ? regPassInput.value : '';
    const p2 = regConfirmInput.value;
    if (!p2) {
      regMatchLabel.textContent = '';
      return;
    }
    if (p1 === p2) {
      regMatchLabel.textContent = 'Las contraseñas coinciden';
      regMatchLabel.style.color = 'var(--green)';
    } else {
      regMatchLabel.textContent = 'Las contraseñas no coinciden';
      regMatchLabel.style.color = 'var(--red)';
    }
  }

  if (regConfirmInput) {
    regConfirmInput.addEventListener('input', checkPassMatch);
  }

  // Envío Login
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      const remember = document.getElementById('loginRemember')?.checked;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.ok) {
          state.token = data.token;
          state.currentUser = data.user;
          localStorage.setItem('etho_auth_token', data.token);

          if (remember) {
            localStorage.setItem('etho_remember_username', username);
          } else {
            localStorage.removeItem('etho_remember_username');
          }

          renderUserUI(data.user);
          connectSSE();
          closeModal('authModal');
          resetFacetFilterToAll();
          showDashboard();
          switchTab('bots');
          showToast(`Bienvenido ${data.user.name}.`, 'success');
          formLogin.reset();
          await fetchBots();
        } else {
          showToast(`Error: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    });
  }

  // Envío Registro
  if (formReg) {
    formReg.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const username = document.getElementById('regUsername').value.trim();
      const whatsapp = document.getElementById('regWhatsapp').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const confirmPassword = document.getElementById('regConfirmPassword')?.value;
      const botPurpose = document.getElementById('regPurpose')?.value.trim();
      const termsAccepted = document.getElementById('regTerms')?.checked;

      if (password !== confirmPassword) {
        showToast('Las contraseñas no coinciden. Por favor verifícalas.', 'warning');
        return;
      }

      if (!termsAccepted) {
        showToast('Debes aceptar las Reglas de Uso y Política Anti-Abuso.', 'warning');
        return;
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, username, whatsapp, email, password, botPurpose })
        });
        const data = await res.json();
        if (data.ok) {
          state.token = data.token;
          state.currentUser = data.user;
          localStorage.setItem('etho_auth_token', data.token);
          localStorage.setItem('etho_remember_username', username);
          renderUserUI(data.user);
          connectSSE();
          closeModal('authModal');
          resetFacetFilterToAll();
          if (data.bot) upsertBotInState(data.bot);
          showDashboard();
          switchTab('bots');
          showToast(`Cuenta creada con éxito. Bienvenido ${data.user.name}. Tu prueba de 7 días está activa.`, 'success');
          formReg.reset();
          if (regMatchLabel) regMatchLabel.textContent = '';
          if (regMeterFill) regMeterFill.style.width = '0%';
          await fetchBots();
          if (data.bot) {
            setTimeout(() => openQrModalForBot(data.bot.id, data.bot.name), 350);
          }
        } else {
          showToast(`Error: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    });
  }

  // Buscar en la tabla de bots del admin
  const searchInput = document.getElementById('adminBotsSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => renderAdminBotsTable());
  }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN MASTER (TÚ COMO ADMIN)
// ==========================================

async function fetchAdminData() {
  if (!state.currentUser || state.currentUser.role !== 'admin') return;

  try {
    const [statsRes, botsRes, usersRes] = await Promise.all([
      authFetch('/api/admin/stats').then(r => r.json()),
      authFetch('/api/admin/bots').then(r => r.json()),
      authFetch('/api/admin/users').then(r => r.json())
    ]);

    if (statsRes.ok && statsRes.stats) {
      state.adminStats = statsRes.stats;
      const s = statsRes.stats;
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('adminStatUsers', s.totalUsers);
      setEl('adminStatTrial', s.trialBots);
      setEl('adminStatPaid', s.paidBots);
      setEl('adminStatExpired', s.expiredBots);
    }

    if (botsRes.ok) {
      state.adminBots = botsRes.bots;
      renderAdminBotsTable();
    }

    if (usersRes.ok) {
      state.adminUsers = usersRes.users;
      renderAdminUsersTable();
    }
  } catch (err) {
    console.error('Error fetching admin data:', err);
  }
}

function renderAdminBotsTable() {
  const tbody = document.getElementById('adminBotsTableBody');
  if (!tbody) return;

  const search = (document.getElementById('adminBotsSearch')?.value || '').toLowerCase().trim();
  const list = (state.adminBots || []).filter(b => {
    if (!search) return true;
    return (b.name || '').toLowerCase().includes(search) ||
           (b.owner_name || '').toLowerCase().includes(search) ||
           (b.purpose || '').toLowerCase().includes(search);
  });

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 36px 20px;">
      <i class="fa-solid fa-robot" style="font-size: 28px; opacity: 0.35; margin-bottom: 8px; display: block;"></i>
      <strong style="color: var(--text-secondary); font-size: 14px; display: block;">No hay bots de clientes creados aún</strong>
      <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 4px;">
        Cuando los usuarios se registren y creen sus bots para sus negocios, aparecerán aquí con su propósito, tiempo y cobro.
      </span>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(bot => {
    const isExpired = bot.payment_status === 'suspended' || bot.payment_status === 'expired' || (bot.expires_at > 0 && Date.now() > bot.expires_at && bot.payment_status !== 'paid');
    
    let statusBadge = '<span class="badge-sub trial">Prueba</span>';
    if (bot.payment_status === 'suspended') statusBadge = '<span class="badge-sub suspended">Suspendido</span>';
    else if (isExpired) statusBadge = '<span class="badge-sub expired">Vencido / Cobrar</span>';
    else if (bot.payment_status === 'paid' && bot.expires_at === 0) statusBadge = '<span class="badge-sub paid"><i class="fa-solid fa-crown text-yellow"></i> Ilimitado VIP</span>';
    else if (bot.payment_status === 'paid') statusBadge = '<span class="badge-sub paid">Pagado</span>';

    // Cuenta regresiva
    let timeStr = 'Ilimitado';
    if (bot.expires_at > 0) {
      const msLeft = bot.expires_at - Date.now();
      if (msLeft <= 0) {
        const msAgo = Math.abs(msLeft);
        const daysAgo = Math.floor(msAgo / (24 * 60 * 60 * 1000));
        timeStr = `<span style="color: #f87171; font-weight: 700;">Vencido hace ${daysAgo}d</span>`;
      } else {
        const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
        const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (3600 * 1000));
        timeStr = `<strong>${days} días</strong> ${hours}h`;
      }
    }

    const waLink = bot.owner_whatsapp ? 
      `<a href="https://wa.me/${bot.owner_whatsapp.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(bot.owner_name)},%20te%20contacto%20sobre%20tu%20bot%20${encodeURIComponent(bot.name)}" target="_blank" class="text-green" style="font-size: 11px; text-decoration: underline;"><i class="fa-brands fa-whatsapp"></i> +${escapeHtml(bot.owner_whatsapp)}</a>` : 
      '<span class="text-dim" style="font-size: 11px;">Sin WhatsApp</span>';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(bot.owner_name || 'Sin nombre')}</strong><br>
          <small class="text-muted">@${escapeHtml(bot.owner_username || 'user')}</small><br>
          ${waLink}
        </td>
        <td>
          <strong>${escapeHtml(bot.name)}</strong><br>
          <small class="text-muted"><code>${escapeHtml(bot.id)}</code></small>
        </td>
        <td>
          <div style="max-width: 260px; font-size: 12px; line-height: 1.4;">
            ${bot.purpose ? `<strong style="color: #c4b5fd;">${escapeHtml(bot.purpose)}</strong>` : '<em class="text-muted">Sin especificar</em>'}
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${timeStr}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" onclick="quickExtendBot('${bot.id}', 30, 'paid')" title="Marcar Pagado y otorgar 30 días">
              <i class="fa-solid fa-plus text-green"></i> +30d (Mes)
            </button>
            <button class="btn btn-secondary btn-sm" onclick="quickExtendBot('${bot.id}', 7, 'trial')" title="Extender prueba gratuita por 7 días">
              +7d Prueba
            </button>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openSubscriptionModal('${bot.id}')" title="Ajuste manual de tiempo y estado">
              <i class="fa-solid fa-clock text-orange"></i>
            </button>
            <button class="btn btn-secondary btn-sm btn-icon text-red" onclick="quickSuspendBot('${bot.id}')" title="Suspender / Cortar por falta de pago">
              <i class="fa-solid fa-ban"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('adminUsersTableBody');
  const countLbl = document.getElementById('adminUsersCountLabel');
  if (!tbody) return;

  if (countLbl) countLbl.textContent = `${(state.adminUsers || []).length} usuarios`;

  if (!state.adminUsers || !state.adminUsers.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No hay usuarios registrados.</td></tr>`;
    return;
  }

  tbody.innerHTML = (state.adminUsers || []).map(user => {
    const isMaster = user.role === 'admin';
    const date = new Date(user.created_at).toLocaleDateString('es-ES');
    return `
      <tr>
        <td><strong>@${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.name)}</td>
        <td>${user.whatsapp ? `+${escapeHtml(user.whatsapp)}` : '<span class="text-dim">-</span>'}</td>
        <td>${escapeHtml(user.email || '-')}</td>
        <td><span class="badge" style="background: rgba(139,92,246,0.15); color: #c4b5fd; padding: 2px 8px; border-radius: 0px;">${user.totalBots || 0} bots</span></td>
        <td>${isMaster ? '<strong style="color: #fbbf24;"><i class="fa-solid fa-crown"></i> Admin</strong>' : '<span class="text-muted">Cliente</span>'}</td>
        <td>
          <span class="badge" style="background: ${user.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${user.status === 'active' ? '#34d399' : '#f87171'}; padding: 2px 8px; border-radius: 0px;">
            ${user.status === 'active' ? 'Activo' : 'Suspendido'}
          </span>
        </td>
        <td>
          ${!isMaster ? `
            <button class="btn btn-secondary btn-sm btn-icon" onclick="toggleUserStatus('${user.id}', '${user.status === 'active' ? 'suspended' : 'active'}')" title="${user.status === 'active' ? 'Suspender cuenta' : 'Reactivar cuenta'}">
              <i class="fa-solid ${user.status === 'active' ? 'fa-ban text-red' : 'fa-check text-green'}"></i>
            </button>
            <button class="btn btn-secondary btn-sm btn-icon text-red" onclick="deleteUser('${user.id}', '${escapeHtml(user.name)}')" title="Eliminar cuenta y todos sus bots">
              <i class="fa-solid fa-trash"></i>
            </button>
          ` : '<small class="text-dim">Dueño Master</small>'}
        </td>
      </tr>
    `;
  }).join('');
}

async function quickExtendBot(botId, days, status) {
  try {
    const res = await authFetch(`/api/admin/bots/${botId}/subscription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daysToAdd: days, payment_status: status })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`¡Bot actualizado! Se añadieron ${days} días (${status})`, 'success');
      fetchAdminData();
      fetchBots();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function quickSuspendBot(botId) {
  if (!confirm('¿Deseas suspender este bot por falta de pago? Se apagará de inmediato.')) return;
  try {
    const res = await authFetch(`/api/admin/bots/${botId}/subscription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_status: 'suspended' })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Bot suspendido por falta de pago', 'info');
      fetchAdminData();
      fetchBots();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

function openSubscriptionModal(botId) {
  const bot = (state.adminBots || state.bots).find(b => b.id === botId);
  if (!bot) return;

  document.getElementById('subBotId').value = bot.id;
  document.getElementById('subModalBotTitle').textContent = `${bot.name} (${bot.owner_name || bot.owner_id})`;
  document.getElementById('subDaysInput').value = '';
  document.getElementById('subStatusSelect').value = bot.payment_status || 'trial';
  document.getElementById('subPurposeInput').value = bot.purpose || '';

  openModal('subModal');
}

function setSubDays(days) {
  const input = document.getElementById('subDaysInput');
  if (input) input.value = days;
}

async function toggleUserStatus(userId, newStatus) {
  try {
    const res = await authFetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Usuario ${newStatus === 'active' ? 'reactivado' : 'suspendido'}`, 'success');
      fetchAdminData();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function deleteUser(userId, userName) {
  if (!confirm(`¿Estás seguro de eliminar al usuario "${userName}"? Todos sus bots y datos serán eliminados permanentemente.`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      showToast(`Usuario "${userName}" eliminado`, 'success');
      fetchAdminData();
      fetchBots();
    } else showToast(`Error: ${data.error}`, 'error');
  } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

// ==========================================
// SISTEMA DE REGLAS Y MODERACIÓN (FRONTEND)
// ==========================================

async function fetchModerationData() {
  try {
    const [resRules, resLogs] = await Promise.all([
      fetch('/api/moderation/rules'),
      fetch('/api/moderation/logs')
    ]);
    const dataRules = await resRules.json();
    const dataLogs = await resLogs.json();

    if (dataRules.ok) renderModerationRules(dataRules.rules);
    if (dataLogs.ok) renderModerationLogs(dataLogs.logs);
  } catch (err) {
    console.error('Error cargando moderación:', err);
  }
}

function renderModerationRules(rules) {
  const container = document.getElementById('moderationRulesGrid');
  if (!container) return;

  if (!rules || !rules.length) {
    container.innerHTML = `<div class="text-muted text-center" style="grid-column: 1/-1; padding: 20px;">No hay reglas configuradas.</div>`;
    return;
  }

  container.innerHTML = rules.map(r => `
    <div class="moderation-rule-card">
      <div>
        <div class="moderation-rule-header">
          <span class="rule-code">${escapeHtml(r.id)}</span>
          <span class="rule-severity-badge ${escapeHtml(r.severity || 'media')}">${escapeHtml(r.severity || 'media')}</span>
        </div>
        <h4>${escapeHtml(r.title)}</h4>
        <p>${escapeHtml(r.description)}</p>
      </div>
      <div class="rule-penalty-footer">
        <span>Sanción por infracción:</span>
        <span class="rule-penalty-badge"><i class="fa-solid fa-gavel"></i> ${r.penalty_days} días de suspensión</span>
      </div>
    </div>
  `).join('');
}

function renderModerationLogs(logs) {
  const tbody = document.getElementById('moderationLogsTableBody');
  const countLbl = document.getElementById('moderationLogsCountLabel');
  if (!tbody) return;

  if (countLbl) countLbl.textContent = `${(logs || []).length} incidentes`;

  if (!logs || !logs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No se registran incidentes. Todos los bots operan conforme a las reglas.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const date = new Date(l.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const isPen = l.severity === 'penalty';
    const isPar = l.severity === 'pardon';
    const color = isPen ? '#ef4444' : isPar ? '#10b981' : '#f59e0b';
    const icon = isPen ? 'fa-ban' : isPar ? 'fa-dove' : 'fa-triangle-exclamation';

    return `
      <tr>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${date}</td>
        <td><strong>${escapeHtml(l.bot_id)}</strong></td>
        <td>${escapeHtml(l.rule_broken)}</td>
        <td>
          <span class="badge" style="background: rgba(255,255,255,0.05); color: ${color}; border: 1px solid ${color};">
            <i class="fa-solid ${icon}"></i> ${escapeHtml(l.severity.toUpperCase())}
          </span>
        </td>
        <td>
          ${l.penalized_days ? `<span style="color: #ef4444; font-weight: 700;">-${l.penalized_days} días</span>` : '<span class="text-dim">-</span>'}
        </td>
        <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(l.details || '')}</td>
      </tr>
    `;
  }).join('');
}

function openPenalizeModal(preselectBotId = null) {
  const sel = document.getElementById('penalizeBotSelect');
  if (sel) {
    sel.innerHTML = '<option value="">Selecciona un bot...</option>' + state.bots.map(b => `
      <option value="${b.id}" ${b.id === preselectBotId ? 'selected' : ''}>${escapeHtml(b.name)} (${b.id})</option>
    `).join('');
  }
  openModal('penalizeModal');
}

function quickPenalizeBot(botId, name) {
  openPenalizeModal(botId);
}

async function handleApplyPenalty(e) {
  e.preventDefault();
  const botId = document.getElementById('penalizeBotSelect')?.value;
  const days = document.getElementById('penalizeDaysSelect')?.value;
  const reason = document.getElementById('penalizeReasonInput')?.value.trim();
  const deductDays = document.getElementById('penalizeDeductCheck')?.checked;

  if (!botId) return showToast('Selecciona el bot a penalizar', 'error');

  try {
    const res = await authFetch('/api/moderation/penalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId, days, reason, deductDays })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message || 'Penalización aplicada correctamente', 'success');
      closeModal('penalizeModal');
      fetchBots();
      fetchModerationData();
      if (state.currentUser?.role === 'admin') fetchAdminData();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function openPardonModal(preselectBotId = null) {
  const sel = document.getElementById('pardonBotSelect');
  const penalizedBots = state.bots.filter(b => b.isPenalized || (b.penalty_until && b.penalty_until > Date.now()));

  if (sel) {
    if (!penalizedBots.length) {
      sel.innerHTML = '<option value="">No hay bots penalizados actualmente</option>';
    } else {
      sel.innerHTML = '<option value="">Selecciona un bot...</option>' + penalizedBots.map(b => `
        <option value="${b.id}" ${b.id === preselectBotId ? 'selected' : ''}>${escapeHtml(b.name)} (${b.id}) - ${b.penalty_reason}</option>
      `).join('');
    }
  }
  openModal('pardonModal');
}

async function quickPardonBot(botId, name) {
  if (!confirm(`¿Levantar la penalización para "${name}" y reactivar el bot?`)) return;
  try {
    const res = await authFetch('/api/moderation/pardon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message || 'Penalización levantada correctamente', 'success');
      fetchBots();
      fetchModerationData();
      if (state.currentUser?.role === 'admin') fetchAdminData();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function handleApplyPardon(e) {
  e.preventDefault();
  const botId = document.getElementById('pardonBotSelect')?.value;
  if (!botId) return showToast('Selecciona el bot a indultar', 'error');

  try {
    const res = await authFetch('/api/moderation/pardon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message || 'Penalización levantada correctamente', 'success');
      closeModal('pardonModal');
      fetchBots();
      fetchModerationData();
      if (state.currentUser?.role === 'admin') fetchAdminData();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ==========================================
// MODO "HABLAR POR MÍ" (PILOTO AUTOMÁTICO) & RECADOS
// ==========================================

let currentRecadosBotId = null;

async function quickTogglePilot(botId, newEnabled) {
  try {
    const res = await authFetch(`/api/bots/${botId}/pilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled })
    });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message, 'success');
      fetchBots();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

function openPilotSettingsModal(botId) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;

  document.getElementById('pilotBotId').value = bot.id;
  document.getElementById('pilotActiveCheck').checked = Boolean(bot.auto_pilot !== undefined ? bot.auto_pilot : true);
  document.getElementById('pilotPersonaSelect').value = bot.pilot_persona || 'as_me';
  document.getElementById('pilotOwnerNameInput').value = bot.owner_name || bot.name || (state.currentUser?.name || '');
  document.getElementById('pilotContextInput').value = bot.pilot_context || '';

  openModal('pilotModal');
}

async function handleSavePilotSettings(e) {
  e.preventDefault();
  const botId = document.getElementById('pilotBotId').value;
  const enabled = document.getElementById('pilotActiveCheck').checked;
  const persona = document.getElementById('pilotPersonaSelect').value;
  const ownerName = document.getElementById('pilotOwnerNameInput').value.trim();
  const context = document.getElementById('pilotContextInput').value.trim();

  try {
    const res = await authFetch(`/api/bots/${botId}/pilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, persona, ownerName, context })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Ajustes del modo Hablar por Mí guardados correctamente', 'success');
      closeModal('pilotModal');
      fetchBots();
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function openRecadosModal(botId, botName) {
  currentRecadosBotId = botId;
  const sub = document.getElementById('recadosModalSubtitle');
  if (sub) sub.textContent = `Mensajes y recados atendidos por la IA para "${botName}".`;

  const container = document.getElementById('recadosListContainer');
  if (container) container.innerHTML = `<div class="text-center p-4 text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Cargando recados...</div>`;

  openModal('recadosModal');

  try {
    const res = await authFetch(`/api/bots/${botId}/recados`);
    const data = await res.json();
    if (data.ok) {
      renderRecadosList(data.recados || []);
    } else {
      if (container) container.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
    }
  } catch (err) {
    if (container) container.innerHTML = `<div class="alert alert-danger">${err.message}</div>`;
  }
}

function renderRecadosList(recados) {
  const container = document.getElementById('recadosListContainer');
  if (!container) return;

  if (!recados.length) {
    container.innerHTML = `
      <div class="empty-state text-center" style="padding: 40px 20px;">
        <i class="fa-solid fa-inbox" style="font-size: 40px; color: var(--text-dim); margin-bottom: 12px;"></i>
        <h4>Bandeja de recados vacía</h4>
        <p class="text-muted" style="font-size: 13px;">No hay mensajes registrados. Cuando la IA responda por ti en WhatsApp, verás aquí el resumen de cada conversación.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${recados.map(r => {
        const time = new Date(r.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
        return `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); padding: 14px; position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <strong style="color: var(--text-main); font-size: 13.5px;"><i class="fa-solid fa-user text-purple"></i> ${escapeHtml(r.sender_name || 'Contacto')}</strong>
                ${r.sender_phone ? `<span style="font-size: 11px; color: var(--text-dim); margin-left: 6px;">(+${escapeHtml(r.sender_phone)})</span>` : ''}
              </div>
              <span style="font-size: 11px; color: var(--text-dim);">${time}</span>
            </div>
            <div style="font-size: 13px; color: #f1f5f9; background: rgba(0,0,0,0.25); padding: 10px 12px; margin-bottom: 8px; border-left: 2px solid var(--blue);">
              <strong>Mensaje recibido:</strong><br>
              ${escapeHtml(r.message)}
            </div>
            ${r.ai_reply ? `
              <div style="font-size: 12px; color: #cbd5e1; background: rgba(139, 92, 246, 0.05); padding: 8px 12px; border-left: 2px solid var(--primary);">
                <strong style="color: #c4b5fd;">Respuesta enviada por la IA:</strong><br>
                ${escapeHtml(r.ai_reply)}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function handleMarkRecadosRead() {
  if (!currentRecadosBotId) return;
  try {
    await authFetch(`/api/bots/${currentRecadosBotId}/recados/read`, { method: 'POST' });
    showToast('Recados marcados como leídos', 'info');
    closeModal('recadosModal');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}



// ==========================================
// GESTIÓN DE PERSONALIDAD Y PALABRAS DEL BOT
// ==========================================
window.openPersonalityModal = async function(botId) {
  try {
    const res = await authFetch(`/api/bots/${botId}/personality`);
    const data = await res.json();
    if (!data.ok || !data.personality) {
      showToast('Error cargando la personalidad del bot', 'error');
      return;
    }

    const p = data.personality;
    document.getElementById('persBotId').value = botId;
    document.getElementById('persTone').value = p.tone || 'profesional';
    document.getElementById('persFacet').value = p.personality || 'recreational';
    document.getElementById('persPrompt').value = p.system_prompt || '';
    document.getElementById('persForbidden').value = (p.forbidden_words || []).join(', ');
    document.getElementById('persPreferred').value = (p.preferred_words || []).join(', ');

    // Verificar si el bot está encendido
    const bot = state.bots.find(b => b.id === botId);
    const isOnline = bot && (bot.status === 'online' || bot.status === 'connecting' || bot.status === 'qr_ready');
    const warnBox = document.getElementById('persPowerWarning');
    const saveBtn = document.getElementById('btnSavePersonality');

    if (warnBox) warnBox.style.display = isOnline ? 'block' : 'none';
    if (saveBtn) {
      if (isOnline) {
        saveBtn.innerHTML = '<i class="fa-solid fa-power-off"></i> Apagar y Guardar Personalidad';
      } else {
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar Personalidad';
      }
    }

    openModal('personalityModal');
  } catch (err) {
    showToast('Error al consultar personalidad: ' + err.message, 'error');
  }
};

window.handleSavePersonality = async function(e) {
  e.preventDefault();
  const botId = document.getElementById('persBotId').value;
  if (!botId) return;

  const bot = state.bots.find(b => b.id === botId);
  const isOnline = bot && (bot.status === 'online' || bot.status === 'connecting' || bot.status === 'qr_ready');

  // Si el bot está encendido, pedir apagarlo sin borrarlo
  if (isOnline) {
    const confirmStop = confirm(
      "Para aplicar la nueva personalidad o faceta del bot es necesario apagarlo temporalmente.\n\n" +
      "Tranquilo: El bot NO será borrado y mantendrá intactos todos sus datos, chats y vinculación.\n\n" +
      "¿Deseas apagar el bot y guardar la nueva personalidad ahora?"
    );
    if (!confirmStop) return;
  }

  const btn = document.getElementById('btnSavePersonality');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

  const tone = document.getElementById('persTone').value;
  const personality = document.getElementById('persFacet').value;
  const system_prompt = document.getElementById('persPrompt').value.trim();
  const forbiddenRaw = document.getElementById('persForbidden').value;
  const preferredRaw = document.getElementById('persPreferred').value;

  const forbidden_words = forbiddenRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const preferred_words = preferredRaw.split(',').map(s => s.trim()).filter(Boolean);

  try {
    // 1. Si estaba encendido, apagarlo primero sin borrarlo
    if (isOnline) {
      btn.innerHTML = '<i class="fa-solid fa-power-off fa-spin"></i> Apagando bot de forma segura...';
      await authFetch(`/api/bots/${botId}/stop`, { method: 'POST' });
    }

    // 2. Guardar nueva personalidad
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardando personalidad...';
    const res = await authFetch(`/api/bots/${botId}/personality`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tone,
        personality,
        system_prompt,
        forbidden_words,
        preferred_words,
        allow_emojis: false
      })
    });
    const result = await res.json();
    if (result.ok) {
      if (isOnline) {
        showToast('El bot fue apagado de forma segura y su nueva personalidad ha sido aplicada. (El bot no fue borrado)', 'success');
      } else {
        showToast('Personalidad y reglas de palabras guardadas correctamente', 'success');
      }
      closeModal('personalityModal');
      await fetchBots();
    } else {
      showToast('Error al guardar: ' + (result.error || 'Desconocido'), 'error');
    }
  } catch (err) {
    showToast('Error de conexión: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
};


// ==========================================
// CARRUSEL INTERACTIVO DE CAPACIDADES DEL SERVICIO
// ==========================================
let currentCarouselSlide = 0;
const totalCarouselSlides = 7;
let carouselAutoplayTimer = null;

window.goToCarouselSlide = function(idx) {
  if (idx < 0) idx = totalCarouselSlides - 1;
  if (idx >= totalCarouselSlides) idx = 0;
  currentCarouselSlide = idx;

  const track = document.getElementById('carouselTrack');
  if (track) {
    track.style.transform = 'translateX(-' + (currentCarouselSlide * 100) + '%)';
  }

  // Actualizar tabs superiores y centrar suavemente en vista móvil sin mover scroll vertical
  const tabsNav = document.getElementById('carouselTabsNav');
  const tabBtns = document.querySelectorAll('.carousel-tab-btn');
  tabBtns.forEach((btn, i) => {
    const isActive = i === currentCarouselSlide;
    btn.classList.toggle('active', isActive);
    if (isActive && tabsNav && tabsNav.scrollWidth > tabsNav.clientWidth) {
      const targetScroll = btn.offsetLeft - (tabsNav.clientWidth / 2) + (btn.offsetWidth / 2);
      tabsNav.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  });

  // Actualizar dots inferiores
  const dots = document.querySelectorAll('.carousel-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === currentCarouselSlide);
  });

  // Actualizar contador numérico
  const counter = document.getElementById('carouselCounter');
  if (counter) {
    counter.textContent = '0' + (currentCarouselSlide + 1) + ' / 0' + totalCarouselSlides;
  }
};

window.nextCarouselSlide = function() {
  window.goToCarouselSlide(currentCarouselSlide + 1);
};

window.prevCarouselSlide = function() {
  window.goToCarouselSlide(currentCarouselSlide - 1);
};

function initCarouselAutoplay() {
  const container = document.getElementById('heroCapabilitiesSection');
  if (!container) return;

  function startTimer() {
    stopTimer();
    carouselAutoplayTimer = setInterval(() => {
      window.nextCarouselSlide();
    }, 6000);
  }

  function stopTimer() {
    if (carouselAutoplayTimer) {
      clearInterval(carouselAutoplayTimer);
      carouselAutoplayTimer = null;
    }
  }

  container.addEventListener('mouseenter', stopTimer);
  container.addEventListener('mouseleave', startTimer);

  // Soporte táctil deslizable (swipe horizontal tipo app nativa) en celulares
  const trackContainer = document.getElementById('carouselTrackContainer');
  if (trackContainer) {
    let touchStartX = 0;
    let touchStartY = 0;
    trackContainer.addEventListener('touchstart', (e) => {
      if (!e.touches || !e.touches.length) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      stopTimer();
    }, { passive: true });

    trackContainer.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches.length) {
        startTimer();
        return;
      }
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) window.nextCarouselSlide();
        else window.prevCarouselSlide();
      }
      startTimer();
    }, { passive: true });
  }

  startTimer();
}

function initHeroLiveChatSimulation() {
  const typing = document.getElementById('chatTypingIndicator');
  if (!typing) return;
  setInterval(() => {
    typing.style.opacity = typing.style.opacity === '0' ? '1' : '0';
  }, 2600);
}

// ============================================================================
// CONTROL DE ACCESO POR GRUPOS Y CHATS ("DÓNDE ACTIVAR EL BOT")
// ============================================================================
state.accessModal = {
  botId: null,
  botName: '',
  botStatus: 'offline',
  prefix: '#',
  accessControl: {
    allowPrivateChats: true,
    groupMode: 'whitelist',
    allowedGroups: [],
    groupMetaCache: {}
  },
  groups: [],
  filter: 'all'
};

function normalizeClientAccessControl(bot) {
  const ac = bot?.settings?.accessControl || {};
  return {
    allowPrivateChats: ac.allowPrivateChats !== undefined ? Boolean(ac.allowPrivateChats) : true,
    groupMode: ['whitelist', 'none', 'all'].includes(ac.groupMode) ? ac.groupMode : 'whitelist',
    allowedGroups: Array.isArray(ac.allowedGroups) ? [...ac.allowedGroups] : [],
    groupMetaCache: (ac.groupMetaCache && typeof ac.groupMetaCache === 'object') ? { ...ac.groupMetaCache } : {}
  };
}

function getBotAccessSummary(bot) {
  const ac = normalizeClientAccessControl(bot);
  const count = ac.allowedGroups.length;

  if (!ac.allowPrivateChats && ac.groupMode === 'none') {
    return {
      title: 'Acceso: Bloqueado en Todo',
      subtitle: 'Desactivado en chats privados y en todos los grupos',
      stripClass: 'paused-all',
      icon: 'fa-ban'
    };
  }

  if (!ac.allowPrivateChats && ac.groupMode === 'whitelist') {
    return {
      title: `Solo en Grupos Habilitados (${count} ${count === 1 ? 'activo' : 'activos'})`,
      subtitle: count > 0
        ? 'Ignora chats privados y bloquea el resto de tus grupos'
        : 'Toca "Dónde Activar" para elegir en qué grupos encenderlo',
      stripClass: 'groups-only',
      icon: 'fa-users-gear'
    };
  }

  if (ac.allowPrivateChats && ac.groupMode === 'none') {
    return {
      title: 'Solo Chats Privados (0 Grupos)',
      subtitle: 'Bloqueado al 100% en todos tus grupos de WhatsApp',
      stripClass: '',
      icon: 'fa-user-lock'
    };
  }

  if (ac.groupMode === 'all') {
    return {
      title: ac.allowPrivateChats ? 'Privados + Todos los Grupos' : 'Todos los Grupos Activos',
      subtitle: 'Habilitado para responder en cualquier grupo participante',
      stripClass: '',
      icon: 'fa-globe'
    };
  }

  return {
    title: `Privados + ${count} ${count === 1 ? 'Grupo Habilitado' : 'Grupos Habilitados'}`,
    subtitle: count > 0
      ? 'Todos tus demás grupos de WhatsApp están bloqueados'
      : 'Ningún grupo tiene acceso hasta que lo habilites',
    stripClass: '',
    icon: 'fa-shield-halved'
  };
}
window.getBotAccessSummary = getBotAccessSummary;

function setAccessSaveFeedback(msg, isSaving = false) {
  const el = document.getElementById('accessSaveStatus');
  if (!el) return;
  el.innerHTML = isSaving
    ? `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(msg)}`
    : `<i class="fa-solid fa-circle-check text-green"></i> ${escapeHtml(msg)}`;
}

function getActiveScopePresetKey(ac) {
  if (!ac.allowPrivateChats && ac.groupMode === 'whitelist') return 'groups_only';
  if (ac.allowPrivateChats && ac.groupMode === 'none') return 'private_only';
  if (ac.allowPrivateChats && ac.groupMode === 'whitelist') return 'private_and_groups';
  return '';
}

function syncAccessModalControlsUI() {
  const ac = state.accessModal.accessControl;
  const activeScope = getActiveScopePresetKey(ac);

  document.querySelectorAll('#accessScopeGrid .access-scope-card').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scope === activeScope);
  });

  const privToggle = document.getElementById('accessPrivateToggle');
  if (privToggle) privToggle.checked = Boolean(ac.allowPrivateChats);

  const p = state.accessModal.prefix || '#';
  const c1 = document.getElementById('accessOfflineCmdCode');
  const c2 = document.getElementById('accessTipEnableCmd');
  const c3 = document.getElementById('accessTipDisableCmd');
  if (c1) c1.textContent = `${p}activar`;
  if (c2) c2.textContent = `${p}activar`;
  if (c3) c3.textContent = `${p}desactivar`;

  const offlineBanner = document.getElementById('accessOfflineNotice');
  if (offlineBanner) {
    offlineBanner.style.display = state.accessModal.botStatus === 'online' ? 'none' : 'flex';
  }

  document.querySelectorAll('.access-filter-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.gfilter === state.accessModal.filter);
  });

  renderBotAccessGroupsList();
}

function renderBotAccessGroupsList() {
  const listEl = document.getElementById('accessGroupsList');
  const countBadge = document.getElementById('accessGroupsCountBadge');
  if (!listEl) return;

  const ac = state.accessModal.accessControl;
  const groups = (state.accessModal.groups || []).map((g) => {
    const enabled = ac.groupMode === 'all'
      ? true
      : (ac.groupMode === 'none' ? false : ac.allowedGroups.includes(g.jid));
    return { ...g, enabled };
  });

  const enabledTotal = groups.filter((g) => g.enabled).length;
  if (countBadge) {
    if (ac.groupMode === 'none') {
      countBadge.textContent = `0 habilitados de ${groups.length} grupos (Modo Cero Grupos)`;
    } else {
      countBadge.textContent = `${enabledTotal} ${enabledTotal === 1 ? 'grupo habilitado' : 'grupos habilitados'} de ${groups.length}`;
    }
  }

  const query = (document.getElementById('accessGroupSearchInput')?.value || '').trim().toLowerCase();
  const filter = state.accessModal.filter || 'all';

  const visible = groups.filter((g) => {
    if (filter === 'enabled' && !g.enabled) return false;
    if (filter === 'blocked' && g.enabled) return false;
    if (query && !String(g.subject || '').toLowerCase().includes(query)) return false;
    return true;
  });

  if (!groups.length) {
    listEl.innerHTML = `
      <div class="access-groups-empty">
        <i class="fa-solid ${state.accessModal.botStatus === 'online' ? 'fa-users-slash' : 'fa-plug'}"></i>
        <strong>${state.accessModal.botStatus === 'online' ? 'No se encontraron grupos en esta línea de WhatsApp' : 'Bot desconectado de WhatsApp'}</strong>
        <span>${state.accessModal.botStatus === 'online'
          ? 'Cuando tu número participe en grupos aparecerán aquí automáticamente, bloqueados por defecto hasta que los actives.'
          : 'Conecta tu bot con QR o código de 8 dígitos para listar todos tus grupos actuales y elegir cuáles habilitar.'}</span>
      </div>
    `;
    return;
  }

  if (!visible.length) {
    listEl.innerHTML = `
      <div class="access-groups-empty">
        <i class="fa-solid fa-filter-circle-xmark"></i>
        <span>No hay grupos que coincidan con el filtro actual.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = visible.map((g) => {
    const safeJidAttr = escapeHtml(g.jid);
    const membersLabel = g.size > 0
      ? `${g.size} participantes`
      : (g.offlineCached ? 'Guardado en memoria' : 'Grupo de WhatsApp');
    return `
      <div class="access-group-row ${g.enabled ? 'is-enabled' : 'is-blocked'}">
        <div class="access-group-left">
          <div class="access-group-icon">
            <i class="fa-solid ${g.enabled ? 'fa-user-check' : 'fa-users'}"></i>
          </div>
          <div class="access-group-meta">
            <strong>${escapeHtml(g.subject || 'Grupo sin nombre')}</strong>
            <span>${escapeHtml(membersLabel)} &bull; ${g.enabled ? 'Con permiso para usar el bot' : 'Sin acceso al bot'}</span>
          </div>
        </div>
        <div class="access-group-right">
          <span class="access-status-tag ${g.enabled ? 'on' : 'off'}">${g.enabled ? 'Activo' : 'Bloqueado'}</span>
          <label class="toggle-switch" title="${g.enabled ? 'Desactivar bot en este grupo' : 'Habilitar bot en este grupo'}">
            <input type="checkbox" data-group-jid="${safeJidAttr}" ${g.enabled ? 'checked' : ''} onchange="handleGroupToggleInput(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;
  }).join('');
}
window.renderBotAccessGroupsList = renderBotAccessGroupsList;

function syncAccessModalFromBotUpdate(botData) {
  if (!botData || state.accessModal.botId !== botData.id) return;
  if (botData.status) state.accessModal.botStatus = botData.status;
  if (botData.settings?.accessControl) {
    state.accessModal.accessControl = normalizeClientAccessControl(botData);
  }
  syncAccessModalControlsUI();
}

async function openBotAccessModal(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;

  state.accessModal.botId = bot.id;
  state.accessModal.botName = bot.name;
  state.accessModal.botStatus = bot.status || 'offline';
  state.accessModal.prefix = bot.prefix || '#';
  state.accessModal.accessControl = normalizeClientAccessControl(bot);
  state.accessModal.filter = 'all';

  const searchInp = document.getElementById('accessGroupSearchInput');
  if (searchInp) searchInp.value = '';

  const nameEl = document.getElementById('accessModalBotName');
  if (nameEl) nameEl.textContent = bot.name;

  // Precargar grupos recordados de inmediato antes de la respuesta de red
  const cachedEntries = Object.entries(state.accessModal.accessControl.groupMetaCache || {});
  state.accessModal.groups = cachedEntries.map(([jid, m]) => ({
    jid,
    subject: m?.subject || 'Grupo Autorizado',
    size: Number(m?.size || 0),
    offlineCached: true
  }));

  const listEl = document.getElementById('accessGroupsList');
  if (listEl && !state.accessModal.groups.length) {
    listEl.innerHTML = `
      <div class="access-groups-empty">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <span>Cargando tus grupos de WhatsApp...</span>
      </div>
    `;
  }

  syncAccessModalControlsUI();
  setAccessSaveFeedback('Guardado instantáneo activo', false);
  openModal('botAccessModal');

  await loadBotAccessData(bot.id, false);
}
window.openBotAccessModal = openBotAccessModal;

async function loadBotAccessData(botId, forceRefresh = false) {
  try {
    const res = await authFetch(`/api/bots/${encodeURIComponent(botId)}/access${forceRefresh ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (!data.ok) {
      showToast(data.error || 'No se pudo cargar la lista de grupos', 'error');
      return;
    }
    if (state.accessModal.botId !== botId) return;

    state.accessModal.botStatus = data.botStatus || state.accessModal.botStatus;
    state.accessModal.prefix = data.prefix || state.accessModal.prefix;
    if (data.accessControl) {
      state.accessModal.accessControl = {
        allowPrivateChats: data.accessControl.allowPrivateChats !== false,
        groupMode: data.accessControl.groupMode || 'whitelist',
        allowedGroups: Array.isArray(data.accessControl.allowedGroups) ? data.accessControl.allowedGroups : [],
        groupMetaCache: data.accessControl.groupMetaCache || {}
      };
    }
    state.accessModal.groups = Array.isArray(data.groups) ? data.groups : [];
    syncAccessModalControlsUI();
  } catch (err) {
    console.error('Error cargando acceso de grupos:', err);
  }
}

async function refreshBotAccessGroups() {
  if (!state.accessModal.botId) return;
  const btn = document.getElementById('btnRefreshAccessGroups');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando';
  }
  await loadBotAccessData(state.accessModal.botId, true);
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Actualizar';
  }
  showToast('Lista de grupos sincronizada', 'info');
}
window.refreshBotAccessGroups = refreshBotAccessGroups;

function setAccessGroupFilter(filterKey) {
  state.accessModal.filter = filterKey || 'all';
  syncAccessModalControlsUI();
}
window.setAccessGroupFilter = setAccessGroupFilter;

async function persistBotAccessPatch(patch, toastMsg = null) {
  const botId = state.accessModal.botId;
  if (!botId) return;

  setAccessSaveFeedback('Guardando cambios...', true);
  try {
    const res = await authFetch(`/api/bots/${encodeURIComponent(botId)}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const data = await res.json();
    if (data.ok) {
      if (data.accessControl) {
        state.accessModal.accessControl = data.accessControl;
      }
      if (data.bot) {
        upsertBotInState(data.bot);
        renderBots();
      }
      syncAccessModalControlsUI();
      setAccessSaveFeedback('Cambios aplicados al instante', false);
      if (toastMsg) showToast(toastMsg, 'success');
    } else {
      setAccessSaveFeedback('Error al guardar', false);
      showToast(data.error || 'Error guardando configuración de acceso', 'error');
    }
  } catch (err) {
    setAccessSaveFeedback('Error de red', false);
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function applyBotAccessPreset(preset) {
  const ac = state.accessModal.accessControl;
  let patch = {};
  let msg = '';

  if (preset === 'groups_only') {
    patch = { allowPrivateChats: false, groupMode: 'whitelist' };
    msg = 'Modo activo: Solo para los grupos que habilites en la lista';
  } else if (preset === 'private_only') {
    patch = { allowPrivateChats: true, groupMode: 'none' };
    msg = 'Modo activo: Solo chats privados (bloqueado en todos los grupos)';
  } else {
    patch = { allowPrivateChats: true, groupMode: 'whitelist' };
    msg = 'Modo activo: Chats privados + grupos habilitados';
  }

  ac.allowPrivateChats = patch.allowPrivateChats;
  ac.groupMode = patch.groupMode;
  syncAccessModalControlsUI();

  await persistBotAccessPatch(patch, msg);
}
window.applyBotAccessPreset = applyBotAccessPreset;

async function togglePrivateChatsAccess(checked) {
  const allow = Boolean(checked);
  state.accessModal.accessControl.allowPrivateChats = allow;
  syncAccessModalControlsUI();
  await persistBotAccessPatch(
    { allowPrivateChats: allow },
    allow ? 'Chats privados individuales habilitados' : 'Chats privados desactivados (exclusivo para grupos)'
  );
}
window.togglePrivateChatsAccess = togglePrivateChatsAccess;

async function handleGroupToggleInput(checkboxEl) {
  if (!checkboxEl) return;
  const jid = checkboxEl.getAttribute('data-group-jid');
  const enabled = Boolean(checkboxEl.checked);
  if (!jid) return;

  const grp = (state.accessModal.groups || []).find((g) => g.jid === jid);
  const ac = state.accessModal.accessControl;

  if (enabled) {
    if (!ac.allowedGroups.includes(jid)) ac.allowedGroups.push(jid);
    if (ac.groupMode === 'none') ac.groupMode = 'whitelist';
  } else {
    ac.allowedGroups = ac.allowedGroups.filter((id) => id !== jid);
    if (ac.groupMode === 'all') ac.groupMode = 'whitelist';
  }

  syncAccessModalControlsUI();

  const label = grp?.subject || 'grupo';
  await persistBotAccessPatch(
    {
      toggleGroupJid: jid,
      enabled,
      groupSubject: grp?.subject || '',
      groupSize: grp?.size || 0
    },
    enabled ? `Bot habilitado en "${label}"` : `Bot bloqueado en "${label}"`
  );
}
window.handleGroupToggleInput = handleGroupToggleInput;

async function disableAllBotGroups() {
  const ac = state.accessModal.accessControl;
  ac.allowedGroups = [];
  if (ac.groupMode === 'all') ac.groupMode = 'whitelist';
  syncAccessModalControlsUI();

  await persistBotAccessPatch(
    { allowedGroups: [], groupMode: ac.allowPrivateChats ? ac.groupMode : 'whitelist' },
    'Todos los grupos han sido bloqueados para este bot'
  );
}
window.disableAllBotGroups = disableAllBotGroups;

// ============================================================================
// REPRODUCTOR DE MÚSICA AMBIENTAL VIP (SINTETIZADOR ESTÉREO + MP3 PROPIO)
// ============================================================================
const VIP_MUSIC_STORAGE_KEY = 'etho_vip_music_v1';

const VIP_STATION_TITLES = {
  lounge: 'Lounge Ejecutivo VIP',
  focus: 'Enfoque Nocturno',
  synth: 'Pulso Sintético Pro',
  custom: 'Mi Pista Personalizada'
};

const vipMusic = {
  ctx: null,
  masterGain: null,
  filterNode: null,
  reverbNode: null,
  dryGain: null,
  wetGain: null,
  isPlaying: false,
  loopTimer: null,
  stepIndex: 0,
  customAudio: null,
  customObjectUrl: null,
  customFileName: '',
  prefs: {
    autoPlayWanted: true,
    station: 'lounge',
    volume: 35,
    muted: false
  }
};

function loadVipMusicPrefs() {
  try {
    const raw = localStorage.getItem(VIP_MUSIC_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.autoPlayWanted === 'boolean') vipMusic.prefs.autoPlayWanted = parsed.autoPlayWanted;
      if (['lounge', 'focus', 'synth'].includes(parsed.station)) vipMusic.prefs.station = parsed.station;
      if (typeof parsed.volume === 'number') vipMusic.prefs.volume = Math.max(0, Math.min(100, parsed.volume));
      if (typeof parsed.muted === 'boolean') vipMusic.prefs.muted = parsed.muted;
    }
  } catch { /* ignorar */ }
}

function saveVipMusicPrefs() {
  try {
    localStorage.setItem(VIP_MUSIC_STORAGE_KEY, JSON.stringify({
      autoPlayWanted: vipMusic.prefs.autoPlayWanted,
      station: vipMusic.prefs.station === 'custom' ? 'lounge' : vipMusic.prefs.station,
      volume: vipMusic.prefs.volume,
      muted: vipMusic.prefs.muted
    }));
  } catch { /* ignorar */ }
}

function getEffectiveMusicGain() {
  if (vipMusic.prefs.muted || vipMusic.prefs.volume <= 0) return 0;
  // Curva logarítmica suave para volumen agradable
  const norm = vipMusic.prefs.volume / 100;
  return Math.pow(norm, 1.65) * 0.55;
}

function createVelvetReverbImpulse(ctx, seconds = 2.6, decay = 2.8) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      data[i] = (Math.random() * 2 - 1) * env * 0.45;
    }
  }
  return impulse;
}

function ensureVipAudioGraph() {
  if (vipMusic.ctx) return vipMusic.ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

  const filterNode = ctx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.setValueAtTime(1450, ctx.currentTime);
  filterNode.Q.setValueAtTime(0.7, ctx.currentTime);

  // LFO lento para dar calidez orgánica al filtro
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(0.09, ctx.currentTime);
  lfoGain.gain.setValueAtTime(320, ctx.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(filterNode.frequency);
  lfo.start();

  const dryGain = ctx.createGain();
  dryGain.gain.setValueAtTime(0.62, ctx.currentTime);

  const wetGain = ctx.createGain();
  wetGain.gain.setValueAtTime(0.48, ctx.currentTime);

  const reverbNode = ctx.createConvolver();
  reverbNode.buffer = createVelvetReverbImpulse(ctx, 2.7, 2.9);

  filterNode.connect(dryGain);
  filterNode.connect(reverbNode);
  reverbNode.connect(wetGain);

  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  masterGain.connect(ctx.destination);

  vipMusic.ctx = ctx;
  vipMusic.masterGain = masterGain;
  vipMusic.filterNode = filterNode;
  vipMusic.reverbNode = reverbNode;
  vipMusic.dryGain = dryGain;
  vipMusic.wetGain = wetGain;
  return ctx;
}

function triggerWarmVoice(freq, durationSec, opts = {}) {
  const ctx = vipMusic.ctx;
  if (!ctx || !vipMusic.filterNode || !vipMusic.isPlaying) return;

  const now = ctx.currentTime + (opts.offset || 0);
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const panNode = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const vGain = ctx.createGain();

  osc1.type = opts.wave1 || 'sine';
  osc2.type = opts.wave2 || 'triangle';
  osc1.frequency.setValueAtTime(freq, now);
  osc2.frequency.setValueAtTime(freq * (opts.detuneRatio || 1.0025), now);

  const peak = opts.gain ?? 0.12;
  const attack = opts.attack ?? 0.45;
  const release = opts.release ?? 1.4;

  vGain.gain.setValueAtTime(0.0001, now);
  vGain.gain.linearRampToValueAtTime(peak, now + attack);
  vGain.gain.setValueAtTime(peak * 0.82, now + Math.max(attack, durationSec - 0.1));
  vGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + release);

  osc1.connect(vGain);
  osc2.connect(vGain);

  if (panNode) {
    panNode.pan.setValueAtTime(opts.pan ?? 0, now);
    vGain.connect(panNode);
    panNode.connect(vipMusic.filterNode);
  } else {
    vGain.connect(vipMusic.filterNode);
  }

  osc1.start(now);
  osc2.start(now);
  const stopAt = now + durationSec + release + 0.08;
  osc1.stop(stopAt);
  osc2.stop(stopAt);
}

function scheduleCurrentStationBar() {
  if (!vipMusic.isPlaying || vipMusic.prefs.station === 'custom') return;
  const step = vipMusic.stepIndex++;
  const st = vipMusic.prefs.station;

  if (st === 'lounge') {
    // Progresión Jazz-Lounge VIP: Dm9 -> G13 -> Cmaj9 -> A7alt
    const chords = [
      { bass: 73.42, notes: [146.83, 261.63, 329.63, 440.00], bell: [659.25, 587.33] },
      { bass: 98.00, notes: [196.00, 246.94, 329.63, 440.00], bell: [659.25, 783.99] },
      { bass: 65.41, notes: [130.81, 246.94, 293.66, 392.00], bell: [587.33, 659.25] },
      { bass: 55.00, notes: [110.00, 220.00, 277.18, 349.23], bell: [523.25, 440.00] }
    ];
    const bar = chords[step % chords.length];
    triggerWarmVoice(bar.bass, 3.2, { wave1: 'sine', wave2: 'sine', gain: 0.18, attack: 0.25, release: 1.3 });
    bar.notes.forEach((n, idx) => {
      triggerWarmVoice(n, 2.9, {
        offset: idx * 0.06,
        wave1: 'sine',
        wave2: 'triangle',
        gain: 0.085,
        attack: 0.5,
        release: 1.8,
        pan: (idx - 1.5) * 0.28
      });
    });
    // Destello melódico suave de piano eléctrico
    triggerWarmVoice(bar.bell[0], 0.9, { offset: 1.4, wave1: 'sine', wave2: 'sine', gain: 0.055, attack: 0.08, release: 1.5, pan: 0.35 });
    triggerWarmVoice(bar.bell[1], 1.1, { offset: 2.4, wave1: 'sine', wave2: 'sine', gain: 0.048, attack: 0.08, release: 1.6, pan: -0.35 });
  } else if (st === 'focus') {
    // Ambiente Espacial Nocturno: Fmaj9 -> Em7 -> Dm9 -> Cmaj9
    const pads = [
      { bass: 87.31, notes: [174.61, 261.63, 329.63, 392.00], shimmer: 523.25 },
      { bass: 82.41, notes: [164.81, 246.94, 293.66, 392.00], shimmer: 587.33 },
      { bass: 73.42, notes: [146.83, 220.00, 261.63, 329.63], shimmer: 440.00 },
      { bass: 65.41, notes: [130.81, 196.00, 246.94, 293.66], shimmer: 392.00 }
    ];
    const bar = pads[step % pads.length];
    triggerWarmVoice(bar.bass, 4.4, { wave1: 'sine', wave2: 'sine', gain: 0.16, attack: 1.1, release: 2.4 });
    bar.notes.forEach((n, idx) => {
      triggerWarmVoice(n, 4.0, {
        wave1: 'sine',
        wave2: 'triangle',
        gain: 0.075,
        attack: 1.3,
        release: 2.6,
        detuneRatio: 1.004,
        pan: (idx % 2 === 0 ? -0.4 : 0.4)
      });
    });
    triggerWarmVoice(bar.shimmer, 1.8, { offset: 2.1, wave1: 'sine', wave2: 'sine', gain: 0.04, attack: 0.4, release: 2.2, pan: 0.25 });
  } else if (st === 'synth') {
    // Pulso Sintético Pro: Am9 -> Fmaj7 -> Cmaj7 -> G6
    const synthBars = [
      { bass: 55.00, arp: [220.00, 261.63, 329.63, 493.88, 392.00, 329.63, 261.63, 329.63] },
      { bass: 43.65, arp: [174.61, 220.00, 261.63, 329.63, 392.00, 329.63, 261.63, 220.00] },
      { bass: 65.41, arp: [196.00, 246.94, 293.66, 392.00, 329.63, 293.66, 246.94, 196.00] },
      { bass: 49.00, arp: [196.00, 246.94, 293.66, 329.63, 392.00, 329.63, 293.66, 246.94] }
    ];
    const bar = synthBars[step % synthBars.length];
    // Pulso de bajo cálido en negras
    for (let b = 0; b < 8; b++) {
      triggerWarmVoice(bar.bass * (b % 2 === 1 ? 2 : 1), 0.24, {
        offset: b * 0.4,
        wave1: 'triangle',
        wave2: 'sine',
        gain: 0.13,
        attack: 0.03,
        release: 0.22
      });
      triggerWarmVoice(bar.arp[b], 0.28, {
        offset: b * 0.4,
        wave1: 'sine',
        wave2: 'triangle',
        gain: 0.068,
        attack: 0.04,
        release: 0.55,
        pan: (b % 2 === 0 ? -0.32 : 0.32)
      });
    }
  }
}

function getStationIntervalMs() {
  if (vipMusic.prefs.station === 'focus') return 4600;
  if (vipMusic.prefs.station === 'synth') return 3200;
  return 3800;
}

function stopSynthScheduler() {
  if (vipMusic.loopTimer) {
    clearInterval(vipMusic.loopTimer);
    vipMusic.loopTimer = null;
  }
}

async function startVipMusic(fadeInSec = 0.9) {
  if (vipMusic.prefs.station === 'custom' && vipMusic.customAudio) {
    try {
      vipMusic.customAudio.volume = vipMusic.prefs.muted ? 0 : (vipMusic.prefs.volume / 100);
      await vipMusic.customAudio.play();
      vipMusic.isPlaying = true;
      vipMusic.prefs.autoPlayWanted = true;
      saveVipMusicPrefs();
      syncVipMusicUI();
      return true;
    } catch {
      return false;
    }
  }

  const ctx = ensureVipAudioGraph();
  if (!ctx) return false;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  if (ctx.state !== 'running') return false;

  vipMusic.isPlaying = true;
  vipMusic.prefs.autoPlayWanted = true;
  saveVipMusicPrefs();

  const targetGain = getEffectiveMusicGain();
  const now = ctx.currentTime;
  vipMusic.masterGain.gain.cancelScheduledValues(now);
  vipMusic.masterGain.gain.setValueAtTime(Math.max(0.0001, vipMusic.masterGain.gain.value), now);
  vipMusic.masterGain.gain.linearRampToValueAtTime(targetGain, now + fadeInSec);

  stopSynthScheduler();
  scheduleCurrentStationBar();
  vipMusic.loopTimer = setInterval(scheduleCurrentStationBar, getStationIntervalMs());

  syncVipMusicUI();
  return true;
}

function pauseVipMusic(saveAsUserPaused = true) {
  vipMusic.isPlaying = false;
  if (saveAsUserPaused) {
    vipMusic.prefs.autoPlayWanted = false;
    saveVipMusicPrefs();
  }
  stopSynthScheduler();

  if (vipMusic.customAudio) {
    try { vipMusic.customAudio.pause(); } catch { /* ignorar */ }
  }

  if (vipMusic.ctx && vipMusic.masterGain) {
    const now = vipMusic.ctx.currentTime;
    vipMusic.masterGain.gain.cancelScheduledValues(now);
    vipMusic.masterGain.gain.setValueAtTime(vipMusic.masterGain.gain.value, now);
    vipMusic.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
  }
  syncVipMusicUI();
}

async function toggleVipMusicPlayback() {
  if (vipMusic.isPlaying) {
    pauseVipMusic(true);
  } else {
    const ok = await startVipMusic(0.5);
    if (!ok) {
      showToast('Toca de nuevo para activar el audio del navegador', 'info');
    }
  }
}
window.toggleVipMusicPlayback = toggleVipMusicPlayback;

function setVipMusicVolume(val) {
  const num = Math.max(0, Math.min(100, Number(val) || 0));
  vipMusic.prefs.volume = num;
  if (num > 0 && vipMusic.prefs.muted) vipMusic.prefs.muted = false;
  saveVipMusicPrefs();

  if (vipMusic.customAudio) {
    vipMusic.customAudio.volume = vipMusic.prefs.muted ? 0 : (num / 100);
  }
  if (vipMusic.ctx && vipMusic.masterGain && vipMusic.isPlaying) {
    const now = vipMusic.ctx.currentTime;
    vipMusic.masterGain.gain.cancelScheduledValues(now);
    vipMusic.masterGain.gain.linearRampToValueAtTime(getEffectiveMusicGain(), now + 0.12);
  }
  syncVipMusicUI();
}
window.setVipMusicVolume = setVipMusicVolume;

function toggleVipMusicMute() {
  vipMusic.prefs.muted = !vipMusic.prefs.muted;
  saveVipMusicPrefs();

  if (vipMusic.customAudio) {
    vipMusic.customAudio.volume = vipMusic.prefs.muted ? 0 : (vipMusic.prefs.volume / 100);
  }
  if (vipMusic.ctx && vipMusic.masterGain && vipMusic.isPlaying) {
    const now = vipMusic.ctx.currentTime;
    vipMusic.masterGain.gain.cancelScheduledValues(now);
    vipMusic.masterGain.gain.linearRampToValueAtTime(getEffectiveMusicGain(), now + 0.15);
  }
  syncVipMusicUI();
}
window.toggleVipMusicMute = toggleVipMusicMute;

async function selectVipMusicStation(stationKey) {
  if (!['lounge', 'focus', 'synth', 'custom'].includes(stationKey)) return;
  if (stationKey === 'custom' && !vipMusic.customAudio) {
    triggerCustomMusicUpload();
    return;
  }

  if (stationKey !== 'custom' && vipMusic.customAudio) {
    try { vipMusic.customAudio.pause(); } catch { /* ignorar */ }
  }
  if (stationKey === 'custom') {
    stopSynthScheduler();
    if (vipMusic.ctx && vipMusic.masterGain) {
      vipMusic.masterGain.gain.setValueAtTime(0.0001, vipMusic.ctx.currentTime);
    }
  }

  vipMusic.prefs.station = stationKey;
  vipMusic.stepIndex = 0;
  saveVipMusicPrefs();

  await startVipMusic(0.45);
}
window.selectVipMusicStation = selectVipMusicStation;

function triggerCustomMusicUpload() {
  const inp = document.getElementById('customMusicFileInput');
  if (inp) inp.click();
}
window.triggerCustomMusicUpload = triggerCustomMusicUpload;

async function handleCustomMusicFileSelected(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  if (vipMusic.customObjectUrl) {
    URL.revokeObjectURL(vipMusic.customObjectUrl);
  }
  if (vipMusic.customAudio) {
    try { vipMusic.customAudio.pause(); } catch { /* ignorar */ }
  }

  const url = URL.createObjectURL(file);
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = vipMusic.prefs.muted ? 0 : (vipMusic.prefs.volume / 100);

  vipMusic.customObjectUrl = url;
  vipMusic.customAudio = audio;
  vipMusic.customFileName = file.name.replace(/\.[^/.]+$/, '');
  vipMusic.prefs.station = 'custom';

  const lbl = document.getElementById('customMusicTrackLabel');
  if (lbl) lbl.textContent = `Mi Pista: ${vipMusic.customFileName}`;

  stopSynthScheduler();
  if (vipMusic.ctx && vipMusic.masterGain) {
    vipMusic.masterGain.gain.setValueAtTime(0.0001, vipMusic.ctx.currentTime);
  }

  await startVipMusic(0.3);
  showToast(`Reproduciendo "${vipMusic.customFileName}"`, 'success');
}
window.handleCustomMusicFileSelected = handleCustomMusicFileSelected;

function syncVipMusicUI() {
  const playing = vipMusic.isPlaying && !vipMusic.prefs.muted && vipMusic.prefs.volume > 0;
  document.querySelectorAll('.music-trigger-btn').forEach((btn) => {
    btn.classList.toggle('is-playing', playing);
  });

  const panelEq = document.getElementById('musicPanelEq');
  if (panelEq) panelEq.classList.toggle('is-playing', playing);

  const titleEl = document.getElementById('musicCurrentTrackTitle');
  if (titleEl) {
    titleEl.textContent = vipMusic.prefs.station === 'custom' && vipMusic.customFileName
      ? vipMusic.customFileName
      : (VIP_STATION_TITLES[vipMusic.prefs.station] || 'Lounge Ejecutivo VIP');
  }

  const stateEl = document.getElementById('musicCurrentStateLabel');
  if (stateEl) {
    if (!vipMusic.isPlaying) stateEl.textContent = 'En pausa';
    else if (vipMusic.prefs.muted || vipMusic.prefs.volume === 0) stateEl.textContent = 'Silenciado';
    else stateEl.textContent = 'Reproduciendo en vivo';
  }

  const playIcon = document.getElementById('musicPlayPauseIcon');
  const playText = document.getElementById('musicPlayPauseText');
  const playBtn = document.getElementById('musicPlayPauseBtn');
  if (playIcon) playIcon.className = vipMusic.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
  if (playText) playText.textContent = vipMusic.isPlaying ? 'Pausar' : 'Reproducir';
  if (playBtn) {
    playBtn.classList.toggle('btn-secondary', vipMusic.isPlaying);
    playBtn.classList.toggle('btn-primary', !vipMusic.isPlaying);
  }

  const slider = document.getElementById('musicVolumeSlider');
  if (slider && Number(slider.value) !== vipMusic.prefs.volume) {
    slider.value = vipMusic.prefs.volume;
  }
  const volVal = document.getElementById('musicVolumeVal');
  if (volVal) volVal.textContent = vipMusic.prefs.muted ? 'MUTE' : `${vipMusic.prefs.volume}%`;

  const volIcon = document.getElementById('musicVolumeIcon');
  if (volIcon) {
    if (vipMusic.prefs.muted || vipMusic.prefs.volume === 0) volIcon.className = 'fa-solid fa-volume-xmark text-red';
    else if (vipMusic.prefs.volume < 50) volIcon.className = 'fa-solid fa-volume-low';
    else volIcon.className = 'fa-solid fa-volume-high text-green';
  }

  document.querySelectorAll('#vipMusicStations .vip-station-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.station === vipMusic.prefs.station);
  });
}

function handleMusicButtonClick(event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById('vipMusicPanel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'flex' : 'none';

  // Si abre el panel por primera vez y no está sonando, iniciar música automáticamente
  if (isHidden && !vipMusic.isPlaying) {
    startVipMusic(0.6);
  } else {
    syncVipMusicUI();
  }
}
window.handleMusicButtonClick = handleMusicButtonClick;

function closeMusicPanel() {
  const panel = document.getElementById('vipMusicPanel');
  if (panel) panel.style.display = 'none';
}
window.closeMusicPanel = closeMusicPanel;

function initVipMusicSystem() {
  loadVipMusicPrefs();
  syncVipMusicUI();

  // Cerrar el mini-panel al hacer clic fuera de él (la música continúa sonando)
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('vipMusicPanel');
    if (!panel || panel.style.display === 'none') return;
    if (panel.contains(e.target) || e.target.closest('.music-trigger-btn')) return;
    panel.style.display = 'none';
  });

  // Activación automática suave si el usuario no pausó explícitamente la música
  if (vipMusic.prefs.autoPlayWanted) {
    const unlockOnce = async () => {
      if (!vipMusic.prefs.autoPlayWanted || vipMusic.isPlaying) {
        cleanupUnlock();
        return;
      }
      const ok = await startVipMusic(1.3);
      if (ok) cleanupUnlock();
    };
    const cleanupUnlock = () => {
      document.removeEventListener('pointerdown', unlockOnce);
      document.removeEventListener('keydown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce, { passive: true });
    document.addEventListener('keydown', unlockOnce, { passive: true });
    // Intentar arranque directo si el navegador ya lo permite
    startVipMusic(1.3).then((ok) => {
      if (ok) cleanupUnlock();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initCarouselAutoplay();
  initHeroLiveChatSimulation();
  initVipMusicSystem();
});
