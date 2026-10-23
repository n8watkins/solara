import type { WeatherResponse } from './types'

const CACHE_KEY = 'solara_weather'
const TTL = 60 * 60 * 1000

interface Cache {
  data: WeatherResponse
  lat: number
  lon: number
  ts: number
}

export function getCachedWeather(lat: number, lon: number): WeatherResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c: Cache = JSON.parse(raw)
    const fresh = Date.now() - c.ts < TTL
    const sameLocation = Math.abs(c.lat - lat) < 0.01 && Math.abs(c.lon - lon) < 0.01
    return fresh && sameLocation ? c.data : null
  } catch {
    return null
  }
}

export function setCachedWeather(lat: number, lon: number, data: WeatherResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, lat, lon, ts: Date.now() }))
  } catch {}
}

export function clearWeatherCache(): void {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}
