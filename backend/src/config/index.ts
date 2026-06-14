import { z } from 'zod';

const configSchema = z.object({
  port: z.number().default(3001),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  
  database: z.object({
    url: z.string().default('file:./questman.db')
  }),
  
  jwt: z.object({
    secret: z.string().min(32),
    expiresIn: z.string().default('7d')
  }),
  
  upload: z.object({
    maxFileSize: z.number().default(50 * 1024 * 1024), // 50MB
    allowedTypes: z.array(z.string()).default(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
  }),
  
  analytics: z.object({
    retentionDays: z.number().default(365),
    batchSize: z.number().default(1000)
  }),
  
  rateLimit: z.object({
    windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
    maxRequests: z.number().default(100)
  }),

  anthropic: z.object({
    apiKey: z.string().optional(),
    model: z.string().default('claude-opus-4-8'),
    // Cheaper/faster model for the intelligence layer (AI Handler banter,
    // daily rundown, weekly debrief, insight phrasing). Brent: "we can get
    // away with using a cheaper/faster model." Defaults to Haiku.
    handlerModel: z.string().default('claude-haiku-4-5')
  }),

  features: z.object({
    aiQuests: z.boolean().default(true),
    // Intelligence layer toggles. Both degrade gracefully when off or when
    // no API key is set — the app never blocks on Claude.
    handler: z.boolean().default(true),
    insights: z.boolean().default(true)
  }),

  // Hub location for weather-aware chores. Both must be set for the
  // WeatherService to call Open-Meteo; otherwise outdoor gating
  // degrades to interval-only. Latitude -90..90, longitude -180..180.
  weather: z.object({
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional()
  }),

  // Calendar uplink: private ICS URLs (e.g. Google Calendar's "secret
  // address in iCal format"), comma-separated. When set, today's busy
  // time shrinks the day-planner budget and feeds the Today agenda.
  calendar: z.object({
    icsUrls: z.array(z.string().url()).default([])
  }),

  // Single-user self-hosted hub: public signup is off by default.
  allowRegistration: z.boolean().default(false),

  // Long-lived shared secret for POST /api/ingest/* (phone-side health
  // bridges that can't do the JWT login dance). Min 16 chars — fail fast
  // on a guessable token rather than expose an unauthenticated writer.
  ingestToken: z.string().min(16).optional(),

  // Health PULL mode: poll the health-connect-webhook app's local HTTP
  // server on the phone (GET-only, trusted LAN) instead of receiving
  // webhooks — Android's cleartext policy blocks the app from POSTing to
  // a plain-HTTP hub, but the phone serving HTTP has no such restriction.
  health: z.object({
    pullUrl: z.string().url().optional(),  // e.g. http://192.168.0.42:8787
    pullMinutes: z.number().int().min(5).default(30),
    // The app's "Local HTTP auth" bearer token (optional but recommended —
    // without it the phone's server answers anyone on the LAN).
    pullToken: z.string().optional(),
    // Historic backfill window (days) requested on the first successful pull
    // after boot, to fill the trend charts with as much past data as the
    // phone holds. Steady-state polls stay incremental (a few days).
    backfillDays: z.number().int().min(2).max(365).default(365)
  })
});

const env = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV as 'development' | 'production' | 'test' || 'development',
  
  database: {
    url: process.env.DATABASE_URL || 'file:./questman.db'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  
  upload: {
    maxFileSize: Number(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024,
    allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || [
      'text/csv', 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
      'application/vnd.ms-excel'
    ]
  },
  
  analytics: {
    retentionDays: Number(process.env.ANALYTICS_RETENTION_DAYS) || 365,
    batchSize: Number(process.env.ANALYTICS_BATCH_SIZE) || 1000
  },
  
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    handlerModel: process.env.ANTHROPIC_HANDLER_MODEL || 'claude-haiku-4-5'
  },

  features: {
    aiQuests: process.env.AI_QUESTS ? process.env.AI_QUESTS !== 'false' : true,
    handler: process.env.HANDLER ? process.env.HANDLER !== 'false' : true,
    insights: process.env.INSIGHTS ? process.env.INSIGHTS !== 'false' : true
  },

  weather: {
    lat: process.env.HUB_LAT ? Number(process.env.HUB_LAT) : undefined,
    lon: process.env.HUB_LON ? Number(process.env.HUB_LON) : undefined
  },

  calendar: {
    icsUrls: process.env.CALENDAR_ICS_URL
      ? process.env.CALENDAR_ICS_URL.split(',').map(s => s.trim()).filter(Boolean)
      : []
  },

  allowRegistration: process.env.ALLOW_REGISTRATION === 'true',

  ingestToken: process.env.INGEST_TOKEN || undefined,

  health: {
    pullUrl: process.env.HEALTH_PULL_URL || undefined,
    pullMinutes: Number(process.env.HEALTH_PULL_MINUTES) || 30,
    pullToken: process.env.HEALTH_PULL_TOKEN || undefined,
    backfillDays: Number(process.env.HEALTH_BACKFILL_DAYS) || 365
  }
};

export const config = configSchema.parse(env);

// Validate critical config on startup
if (config.nodeEnv === 'production' && config.jwt.secret === 'your-super-secret-jwt-key-min-32-chars') {
  throw new Error('JWT_SECRET must be set in production');
}