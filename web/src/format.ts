import type { Lang } from './i18n';

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatDate(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Player face from mc-heads.net; offline-mode accounts just get the default skin. */
export const avatarUrl = (uuid: string, size = 32) => `https://mc-heads.net/avatar/${uuid}/${size}`;
