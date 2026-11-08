// Motor de Inteligencia Artificial Avanzado de Atención a Usuarios, Asesoría y Resolución Directa.
// Entregando únicamente respuestas limpias, precisas y empáticas (CERO recomendaciones de comandos).
import axios from 'axios';
import 'dotenv/config';
import { SEP_DOT } from './ui.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
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

const USER_ATTENTION_PROTOCOL = [
  `[Protocolo Maestro de Atención al Usuario]:`,
  `1. SOLO RESPUESTAS DIRECTAS (PROHIBIDO RECOMENDAR COMANDOS): Responde directamente a lo que el usuario pregunta o necesita. NUNCA agregues listas de comandos del bot (ej. #menu, #sticker, #clima), ni bloques de "Comandos recomendados", ni sugerencias de funciones no pedidas.`,
  `2. COMPRENSIÓN Y RESOLUCIÓN REAL: Identifica la intención exacta detrás del mensaje (consulta, soporte, cotización, urgencia, reclamo, tarea o conversación). Da una respuesta útil, completa y accionable desde el primer mensaje.`,
  `3. EMPATÍA Y CALIDAD DE SERVICIO: Si el usuario tiene una duda compleja, urgencia o inconveniente, muestra empatía genuina primero y luego entrega la solución clara paso a paso.`,
  `4. FORMATO ÓPTIMO PARA WHATSAPP: Usa párrafos cortos y legibles en celular, negritas (*texto*) solo para resaltar datos importantes y viñetas breves únicamente cuando enumeres pasos o características reales.`,
  `5. VERACIDAD ESTRICTA: Si cuentas con datos del catálogo, precios, horarios o base de conocimiento en este contexto, úsalos con exactitud. Nunca inventes precios, políticas ni promesas falsas; si falta un dato comercial específico, indícalo con transparencia y ofrece tomar los datos del usuario.`,
  `6. CONTINUIDAD DE MEMORIA: Ten siempre presente lo hablado en los mensajes anteriores y los datos conocidos del usuario (nombre, negocio, ciudad o interés) sin pedirle repetir información que ya dio.`,
  `7. CERO RELLENO INFANTIL: Prohibido hacer maullidos, decir 'nya', 'uwu' o usar lenguaje infantil.`
].join('\n');

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
  const effectivePrompt = unknownCommand && prompt.trim().startsWith(prefix)
    ? (prompt.trim().slice(prefix.length).trim() || prompt.trim())
    : prompt.trim();

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
    `- Usa emojis sobrios y puntuales solo cuando aporten calidez o claridad visual (sin saturar).`
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

  const fullSystemPrompt = [
    baseSystem + identityLine,
    operationalContext,
    factsContext,
    '',
    USER_ATTENTION_PROTOCOL,
    styleDirectives.join('\n')
  ].filter(Boolean).join('\n');

  // 1. Proveedor Principal: Google Gemini (si GEMINI_API_KEY está activa)
  if (GEMINI_KEY) {
    for (const modelName of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`;
        const contents = [];
        for (const turn of history.slice(-10)) {
          if (!turn?.content) continue;
          contents.push({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(turn.content) }]
          });
        }
        contents.push({ role: 'user', parts: [{ text: effectivePrompt }] });

        const res = await axios.post(url, {
          system_instruction: { parts: [{ text: fullSystemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.55 }
        }, { timeout: 12000 });

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim()) {
          return finalizeReply(cleanResponseText(text.trim(), forbiddenList));
        }
      } catch {
        // Intentar siguiente modelo/proveedor
      }
    }
  }

  // 2. Proveedor Neuronal OpenAI-Compatible (Pollinations Chat Completions con historial completo)
  const chatMessages = [
    { role: 'system', content: fullSystemPrompt },
    ...history.slice(-8).filter(h => h?.content).map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content).replace(/\n┄+[\s\S]*$/m, '').trim()
    })),
    { role: 'user', content: effectivePrompt }
  ];

  for (const endpoint of ['https://text.pollinations.ai/openai', 'https://text.pollinations.ai/']) {
    try {
      const res = await axios.post(endpoint, {
        model: 'openai',
        messages: chatMessages,
        temperature: 0.55,
        private: true
      }, {
        timeout: 11000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'EthoBot-VIP/2.5' }
      });

      const rawText = typeof res.data === 'string'
        ? res.data
        : (res.data?.choices?.[0]?.message?.content || '');
      if (rawText && rawText.trim()) {
        const cleaned = cleanResponseText(rawText.trim(), forbiddenList);
        if (cleaned.length > 2) {
          return finalizeReply(cleaned);
        }
      }
    } catch {
      // Continuar al respaldo
    }
  }

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
    // Convertir negritas Markdown (**texto**) a formato nativo de WhatsApp (*texto*)
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/\b(nya~?|purr|mrrp|meow|nekotina|uwu|onii-chan|senpai|kawaii|yamete)\b/gi, '');

  if (Array.isArray(forbiddenWords)) {
    for (const w of forbiddenWords) {
      if (!w || !w.trim()) continue;
      const re = new RegExp(`\\b${w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      cleaned = cleaned.replace(re, '***');
    }
  }

  return cleaned.trim();
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
  const {
    isAutoPilot = false,
    pilotPersona = 'as_assistant',
    ownerName = 'el titular',
    products = [],
    knowledge = [],
    businessHours = null
  } = options;

  // 1. Búsqueda directa en Base de Conocimiento del Bot (FAQs configuradas)
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
        return `📌 *${bestKb.title}*\n${bestKb.content}`;
      }
    }
  }

  // 2. Consultas sobre Productos, Servicios, Precios o Cotizaciones (usa catálogo real si existe)
  if (/(precio|precios|costo|cuanto vale|cuanto cuesta|catalogo|planes|tarifas|servicios|productos|que ofrecen|que venden|cotizar|cotizacion)/i.test(pNorm)) {
    if (Array.isArray(products) && products.length > 0) {
      const list = products.slice(0, 8).map(pr =>
        `• *${pr.name}*: ${pr.price} ${pr.currency || 'USD'}${pr.description ? ` — ${pr.description}` : ''}`
      ).join('\n');
      return `💼 Con gusto${greetingName}, aquí tienes nuestras opciones disponibles actualmente:\n\n${list}\n\n¿Sobre cuál de estas opciones te gustaría recibir más detalles?`;
    }
    if (isAutoPilot && pilotPersona === 'as_assistant') {
      return `💼 Con todo gusto${greetingName}. Cuéntame exactamente qué producto, servicio o requerimiento deseas cotizar para dejarle el detalle completo a *${ownerName}* y darte el valor exacto.`;
    }
    return `💼 Con gusto te brindo información${greetingName}. Indícame por favor qué servicio o requerimiento específico estás buscando para darte una orientación precisa.`;
  }

  // 3. Consultas sobre Horarios de Atención
  if (/(horario|horarios|a que hora|cuando abren|cuando atienden|dias de atencion|estan abiertos)/i.test(pNorm)) {
    if (businessHours && businessHours.enabled) {
      const days = Array.isArray(businessHours.days)
        ? businessHours.days.map(d => DAY_NAMES[d]).filter(Boolean).join(', ')
        : 'Lunes a Viernes';
      return `🕒 Nuestro horario de atención personalizada es de *${days}*, de *${businessHours.startTime || '09:00'}* a *${businessHours.endTime || '18:00'}*. Por este canal de WhatsApp puedes dejarnos tu consulta en cualquier momento.`;
    }
    return `🕒 Por este canal de WhatsApp recibimos y atendemos tus consultas las 24 horas. Si necesitas coordinar una atención específica, indícame qué día y hora te queda mejor.`;
  }

  // 4. Cálculos matemáticos o porcentajes rápidos en lenguaje natural
  const pctMatch = pNorm.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de|del)\s*(\d+(?:[.,]\d+)?)/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1].replace(',', '.'));
    const base = parseFloat(pctMatch[2].replace(',', '.'));
    if (Number.isFinite(pct) && Number.isFinite(base)) {
      const val = (pct / 100) * base;
      return `🧮 El *${pct}%* de *${base.toLocaleString('es-CO')}* es *${val.toLocaleString('es-CO', { maximumFractionDigits: 4 })}*.`;
    }
  }

  const mathExprMatch = pNorm.match(/(?:cuanto es|calcula|resultado de)\s+([0-9+\-*/().,\s]+)$/);
  if (mathExprMatch) {
    try {
      const sanitized = mathExprMatch[1].replace(/,/g, '.').trim();
      if (/^[0-9+\-*/().\s]+$/.test(sanitized)) {
        const res = Function(`"use strict"; return (${sanitized})`)();
        if (typeof res === 'number' && Number.isFinite(res)) {
          return `🧮 El resultado de \`${sanitized}\` es *${res.toLocaleString('es-CO', { maximumFractionDigits: 6 })}*.`;
        }
      }
    } catch { /* ignorar */ }
  }

  // 5. Soporte ante Problemas, Reclamos o Inconvenientes
  if (/(no funciona|tengo un problema|error|falla|reclamo|queja|demora|no me llego|ayuda urgente|inconveniente)/i.test(pNorm)) {
    if (isAutoPilot && pilotPersona === 'as_assistant') {
      return `🤝 Lamento el inconveniente${greetingName} y entiendo la importancia de resolverlo pronto. Ya marqué tu caso con prioridad para *${ownerName}*. Por favor indícame en un mensaje qué ocurrió exactamente para adelantarlo de inmediato.`;
    }
    return `🤝 Entiendo perfectamente la situación${greetingName} y con gusto te ayudo a resolverla. Cuéntame paso a paso qué ocurrió o qué error te aparece para darte la solución exacta.`;
  }

  // 6. Modo Asesor / Ayudante Personal en Privado (conversación continua)
  if (isAutoPilot) {
    if (pilotPersona === 'as_assistant') {
      if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|como estas|como te va|saludos)\b/i.test(pNorm)) {
        return `👋 ¡Hola${greetingName}! Soy el asesor y ayudante personal de *${ownerName}*. En este momento no puede tomar el mensaje directamente, así que estoy aquí para atenderte con todo gusto. ¿En qué te puedo colaborar hoy?`;
      }
      if (/(estas ahi|se encuentra|esta disponible|puedes hablar|ocupado|libre|llamar|llamada)/i.test(pNorm)) {
        return `📌 En este momento *${ownerName}* se encuentra atendiendo unos compromisos, pero estoy activo como su ayudante personal para asistirte. Cuéntame qué necesitas y lo gestionamos enseguida.`;
      }
      if (/(gracias|muchas gracias|perfecto|listo|vale|ok|dale|entendido|excelente)\b/i.test(pNorm) && pNorm.length < 40) {
        return `🤝 ¡Con mucho gusto${greetingName}! Quedo atento por aquí por si necesitas agregar o consultar algo más.`;
      }
      if (/(adios|chao|hasta luego|nos vemos|feliz noche|feliz tarde|feliz dia)\b/i.test(pNorm)) {
        return `👋 ¡Que tengas un excelente resto de día${greetingName}! Todo lo conversado queda debidamente registrado para *${ownerName}*.`;
      }
      return `📝 Entendido${greetingName}. He tomado nota detallada de tu mensaje para *${ownerName}*. ¿Deseas agregar algún dato adicional o tienes alguna consulta puntual que pueda resolverte ahora mismo?`;
    }

    return `¡Hola${greetingName}! En este momento ando ocupado atendiendo unas gestiones, pero déjame los detalles por aquí y en cuanto me desocupe te respondo con calma.`;
  }

  // 7. Memoria sobre el propio usuario
  if (/(como me llamo|cual es mi nombre|sabes mi nombre|te acuerdas de mi nombre)/i.test(pNorm)) {
    return userName
      ? `Te llamas *${userName}*${userBiz ? ` y me comentaste sobre tu negocio de *${userBiz}*` : ''}. Lo tengo muy presente.`
      : 'Aún no me has indicado tu nombre. ¿Cómo te llamas para dirigirme a ti como prefieras?';
  }

  if (/(cual es mi negocio|mi empresa|a que me dedico)/i.test(pNorm)) {
    return userBiz
      ? `Me comentaste que tu negocio o actividad es *${userBiz}*. ¿Cómo te puedo apoyar hoy con eso?`
      : 'Todavía no me has comentado a qué se dedica tu negocio o proyecto. Cuéntame y te apoyo.';
  }

  if (/(donde vivo|de donde soy|en que ciudad estoy)/i.test(pNorm)) {
    return userLoc
      ? `Me indicaste que nos escribes desde *${userLoc}*.`
      : 'Aún no me has comentado desde qué ciudad nos escribes.';
  }

  // 8. Saludos, identidad, agradecimientos y despedidas generales
  if (/^(?:etho\s+)?(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|como estas|como te va|saludos)\b/i.test(pNorm)) {
    return `👋 ¡Hola${greetingName}! Todo excelente por aquí, listo para atenderte. ¿En qué te puedo ayudar hoy?`;
  }

  if (/(quien eres|como te llamas|que eres|presentate)/i.test(pNorm)) {
    return `Soy *${botName}*, tu asistente virtual inteligente especializado en brindarte respuestas claras, soporte ágil y atención personalizada en todo lo que necesites.`;
  }

  if (/(gracias|muchas gracias|te lo agradezco|muy amable|mil gracias)/i.test(pNorm)) {
    return `🤝 ¡Con todo gusto${greetingName}! Estoy a tu disposición siempre que necesites resolver otra consulta.`;
  }

  if (/(adios|chao|hasta luego|nos vemos|bye|hasta pronto)/i.test(pNorm)) {
    return `👋 ¡Hasta pronto${greetingName}! Que tengas un excelente día.`;
  }

  // 9. Presentación del usuario
  if (/(me llamo|mi nombre es)/i.test(pNorm) && userName) {
    return `🤝 ¡Mucho gusto, *${userName}*!${userBiz ? ` Qué excelente lo de *${userBiz}*.` : ''}${userLoc ? ` Un saludo cordial hasta *${userLoc}*.` : ''} Cuéntame, ¿en qué te puedo ayudar hoy?`;
  }

  // 10. Respuesta ejecutiva abierta
  return `Entendido${greetingName}. Analicé tu consulta sobre *"${prompt}"*: para darte la respuesta más exacta posible, indícame por favor cualquier detalle específico o condición que quieras que tome en cuenta y lo resolvemos enseguida.`;
}

// Compatibilidad directa
export const askEtho = (prompt, history = []) => askAI(prompt, null, 'recreational', { history });
