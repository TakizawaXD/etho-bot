// Cliente ligero de la API pública de AniList (GraphQL, sin API key).
import axios from 'axios';

const EP = 'https://graphql.anilist.co';

function cleanDesc(s, max = 500) {
  if (!s) return 'Sin descripción disponible.';
  const t = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/~![\s\S]*?!~/g, '[contenido oculto]').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export async function searchAnime(q) {
  const query = `query($s:String){ Media(search:$s, type:ANIME){
    title{romaji english} description(asHtml:false) episodes status averageScore genres
    coverImage{large} siteUrl }}`;
  const { data } = await axios.post(EP, { query, variables: { s: q } }, { timeout: 15000 });
  const m = data?.data?.Media; if (!m) return null;
  return {
    title: m.title.english || m.title.romaji,
    desc: cleanDesc(m.description),
    episodes: m.episodes, status: m.status, score: m.averageScore,
    genres: (m.genres || []).join(', '), image: m.coverImage?.large, url: m.siteUrl,
  };
}

export async function searchCharacter(q) {
  const query = `query($s:String){ Character(search:$s){
    name{full} description(asHtml:false) image{large} siteUrl }}`;
  const { data } = await axios.post(EP, { query, variables: { s: q } }, { timeout: 15000 });
  const c = data?.data?.Character; if (!c) return null;
  return { name: c.name.full, desc: cleanDesc(c.description, 400), image: c.image?.large, url: c.siteUrl };
}
