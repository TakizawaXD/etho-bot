// Motor de Inteligencia Artificial Avanzado de Atención a Usuarios, Asesoría y Resolución Directa.
// Entregando únicamente respuestas limpias, precisas y empáticas (CERO recomendaciones de comandos).
import axios from 'axios';
import 'dotenv/config';
import { SEP_DOT } from './ui.js';
import { formatForWhatsApp } from './format.js';
import { buildProtocol, detectLanguage, looksLikeInjection, trimHistory, trimToCompleteSentence, createBreaker } from './ai-quality.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
// Si un proveedor falla 3 veces seguidas se salta 60 s: la persona recibe respuesta rápido en vez de esperar timeouts.
const breaker = createBreaker({ threshold: 3, cooldownMs: 60_000 });
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const TONE_INSTRUCTIONS = {
  profesional: 'Tono formal, cortés, claro, estructurado y altamente profesional. Transmite confianza y solvencia.',
  amigable: 'Tono cálido, cercano, empático y servicial, manteniendo siempre respeto y claridad.',
  ejecutivo: 'Tono ejecutivo de alto nivel: preciso, directo, orientado a decisiones y soluciones inmediatas.',
  directo: 'Respuestas breves, concretas y al grano, resolviendo la consulta en las mínimas líneas posibles.'
};

export const PERSONA_PROMPTS = {
  recreational:
    'Eres un especialista conversacional inteligente en WhatsApp, preparado para atender a cualquier usuario con agilidad, claridad, cultura general y calidez humana. ' +
    'Resuelves dudas, explicas temas complejos de forma sencilla, redactas textos, analizas ideas y mantienes conversaciones fluidas en español.',

  assistant:
    'Eres un Asistente Ejecutivo y de Atención al Usuario de primer nivel en WhatsApp. ' +
    'Estás entrenado para analizar solicitudes con precisión, organizar pendientes, redactar respuestas impecables, resolver cálculos y dar soluciones prácticas paso a paso en español.',

  advisor:
    'Eres un Asesor Senior de Atención al Cliente, Ventas y Soporte en WhatsApp. ' +
    'Dominas la escucha activa, el manejo empático de dudas o reclamos, la presentación clara de productos/servicios, cotizaciones y el cierre consultivo sin presionar al usuario.',

  ai_autonomous:
    'Eres una Inteligencia Artificial Autónoma de Atención Integral en WhatsApp. ' +
    'Razonas cada consulta a fondo, recuerdas el contexto completo de la conversación, te adaptas al perfil del usuario y entregas respuestas completas, exactas y resolutivas en español.'
};

/**
 * Extrae hechos clave sobre el usuario de forma automática a partir de sus mensajes
 * para personalizar la atención en turnos futuros.
 */
