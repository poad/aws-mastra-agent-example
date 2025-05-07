
import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { LibSQLStore } from '@mastra/libsql';
import { LangfuseExporter } from 'langfuse-vercel';

import { weatherAgent } from './agents';

const origin = process.env.ALLOW_CORS_ORIGIN ?? '*';

const cors = origin ? {
  origin: [origin],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
} : undefined;

export const mastra = new Mastra({
  agents: { weatherAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  server: {
    port: process.env.PORT ? Number.parseInt(process.env.PORT) : undefined,
    host: '0.0.0.0',
    timeout: 10000,
    cors,
  },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    serviceName: 'ai', // this must be set to "ai" so that the LangfuseExporter thinks it's an AI SDK trace
    enabled: true,
    export: {
      type: 'custom',
      exporter: new LangfuseExporter({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASEURL,
        flushAt: 1,
      }),
    },
  },
});
