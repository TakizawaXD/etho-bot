import axios from 'axios';
import { jidNum } from '../lib/utils.js';
import { bumpInteraction } from '../db.js';
import { searchAnime, searchCharacter } from '../lib/anilist.js';

// [nombre, alias, proveedor (n = nekos.best, w = waifu.pics, null = solo texto), endpoint, con objetivo, sin objetivo]
const R = [
  ['angry', ['enojado'], null, null, 'esta enojado/a con', 'esta enojado/a'],
  ['bath', [], null, null, 'se bano con', 'se esta banando'],
  ['bite', [], 'n', 'bite', 'mordio a', 'mordio el aire'],
  ['bleh', [], null, null, 'le saco la lengua a', 'saco la lengua'],
  ['blush', [], 'n', 'blush', 'se sonrojo por', 'se sonrojo'],
  ['bored', ['aburrido'], 'n', 'bored', 'esta aburrido/a de', 'esta aburrido/a'],
  ['call', [], null, null, 'llamo a', 'esta llamando a alguien'],
  ['clap', ['aplaudir'], 'n', 'highfive', 'aplaudio a', 'aplaude'],
  ['coffee', ['cafe'], null, null, 'tomo cafe con', 'toma cafe'],
  ['cold', [], null, null, 'tiene frio junto a', 'tiene frio'],
  ['cook', [], null, null, 'cocino algo rico con', 'esta cocinando'],
  ['cry', [], 'n', 'cry', 'lloro por', 'esta llorando'],
  ['cuddle', [], 'n', 'cuddle', 'se acurruco con', 'quiere acurrucarse'],
  ['dance', [], 'n', 'dance', 'bailo con', 'esta bailando'],
  ['dramatic', ['drama'], null, null, 'hizo un drama con', 'esta haciendo drama'],
  ['draw', [], null, null, 'dibujo junto a', 'esta dibujando'],
  ['drunk', [], null, null, 'esta borracho/a con', 'esta borracho/a'],
  ['eat', ['comer'], null, null, 'comio con', 'esta comiendo'],
  ['facepalm', [], 'n', 'facepalm', 'se dio una palmada en la cara por', 'se dio una palmada en la cara'],
  ['gaming', [], null, null, 'jugo videojuegos con', 'esta jugando videojuegos'],
  ['hang', ['colgarse'], null, null, 'se colgo de', 'se quiere colgar de alguien'],
  ['happy', ['feliz'], 'n', 'happy', 'esta feliz con', 'salta de felicidad'],
  ['heat', [], null, null, 'tiene calor junto a', 'tiene calor'],
  ['hug', [], 'n', 'hug', 'abrazo a', 'se abrazo a si mismo/a'],
  ['icecream', ['helado'], null, null, 'comio un helado con', 'come un helado'],
  ['impregnate', ['preg', 'prenar'], null, null, 'bromea sobre embarazar a', 'esta de broma'],
  ['jump', [], null, null, 'salto con', 'esta saltando'],
  ['kicked', ['patada'], 'n', 'kick', 'le dio una patada a', 'dio una patada al aire'],
  ['kill', [], 'w', 'kill', 'mato a', 'se quiere matar de la risa'],
  ['kiss', ['muak'], 'n', 'kiss', 'beso a', 'tira un beso'],
  ['kisscheek', ['beso'], 'n', 'kiss', 'beso en la mejilla a', 'tira un beso'],
  ['kisshead', ['besocabeza'], 'n', 'kiss', 'beso en la frente a', 'tira un beso'],
  ['laugh', [], 'n', 'laugh', 'se rio de', 'se rie'],
  ['lewd', [], null, null, 'hizo algo lascivo con', 'hizo algo lascivo'],
  ['lick', [], 'w', 'lick', 'lamio a', 'lamio el aire'],
  ['look', ['mirar'], null, null, 'miro fijamente a', 'mira fijamente'],
  ['love', ['amor'], null, null, 'esta enamorado/a de', 'se siente enamorado/a'],
  ['nope', [], 'n', 'nope', 'rechazo a', 'dijo que no'],
  ['pat', [], 'n', 'pat', 'acaricio a', 'quiere una caricia'],
  ['poke', [], 'n', 'poke', 'pico a', 'pica el aire'],
  ['pout', [], 'n', 'pout', 'hizo pucheros a', 'hace pucheros'],
  ['psycho', [], null, null, 'se hizo el psicopata con', 'se hizo el psicopata'],
  ['punch', [], 'n', 'punch', 'le dio un punetazo a', 'golpeo el aire'],
  ['push', [], null, null, 'empujo a', 'empujo al aire'],
  ['read', ['leer'], null, null, 'leyo un libro con', 'esta leyendo'],
  ['run', [], 'n', 'run', 'corrio con', 'sale corriendo'],
  ['sad', ['triste'], 'n', 'cry', 'esta triste por', 'esta triste'],
  ['scared', [], null, null, 'esta asustado/a de', 'esta asustado/a'],
  ['scream', [], null, null, 'le grito a', 'esta gritando'],
  ['scrub', ['fregar'], null, null, 'se puso a fregar con', 'se puso a fregar'],
  ['seduce', [], null, null, 'intento seducir a', 'esta intentando seducir'],
  ['shy', ['timido'], 'n', 'blush', 'se puso timido/a con', 'se siente timido/a'],
  ['sick', ['enfermo'], null, null, 'esta enfermo/a cerca de', 'esta enfermo/a'],
  ['sing', [], null, null, 'canto con', 'esta cantando'],
  ['slap', [], 'n', 'slap', 'abofeteo a', 'dio una bofetada al aire'],
  ['sleep', [], 'n', 'sleep', 'se durmio con', 'se tumbo a dormir'],
  ['smile', ['sonreir'], 'n', 'smile', 'le sonrio a', 'sonrie'],
  ['smug', [], 'n', 'smug', 'puso cara de suficiencia a', 'puso cara de suficiencia'],
  ['stare', [], 'n', 'stare', 'se quedo mirando a', 'se quedo mirando'],
  ['think', [], null, null, 'penso en', 'esta pensando'],
  ['thumbsup', [], 'n', 'thumbsup', 'le dio el visto bueno a', 'da el visto bueno'],
  ['tickle', [], 'n', 'tickle', 'le hizo cosquillas a', 'hace cosquillas al aire'],
  ['wave', ['hi', 'greet'], 'n', 'wave', 'saludo a', 'saluda a todos'],
  ['wink', [], 'n', 'wink', 'le guino el ojo a', 'guino el ojo'],
];