export function extractUserFacts(text) {
  if (!text || typeof text !== 'string') return [];
  const facts = [];
  const t = text.trim();

  // 1. Nombre
  const nameMatch = t.match(/\b(?:me llamo|mi nombre es|soy)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/);
  const nameMatchLoose = !nameMatch
    ? t.match(/\b(?:me llamo|mi nombre es)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+)?)/i)
    : null;
  const nm = nameMatch || nameMatchLoose;
  if (nm) {
    const val = nm[1].trim().replace(/\s+(y|e|de|en|con|que|tengo|vivo|soy|busco|necesito)$/i, '').trim();
    if (val.length >= 2 && !/^(un|una|el|la|de|en|muy|bien|mal|aqui|del|hola|hey|cliente|usuario|programador|abogado|medico|estudiante|ingeniero|vendedor)\b/i.test(val)) {
      facts.push({ key: 'nombre', value: val });
    }
  }

  // 2. Negocio / Empresa
  const bizMatch = t.match(/\b(?:mi empresa es|mi negocio es|mi tienda es|trabajo en|tengo una? (?:tienda|empresa|negocio|marca|agencia|restaurante) de)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ0-9\s]{2,45})/i);
  if (bizMatch) {
    const val = bizMatch[1].trim().split(/[,.!?]/)[0].trim().replace(/\s+(en|de|con|para)\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+$/i, '').trim();
    if (val.length >= 2) facts.push({ key: 'negocio', value: val });
  }

  // 3. Ubicación / Ciudad
  const locMatch = t.match(/\b(?:vivo en|soy de|estoy en|radico en|escribo desde)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+(?:\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+)?)/i);
  if (locMatch) {
    const val = locMatch[1].trim().split(/[,.!?]/)[0].trim();
    if (val.length >= 3 && !/^(un|una|aqui|alla|casa|paz|linea|el trabajo|la oficina)\b/i.test(val)) {
      facts.push({ key: 'ciudad', value: val });
    }
  }

  // 4. Profesión u oficio
  const jobMatch = t.match(/\b(?:soy|trabajo como|me dedico a ser)\s+(programador|desarrollador|abogado|médico|medico|contador|diseñador|vendedor|estudiante|ingeniero|profesor|cocinero|comerciante|arquitecto|emprendedor|administrador)\b/i);
  if (jobMatch) {
    facts.push({ key: 'ocupacion', value: jobMatch[1].trim().toLowerCase() });
  }

  // 5. Correo electrónico
  const emailMatch = t.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (emailMatch) {
    facts.push({ key: 'correo', value: emailMatch[0].toLowerCase() });
  }

  // 6. Interés o necesidad principal expresada
  const interestMatch = t.match(/\b(?:me interesa|estoy buscando|quiero cotizar|necesito informacion sobre|necesito información sobre)\s+([^,.!?\n]{4,70})/i);
  if (interestMatch) {
    facts.push({ key: 'interes_reciente', value: interestMatch[1].trim() });
  }

  return facts;
}

/**
 * Construye el bloque de conocimiento operativo del bot (catálogo, FAQs, horarios, propósito)
 */
function buildOperationalContext({ purpose = '', products = [], knowledge = [], businessHours = null } = {}) {
  const sections = [];

  if (purpose && String(purpose).trim()) {
    sections.push(`[Propósito / Giro del Servicio]: ${String(purpose).trim()}`);
  }

  if (businessHours && businessHours.enabled) {
    const days = Array.isArray(businessHours.days)
      ? businessHours.days.map(d => DAY_NAMES[d]).filter(Boolean).join(', ')
      : 'Lunes a Viernes';
    sections.push(`[Horario de Atención]: ${days} de ${businessHours.startTime || '09:00'} a ${businessHours.endTime || '18:00'}.`);
  }

  if (Array.isArray(products) && products.length > 0) {
    const prodLines = products.slice(0, 20).map(p =>
      `- ${p.name} (${p.category || 'General'}): ${p.price} ${p.currency || 'USD'}${p.description ? ` — ${p.description}` : ''}`
    );
    sections.push(`[Catálogo Activo de Productos y Servicios]:\n${prodLines.join('\n')}`);
  }

  if (Array.isArray(knowledge) && knowledge.length > 0) {
    const kbLines = knowledge.slice(0, 15).map(k =>
      `- [${k.category || 'Info'}] ${k.title}: ${k.content}`
    );
    sections.push(`[Base de Conocimiento y Respuestas Oficiales]:\n${kbLines.join('\n')}`);
  }

  return sections.length > 0 ? `\n${sections.join('\n\n')}` : '';
}

/**
 * Consulta a la IA preparada para atención al usuario, dando únicamente respuestas directas y precisas.
 */
