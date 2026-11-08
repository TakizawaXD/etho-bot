// Entrada Serverless para despliegues en Vercel
import { app } from '../src/server.js';

export default function handler(req, res) {
  try {
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Serverless Error]:', err);
    if (!res.headersSent) {
      res.status(200).json({
        ok: false,
        error: err.message || 'Internal Serverless Error',
        vercel: true
      });
    }
  }
}
