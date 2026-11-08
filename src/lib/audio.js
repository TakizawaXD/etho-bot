import * as baileys from '@whiskeysockets/baileys';
import axios from 'axios';
import pino from 'pino';
import 'dotenv/config';

const { downloadMediaMessage } = baileys;
const logger = pino({ level: 'silent' });

/**
 * Procesa mensajes de audio y notas de voz (PTT) de WhatsApp
 * Transcribe el mensaje usando Gemini 1.5 Flash o Whisper en Hugging Face
 */
export async function processIncomingAudio(msg, content) {
  const audioInfo = content.audioMessage;
  if (!audioInfo) return null;

  const seconds = audioInfo.seconds || 0;
  const mimetype = audioInfo.mimetype || 'audio/ogg; codecs=opus';
  const cleanMime = mimetype.split(';')[0].trim();

  let buffer = null;
  try {
    buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
  } catch (err) {
    console.warn('[Audio] Error al descargar nota de voz:', err.message);
    return {
      success: false,
      seconds,
      text: null,
      error: 'download_failed'
    };
  }

  if (!buffer || buffer.length === 0) {
    return {
      success: false,
      seconds,
      text: null,
      error: 'empty_buffer'
    };
  }

  let transcribedText = null;

  // 1. Intentar con Google Gemini 1.5 Flash (Soporte nativo de audio multimodal)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await axios.post(url, {
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: cleanMime || 'audio/ogg',
                data: buffer.toString('base64')
              }
            },
            {
              text: 'Transcribe exactamente en español las palabras habladas en esta nota de voz de WhatsApp. Solo devuelve el texto transcrito de forma limpia, sin introducciones, sin aclaraciones y sin comillas.'
            }
          ]
        }],
        generationConfig: { maxOutputTokens: 250, temperature: 0.1 }
      }, { timeout: 15000 });

      const gText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (gText && gText.length > 1) {
        transcribedText = gText;
      }
    } catch (e) {
      console.warn('[Audio] Gemini audio falló:', e.message);
    }
  }

  // 2. Intentar con Hugging Face Whisper API si Gemini no está o falló
  if (!transcribedText && process.env.HF_TOKEN) {
    try {
      const hfRes = await axios.post(
        'https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo',
        buffer,
        {
          headers: {
            'Authorization': `Bearer ${process.env.HF_TOKEN}`,
            'Content-Type': cleanMime || 'audio/ogg'
          },
          timeout: 18000
        }
      );

      const hfText = hfRes.data?.text?.trim();
      if (hfText && hfText.length > 1) {
        transcribedText = hfText;
      }
    } catch (e) {
      console.warn('[Audio] Hugging Face Whisper falló:', e.message);
    }
  }

  return {
    success: true,
    seconds,
    text: transcribedText,
    isAudio: true,
    mimetype: cleanMime
  };
}