export async function askAI(prompt, customSystemPrompt = null, personality = 'recreational', options = {}) {
  const {
    history = [],
    userFacts = {},
    botName = 'Etho',
    isAutoPilot = false,
    pilotPersona = 'as_assistant',
    ownerName = '',
    pilotContext = '',
    purpose = '',
    tone = 'profesional',
    forbiddenWords = [],
    preferredWords = [],
    products = [],
    knowledge = [],
    businessHours = null,
    unknownCommand = '',
    prefix = '#'
  } = options;

  // Si el usuario escribió accidentalmente "#algo" que no es comando (ej. "#horarios" o "#ayuda con mi pedido"),
  // convertimos la consulta en su intención limpia para responderle directamente sin mencionar errores de comandos.
  const effectivePrompt = (unknownCommand && prompt.trim().startsWith(prefix)
    ? (prompt.trim().slice(prefix.length).trim() || prompt.trim())
    : prompt.trim()).slice(0, 2000);

  const ownerLabel = (ownerName && ownerName.trim()) ? ownerName.trim() : 'el titular de esta cuenta';
  const isAdvisorDM = Boolean(isAutoPilot && pilotPersona === 'as_assistant');
  const isDirectOwnerRequest = /\b(hablar directamente|hablar con el dueno|hablar con el titular|persona real|atencion directa|pasame con|comunicarme directamente)\b/i.test(
    effectivePrompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );

  // En modo Asesor Privado, solo recordar /enable en el primer contacto o si piden hablar directamente con el dueño
  const shouldMentionEnable = Boolean(isAdvisorDM && (history.length === 0 || isDirectOwnerRequest));

  const finalizeReply = (cleanedText) => {
    if (shouldMentionEnable && !/\/enable\b/i.test(cleanedText)) {
      return `${cleanedText}\n${SEP_DOT}\n💬 _Si necesitas comunicarte directamente con ${ownerLabel}, escribe_ */enable*`;
    }
    return cleanedText;
  };

  let baseSystem = customSystemPrompt || PERSONA_PROMPTS[personality] || PERSONA_PROMPTS.recreational;

  if (isAutoPilot) {
    if (pilotPersona === 'as_assistant') {
      baseSystem =
        `Eres el Asesor y Ayudante Personal de ${ownerLabel} en WhatsApp. ` +
        `REGLA FUNDAMENTAL: NUNCA finjas ser ${ownerLabel} en primera persona. Cuando te saluden o pregunten por ${ownerLabel}, preséntate con amabilidad y solvencia como su asesor/ayudante encargado de atenderle mientras se desocupa. ` +
        `Atiende a cada contacto con trato ejecutivo, empático y resolutivo: escucha lo que necesita, responde sus consultas con precisión usando la información disponible, pide los datos necesarios si requiere un servicio o deja su recado perfectamente organizado para ${ownerLabel}. ` +
        `Da únicamente la respuesta directa a la persona, sin agregar recomendaciones ni listas de comandos.`;
    } else {
      baseSystem =
        `Eres ${ownerLabel}. Estás respondiendo directamente tus mensajes en WhatsApp en primera persona ("yo", "me", "mi"), de forma natural, humana, educada y concisa. ` +
        `Si te piden algo que requiere revisión detallada o una reunión, indícales con naturalidad que estás ocupado en este momento pero que apenas te liberes lo revisas personalmente.`;
    }
    if (pilotContext) {
      baseSystem += `\n[Contexto e instrucciones actuales de ${ownerLabel}]: ${pilotContext}`;
    }
  } else if (pilotContext) {
    baseSystem += `\n[Contexto operativo adicional]: ${pilotContext}`;
  }

  const operationalContext = buildOperationalContext({ purpose, products, knowledge, businessHours });

  // Memoria aprendida del usuario
  const normalizedFacts = { ...userFacts };
  if (normalizedFacts.name && !normalizedFacts.nombre) {
    normalizedFacts.nombre = normalizedFacts.name;
    delete normalizedFacts.name;
  }
  if (normalizedFacts.business && !normalizedFacts.negocio) {
    normalizedFacts.negocio = normalizedFacts.business;
    delete normalizedFacts.business;
  }
  if (normalizedFacts.location && !normalizedFacts.ciudad) {
    normalizedFacts.ciudad = normalizedFacts.location;
    delete normalizedFacts.location;
  }

  const factKeys = Object.keys(normalizedFacts);
  const factsContext = factKeys.length > 0
    ? '\n[Perfil y datos recordados de este usuario]:\n' + factKeys.map(k => `- ${k}: ${normalizedFacts[k]}`).join('\n')
    : '';

  const toneInstruction = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.profesional;
  const styleDirectives = [
    `\n[Directivas de Tono y Restricciones]:`,
    `- Tono requerido: ${toneInstruction}`,
    `- Usa emojis sobrios y puntuales solo cuando aporten calidez o claridad visual (máximo 2 por mensaje).`,
    `- Formato WhatsApp: *negrita* con un solo asterisco, _cursiva_ y viñetas con "•". Nunca uses títulos con #, tablas, **dobles asteriscos** ni bloques de código.`,
    `- Sé breve: ve directo al punto en 2 a 5 líneas, con párrafos cortos. No repitas el saludo ni te presentes en cada mensaje. Cierra con una sola pregunta o el siguiente paso claro.`
  ];

  const forbiddenList = Array.isArray(forbiddenWords)
    ? forbiddenWords
    : String(forbiddenWords || '').split(',').map(s => s.trim()).filter(Boolean);
  if (forbiddenList.length > 0) {
    styleDirectives.push(`- PALABRAS PROHIBIDAS (Nunca las uses): ${forbiddenList.join(', ')}`);
  }

  const preferredList = Array.isArray(preferredWords)
    ? preferredWords
    : String(preferredWords || '').split(',').map(s => s.trim()).filter(Boolean);
  if (preferredList.length > 0) {
    styleDirectives.push(`- TÉRMINOS PREFERIDOS (Intégralos con naturalidad cuando aplique): ${preferredList.join(', ')}`);
  }

  const identityLine = isAutoPilot
    ? ''
    : `\nTu nombre de asistente es ${botName}. Atiende al usuario como un profesional experto y cercano.`;

  const cleanHistory = trimHistory(history);
  const protocol = buildProtocol({
    isFirstContact: cleanHistory.length === 0,
    userLanguage: detectLanguage(effectivePrompt),
    injectionSuspected: looksLikeInjection(effectivePrompt)
  });

  const fullSystemPrompt = [
    baseSystem + identityLine,
    operationalContext,
    factsContext,
    '',
    protocol,
    styleDirectives.join('\n')
  ].filter(Boolean).join('\n');

  // Acabado común: recorte limpio si se cortó por límite, limpieza de formato y marca de /enable
  const polish = (raw, truncated = false) =>
    finalizeReply(cleanResponseText(trimToCompleteSentence(raw.trim(), { truncated }), forbiddenList));

  // 1. Proveedor Principal: Google Gemini (si GEMINI_API_KEY está activa)
  if (GEMINI_KEY && breaker.allow('gemini')) {
    for (const modelName of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        // La clave va en la cabecera (no en la URL) para que no aparezca en logs ni en errores.
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
        const contents = cleanHistory.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }]
        }));
        contents.push({ role: 'user', parts: [{ text: effectivePrompt }] });

        const res = await axios.post(url, {
          system_instruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 700, temperature: 0.5, topP: 0.9 }
        }, { timeout: 12000, headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' } });

        const cand = res.data?.candidates?.[0];
        const text = cand?.content?.parts?.map((p) => p.text || '').join('');
        if (text && text.trim()) {
          breaker.success('gemini');
          return polish(text, cand?.finishReason === 'MAX_TOKENS');
        }
      } catch {
        // Intentar siguiente modelo/proveedor
      }
    }
    breaker.failure('gemini');
  }

  // 2. Proveedor Neuronal OpenAI-Compatible (Pollinations Chat Completions con historial completo)
  const chatMessages = [
    { role: 'system', content: fullSystemPrompt },
    ...cleanHistory,
    { role: 'user', content: effectivePrompt }
  ];

  for (const endpoint of (breaker.allow('pollinations') ? ['https://text.pollinations.ai/openai', 'https://text.pollinations.ai/'] : [])) {
    try {
      const res = await axios.post(endpoint, {
        model: 'openai',
        messages: chatMessages,
        temperature: 0.5,
        private: true
      }, {
        timeout: 11000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'EthoBot-VIP/2.5' }
      });

      const rawText = typeof res.data === 'string'
        ? res.data
        : (res.data?.choices?.[0]?.message?.content || '');
      if (rawText && rawText.trim()) {
        const cleaned = polish(rawText);
        if (cleaned.length > 2) {
          breaker.success('pollinations');
          return cleaned;
        }
      }
    } catch {
      // Continuar al respaldo
    }
  }
  if (breaker.allow('pollinations')) breaker.failure('pollinations');

  // 3. Motor Cognitivo Experto de Atención al Usuario (100% local, cero caídas, alimentado por catálogo y base de conocimiento)
  const cognitive = generateCognitiveResponse(effectivePrompt, personality, history, normalizedFacts, botName, {
    isAutoPilot,
    pilotPersona,
    ownerName: ownerLabel,
    pilotContext,
    products,
    knowledge,
    businessHours
  });
  return finalizeReply(cleanResponseText(cognitive, forbiddenList));
}

