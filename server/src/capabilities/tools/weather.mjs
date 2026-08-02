export const WEATHER_TOOL_NAME = 'weather'

const TOOL_DEFINITION = {
  type: 'function',
  function: {
    name: WEATHER_TOOL_NAME,
    description: '查询某地当前天气与短时预报。用户问天气、气温、是否下雨时调用；用口语简述，不要朗读原始 JSON。',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: '城市或地名，例如「北京」「上海」「San Francisco」。',
        },
        days: {
          type: 'integer',
          description: '预报天数，默认 1（今天），最大 3。',
        },
      },
      required: ['location'],
      additionalProperties: false,
    },
  },
}

const WMO = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '有雾',
  51: '小毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  95: '雷阵雨',
}

function weatherLabel(code) {
  return WMO[Number(code)] || '天气变化'
}

export async function geocodeLocation(location, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const name = String(location || '').trim()
  if (!name) return null
  const url = (
    'https://geocoding-api.open-meteo.com/v1/search'
    + `?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`
  )
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error(`geocode HTTP ${response.status}`)
  const payload = await response.json()
  const hit = payload.results?.[0]
  if (!hit) return null
  return {
    name: hit.name,
    country: hit.country || '',
    admin1: hit.admin1 || '',
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone || 'auto',
  }
}

export async function fetchForecast(place, {
  days = 1,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const capped = Math.min(3, Math.max(1, Number(days) || 1))
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(place.latitude))
  url.searchParams.set('longitude', String(place.longitude))
  url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m')
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min')
  url.searchParams.set('timezone', place.timezone || 'auto')
  url.searchParams.set('forecast_days', String(capped))
  const response = await fetchImpl(url, { signal })
  if (!response.ok) throw new Error(`forecast HTTP ${response.status}`)
  return response.json()
}

export function summarizeWeather(place, forecast) {
  const current = forecast.current || {}
  const daily = forecast.daily || {}
  const placeLabel = [place.name, place.admin1, place.country]
    .filter(Boolean)
    .join(' · ')
  const now = (
    `${placeLabel}现在${weatherLabel(current.weather_code)}，`
    + `气温约 ${Math.round(current.temperature_2m)} 度，`
    + `风速约 ${Math.round(current.wind_speed_10m)} 公里每小时。`
  )
  const days = []
  const dates = daily.time || []
  for (let i = 0; i < dates.length; i += 1) {
    days.push({
      date: dates[i],
      label: weatherLabel(daily.weather_code?.[i]),
      high: Math.round(daily.temperature_2m_max?.[i]),
      low: Math.round(daily.temperature_2m_min?.[i]),
    })
  }
  let summary = now
  if (days.length > 1) {
    const rest = days.slice(1).map(day => (
      `${day.date} ${day.label}，${day.low} 到 ${day.high} 度`
    )).join('；')
    summary += `接下来：${rest}。`
  }
  return {
    location: placeLabel,
    summary,
    current: {
      temperatureC: current.temperature_2m,
      weather: weatherLabel(current.weather_code),
      windKmh: current.wind_speed_10m,
    },
    days,
  }
}

export function createWeatherTool({ fetchImpl = globalThis.fetch } = {}) {
  return {
    name: WEATHER_TOOL_NAME,
    definition: TOOL_DEFINITION,
    source: 'capability',
    handler: async (args = {}) => {
      const location = String(args.location || '').trim()
      if (!location) {
        return {
          status: 'failed',
          error: true,
          error_code: 'missing_location',
          user_message: '需要提供地点。',
        }
      }
      try {
        const place = await geocodeLocation(location, { fetchImpl })
        if (!place) {
          return {
            status: 'not_found',
            user_message: `没有找到地点「${location}」。`,
          }
        }
        const forecast = await fetchForecast(place, {
          days: args.days,
          fetchImpl,
        })
        const result = summarizeWeather(place, forecast)
        return {
          status: 'ok',
          ...result,
          user_message: result.summary,
        }
      } catch (error) {
        return {
          status: 'failed',
          error: true,
          error_code: 'weather_failed',
          user_message: '天气查询暂时不可用。',
          detail: String(error.message || error).slice(0, 160),
          retryable: true,
        }
      }
    },
  }
}
