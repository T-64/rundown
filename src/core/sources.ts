// Material for the script: today's weather and recent headlines.
// Both sources are free and need no API key.

import { XMLParser } from 'fast-xml-parser';

export interface Weather {
	place: string;
	now: string;
	high: number;
	low: number;
	rainChance: number;
}

export interface Headline {
	source: string;
	title: string;
	link: string;
	summary: string;
	published?: string;
}

// WMO weather codes, as used by Open-Meteo
const CODES: Record<number, string> = {
	0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
	45: 'fog', 48: 'freezing fog',
	51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
	61: 'light rain', 63: 'rain', 65: 'heavy rain',
	66: 'freezing rain', 67: 'heavy freezing rain',
	71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
	80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
	85: 'snow showers', 86: 'heavy snow showers',
	95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

async function getJson(url: string) {
	const res = await fetch(url, { headers: { 'user-agent': 'pi-rundown' } });
	if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
	return res.json();
}

export async function weather(city: string): Promise<Weather> {
	const geo = await getJson(
		`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`,
	);
	const place = geo.results?.[0];
	if (!place) throw new Error(`Couldn't find a place called "${city}"`);
	const f = await getJson(
		`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
			'&current=temperature_2m,weather_code' +
			'&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
			'&timezone=auto&forecast_days=1',
	);
	return {
		place: `${place.name}, ${place.country}`,
		now: `${Math.round(f.current.temperature_2m)}°C, ${CODES[f.current.weather_code] ?? 'unknown'}`,
		high: Math.round(f.daily.temperature_2m_max[0]),
		low: Math.round(f.daily.temperature_2m_min[0]),
		rainChance: f.daily.precipitation_probability_max[0] ?? 0,
	};
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

const text = (v: unknown): string => {
	if (v == null) return '';
	if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
	return String(v);
};

const plain = (html: string) =>
	html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export async function headlines(feeds: string[], perFeed = 6): Promise<Headline[]> {
	const results = await Promise.allSettled(
		feeds.map(async (url) => {
			const res = await fetch(url, { headers: { 'user-agent': 'pi-rundown' } });
			if (!res.ok) throw new Error(`${res.status} from ${url}`);
			const doc = xml.parse(await res.text());
			// RSS 2.0 or Atom
			const channel = doc.rss?.channel;
			const source = text(channel?.title ?? doc.feed?.title) || new URL(url).host;
			const items = [channel?.item ?? doc.feed?.entry ?? []].flat().slice(0, perFeed);
			return items.map((it: Record<string, any>) => ({
				source,
				title: plain(text(it.title)),
				link: typeof it.link === 'object' ? (it.link.href ?? [it.link].flat()[0]?.href ?? '') : text(it.link),
				summary: plain(text(it.description ?? it.summary ?? it.content)).slice(0, 300),
				published: text(it.pubDate ?? it.published ?? it.updated) || undefined,
			}));
		}),
	);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