/**
 * Limpia artefactos, prefijos de rol, palabras prohibidas y cualquier bloque no deseado de recomendaciones de comandos.
 */
export function cleanResponseText(str, forbiddenWords = []) {
  if (!str || typeof str !== 'string') return '';
  let cleaned = str
    .replace(/^(?:Etho|Asistente|Asesor|Bot|Respuesta):\s*/i, '')
    // Eliminar cualquier bloque de recomendaciones de comandos si algún modelo externo intentara añadirlo
    .replace(/\n*(?:━+\n)?✨?\s*\*?COMANDOS RECOMENDADOS[\s\S]*$/i, '')
    .replace(/\n*✨?\s*\*?Comandos sugeridos[\s\S]*$/i, '')
    .replace(/\b(nya|purr|mrrp|meow|nekotina|uwu|onii-chan|senpai|kawaii|yamete)\b~*/gi, '');

  if (Array.isArray(forbiddenWords)) {
    for (const w of forbiddenWords) {
      if (!w || !w.trim()) continue;
      const re = new RegExp(`\\b${w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      cleaned = cleaned.replace(re, '');
    }
  }

  // Markdown -> formato nativo de WhatsApp, espaciado limpio y sin artefactos
  return formatForWhatsApp(cleaned);
}

/**
 * Motor Cognitivo Experto de Respaldo para Atención al Usuario (usa catálogo real, FAQs, horarios, cálculos y memoria)
 */
function generateCognitiveResponse(prompt, personality, history = [], userFacts = {}, botName = 'Etho', options = {}) {
  const p = prompt.toLowerCase().trim();
  const pNorm = p.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const userName = userFacts.nombre || userFacts.name || null;
  const userLoc = userFacts.ciudad || userFacts.location || null;
  const userBiz = userFacts.negocio || userFacts.business || null;
  const greetingName = userName ? `, ${userName}` : '';
  const followUp = Array.isArray(history) && history.length > 0;   // ya hubo conversación: no se vuelve a saludar
  const {
    isAutoPilot = false,
    pilotPersona = 'as_assistant',
    ownerName = 'el titular',
    products = [],
    knowledge = [],
    businessHours = null
  } = options;

  // 1. Base de conocimiento del bot (FAQs configuradas)
  if (Array.isArray(knowledge) && knowledge.length > 0) {
    const queryWords = pNorm.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
    if (queryWords.length > 0) {
      let bestKb = null;
      let bestScore = 0;
      for (const kb of knowledge) {
        const hay = `${kb.title || ''} ${kb.content || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let score = 0;
        for (const w of queryWords) {
          if (hay.includes(w)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestKb = kb;
        }
      }
      if (bestKb && bestScore >= 1) {
        return `*${bestKb.title}*\n${bestKb.content}`;
      }
    }
  }

  // 2. Productos, servicios, precios o cotizaciones (usa el catálogo real si existe)
  if (/(precio|precios|costo|cuanto vale|cuanto cuesta|catalogo|planes|tarifas|servicios|productos|que ofrecen|que venden|cotizar|cotizacion)/i.test(pNorm)) {
    if (Array.isArray(products) && products.length > 0) {
      const list = products.slice(0, 8).map(pr =>
        `• *${pr.name}*: ${pr.price} ${pr.currency || 'USD'}${pr.description ? ` — ${pr.description}` : ''}`
      ).join('\n');
      return `Claro${greetingName}, estas son nuestras opciones:\n\n${list}\n\n¿Cuál te interesa?`;
    }
    if (isAutoPilot && pilotPersona === 'as_assistant') {
      return `Con gusto${greetingName}. ¿Qué producto o servicio quieres cotizar? Le paso el detalle a *${ownerName}* para darte el valor exacto.`;
    }
    return `Con gusto${greetingName}. ¿Qué servicio estás buscando? Así te oriento mejor.`;
  }

  // 3. Horarios de atención
  if (/(horario|horarios|a que hora|cuando abren|cuando atienden|dias de atencion|estan abiertos)/i.test(pNorm)) {
    if (businessHours && businessHours.enabled) {
      const days = Array.isArray(businessHours.days)
        ? businessHours.days.map(d => DAY_NAMES[d]).filter(Boolean).join(', ')
        : 'Lunes a Viernes';
      return `Atendemos *${days}*, de *${businessHours.startTime || '09:00'}* a *${businessHours.endTime || '18:00'}*. Puedes dejar tu consulta por aquí a cualquier hora y te respondemos.`;
    }
    return 'Puedes escribirnos por aquí a cualquier hora. ¿Qué día y hora te queda mejor para atenderte?';
  }

  // 4. Cálculos y porcentajes en lenguaje natural
  const pctMatch = pNorm.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de|del)\s*(\d+(?:[.,]\d+)?)/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1].replace(',', '.'));
    const base = parseFloat(pctMatch[2].replace(',', '.'));
    if (Number.isFinite(pct) && Number.isFinite(base)) {
      const val = (pct / 100) * base;
      return `El *${pct}%* de *${base.toLocaleString('es-CO')}* es *${val.toLocaleString('es-CO', { maximumFractionDigits: 4 })}*.`;
    }
  }

  const mathExprMatch = pNorm.match(/(?:cuanto es|calcula|resultado de)\s+([0-9+\-*/().,\s]+)$/);
  if (mathExprMatch) {
    try {
      const sanitized = mathExprMatch[1].replace(/,/g, '.').trim();
      if (/^[0-9+\-*/().\s]+$/.test(sanitized)) {
        const res = Function(`"use strict"; return (${sanitized})`)();
        if (typeof res === 'number' && Number.isFinite(res)) {
          return `El resultado de \`${sanitized}\` es *${res.toLocaleString('es-CO', { maximumFractionDigits: 6 })}*.`;
        }
      }
    } catch { /* ignorar */ }
  }

  // 5. Problemas, reclamos o inconvenientes
  if (/(no funciona|tengo un problema|error|falla|reclamo|queja|demora|no me llego|ayuda urgente|inconveniente)/i.test(pNorm)) {
    if (isAutoPilot && pilotPersona === 'as_assistant') {
      return `Lamento el inconveniente${greetingName}. Ya dejé tu caso como prioridad para *${ownerName}*. ¿Me cuentas qué pasó exactamente para adelantarlo?`;
    }
    return `Entiendo${greetingName}, vamos a resolverlo. ¿Qué pasó y qué error te aparece?`;
  }

  // 6. Modo asesor / ayudante personal en privado
  if (isAutoPilot) {
    if (pilotPersona === 'as_assistant') {
      if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|como estas|como te va|saludos)\b/i.test(pNorm)) {
        return followUp
          ? `Aquí sigo${greetingName}. ¿En qué te ayudo?`
          : `¡Hola${greetingName}! Soy el asistente de *${ownerName}*, que no puede responder en este momento. ¿En qué te ayudo?`;
      }
      if (/(estas ahi|se encuentra|esta disponible|puedes hablar|ocupado|libre|llamar|llamada)/i.test(pNorm)) {
        return `*${ownerName}* está ocupado en este momento, pero yo puedo ayudarte. ¿Qué necesitas?`;
      }
      if (/(gracias|muchas gracias|perfecto|listo|vale|ok|dale|entendido|excelente)\b/i.test(pNorm) && pNorm.length < 40) {
        return `¡Con gusto${greetingName}! Aquí estoy si necesitas algo más.`;
      }
      if (/(adios|chao|hasta luego|nos vemos|feliz noche|feliz tarde|feliz dia)\b/i.test(pNorm)) {
        return `¡Hasta pronto${greetingName}! Le dejo todo anotado a *${ownerName}*.`;
      }
      return `Anotado${greetingName}, se lo paso a *${ownerName}*. ¿Quieres agregar algo más?`;
    }

    return `¡Hola${greetingName}! Ando ocupado en este momento. Déjame tu mensaje y apenas pueda te respondo.`;
  }

  // 7. Memoria sobre el propio usuario
  if (/(como me llamo|cual es mi nombre|sabes mi nombre|te acuerdas de mi nombre)/i.test(pNorm)) {
    return userName
      ? `Te llamas *${userName}*${userBiz ? ` y tienes un negocio de *${userBiz}*` : ''}.`
      : 'Aún no me has dicho tu nombre. ¿Cómo te llamas?';
  }

  if (/(cual es mi negocio|mi empresa|a que me dedico)/i.test(pNorm)) {
    return userBiz
      ? `Me contaste que tu negocio es *${userBiz}*. ¿En qué te apoyo con eso?`
      : 'Todavía no me has contado a qué se dedica tu negocio. ¿Me cuentas?';
  }

  if (/(donde vivo|de donde soy|en que ciudad estoy)/i.test(pNorm)) {
    return userLoc
      ? `Me dijiste que nos escribes desde *${userLoc}*.`
      : 'Aún no me has dicho desde qué ciudad nos escribes.';
  }

  // 8. Saludos, identidad, agradecimientos y despedidas
  if (/^(?:etho\s+)?(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|como estas|como te va|saludos)\b/i.test(pNorm)) {
    return followUp ? `Aquí sigo${greetingName}. ¿En qué te ayudo?` : `¡Hola${greetingName}! ¿En qué te puedo ayudar?`;
  }

  if (/(quien eres|como te llamas|que eres|presentate)/i.test(pNorm)) {
    return `Soy *${botName}*, tu asistente virtual. Cuéntame qué necesitas.`;
  }

  if (/(gracias|muchas gracias|te lo agradezco|muy amable|mil gracias)/i.test(pNorm)) {
    return `¡Con gusto${greetingName}! Si necesitas algo más, aquí estoy.`;
  }

  if (/(adios|chao|hasta luego|nos vemos|bye|hasta pronto)/i.test(pNorm)) {
    return `¡Hasta pronto${greetingName}! Cuando quieras, aquí estaré.`;
  }

  // 9. El usuario se presenta
  if (/(me llamo|mi nombre es)/i.test(pNorm) && userName) {
    return `¡Mucho gusto, *${userName}*!${userBiz ? ` Qué bueno lo de *${userBiz}*.` : ''}${userLoc ? ` Saludos hasta *${userLoc}*.` : ''} ¿En qué te ayudo?`;
  }

  // 10. Respuesta abierta (sin repetir el mensaje del usuario)
  return `No tengo ese dato confirmado${greetingName}. ¿Puedes darme un poco más de detalle para ayudarte mejor?`;
}

// Compatibilidad directa
export const askEtho = (prompt, history = []) => askAI(prompt, null, 'recreational', { history });