// Reacciones: solo texto, sin descargar ni convertir gifs (así responden al instante).
// Cada reacción entre dos personas distintas suma un contador persistente entre ambas.
const reactions = R.map(([name, aliases, , , withB, solo]) => ({
  name, aliases, desc: `Reaccion: ${solo}.`, usage: '<@mencion>',
  run: async (c) => {
    const hasTarget = c.target && c.target !== c.sender;
    let text = hasTarget
      ? `*@${jidNum(c.sender)}* ${withB} *@${jidNum(c.target)}*`
      : `*@${jidNum(c.sender)}* ${solo}`;
    const mentions = [c.sender, ...(hasTarget ? [c.target] : [])];
    if (hasTarget) {
      const n = bumpInteraction(name, c.sender, c.target);
      text += `\nLlevan ${n} en total.`;
    }
    await c.reply(text, mentions);
  },
}));

const randomImage = (name, aliases, ep, desc) => ({
  name, aliases, desc, usage: '',
  run: async (c) => {
    try {
      const { data } = await axios.get(`https://nekos.best/api/v2/${ep}`, { timeout: 15000 });
      const r = data.results?.[0];
      if (!r) throw new Error('sin resultados');
      await c.sock.sendMessage(c.chat, { image: { url: r.url }, caption: r.artist_name ? `Arte por ${r.artist_name}` : desc }, { quoted: c.msg });
    } catch (e) { console.error(`[anime:${name}]`, e.message); await c.reply('No se pudo obtener la imagen ahora mismo. Intenta de nuevo.'); }
  },
});

const extras = [
  randomImage('neko', [], 'neko', 'Una chica neko aleatoria.'),
  randomImage('waifu', [], 'waifu', 'Una waifu aleatoria.'),
  randomImage('husbando', [], 'husbando', 'Un husbando aleatorio.'),
  randomImage('kitsune', [], 'kitsune', 'Una kitsune aleatoria.'),
  { name: 'animeinfo', aliases: ['buscaranime'], desc: 'Busca un anime en AniList (titulo, sinopsis, imagen).', usage: '[nombre]',
    run: async (c) => {
      if (!c.text) return c.reply(`Uso: ${c.prefix}animeinfo Death Note`);
      const a = await searchAnime(c.text); if (!a) return c.reply('No encontre ese anime en AniList.');
      const caption = `${a.title}\nEstado: ${a.status} | Episodios: ${a.episodes ?? '?'} | Puntaje: ${a.score ?? '?'}\nGeneros: ${a.genres}\n\n${a.desc}\n\n${a.url}`;
      if (a.image) return c.sock.sendMessage(c.chat, { image: { url: a.image }, caption }, { quoted: c.msg });
      await c.reply(caption);
    } },
  { name: 'personaje', aliases: ['charsearch'], desc: 'Busca un personaje de anime en AniList.', usage: '[nombre]',
    run: async (c) => {
      if (!c.text) return c.reply(`Uso: ${c.prefix}personaje L Lawliet`);
      const ch = await searchCharacter(c.text); if (!ch) return c.reply('No encontre ese personaje en AniList.');
      const caption = `${ch.name}\n\n${ch.desc}\n\n${ch.url}`;
      if (ch.image) return c.sock.sendMessage(c.chat, { image: { url: ch.image }, caption }, { quoted: c.msg });
      await c.reply(caption);
    } },
];

export default [...reactions, ...extras];
