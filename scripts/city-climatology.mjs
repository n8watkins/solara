#!/usr/bin/env node
// Builds lib/cities/uv-climatology.json, the typical UV by month that the city
// pages (app/uv/[city]/) show. Run by hand when the city list changes; the build
// only reads the checked-in result, so it needs no network and no API key.
//
// Source: hourly UV index (with clouds) and clear-sky UV index from the CAMS global
// atmospheric composition model, served by the Open-Meteo Air Quality API
// (https://open-meteo.com/en/docs/air-quality-api, CC BY 4.0), for the whole years
// YEARS below. Hours are requested in UTC and turned into each city's local time
// here: the API's `timezone=auto` applies one fixed offset to the whole range, so
// summer and winter hours would be an hour apart.
//
// For each city and month it stores, averaged over every day of that month:
//   peak     - the day's highest UV index (with clouds)
//   clearSky - the day's highest clear-sky UV index
//   hours3   - hours with a UV index of 3 or more (a value of 2.5 or more)
// and, on the days that reach UV 3: the median first and last such hour.
//
// Usage: node scripts/city-climatology.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const CITIES = 'lib/cities/cities.json'
const OUT = 'lib/cities/uv-climatology.json'
const YEARS = [2023, 2024, 2025]
const API = 'https://air-quality-api.open-meteo.com/v1/air-quality'
/** A UV index of 3 (Moderate) or more on the whole-number scale. */
const MODERATE = 2.5

const round1 = n => Math.round(n * 10) / 10
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function fetchCity({ lat, lon }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'uv_index,uv_index_clear_sky',
    start_date: `${YEARS[0]}-01-01`,
    end_date: `${YEARS.at(-1)}-12-31`,
    timezone: 'GMT',
  })
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${API}?${params}`)
    if (response.ok) return response.json()
    if (attempt === 3) throw new Error(`HTTP ${response.status} for ${lat},${lon}`)
    await new Promise(resolve => setTimeout(resolve, 5000 * attempt))
  }
}

/** "2025-07-10T12:00" in UTC as the local date and hour in `timeZone`. */
function localHour(utc, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(`${utc}:00Z`))
  const part = type => parts.find(p => p.type === type).value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) }
}

function climatology(data, timeZone) {
  const { time, uv_index: uv, uv_index_clear_sky: clear } = data.hourly
  const days = new Map()
  time.forEach((t, i) => {
    if (typeof uv[i] !== 'number' || typeof clear[i] !== 'number') return
    const { date, hour } = localHour(t, timeZone)
    if (!days.has(date)) days.set(date, [])
    days.get(date).push({ hour, uv: uv[i], clear: clear[i] })
  })
  const months = Array.from({ length: 12 }, () => [])
  for (const [date, hours] of days) {
    // A whole local day (23 or 25 hours on a clock change); the range's edges are partial.
    if (hours.length < 23) continue
    const moderate = hours.filter(h => h.uv >= MODERATE)
    months[Number(date.slice(5, 7)) - 1].push({
      peak: Math.max(...hours.map(h => h.uv)),
      clearSky: Math.max(...hours.map(h => h.clear)),
      hours3: moderate.length,
      from: moderate[0]?.hour ?? null,
      to: moderate.length ? moderate.at(-1).hour + 1 : null,
    })
  }
  return months.map(month => {
    const reach = month.filter(d => d.from !== null)
    // Hours of UV 3+ only when most days of the month reach it.
    const typical = reach.length * 2 > month.length
    return {
      peak: round1(mean(month.map(d => d.peak))),
      clearSky: round1(mean(month.map(d => d.clearSky))),
      hours3: round1(mean(month.map(d => d.hours3))),
      from: typical ? Math.round(median(reach.map(d => d.from))) : null,
      to: typical ? Math.round(median(reach.map(d => d.to))) : null,
      days: month.length,
    }
  })
}

const cities = JSON.parse(readFileSync(CITIES, 'utf8'))
const out = {
  source:
    'CAMS global atmospheric composition model via the Open-Meteo Air Quality API (CC BY 4.0)',
  years: YEARS,
  cities: {},
}
for (const city of cities) {
  const data = await fetchCity(city)
  out.cities[city.slug] = { elevation: data.elevation, months: climatology(data, city.timezone) }
  console.log(`${city.slug}: done`)
  await new Promise(resolve => setTimeout(resolve, 1000))
}
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
console.log(`Wrote ${OUT} for ${cities.length} cities.`)
