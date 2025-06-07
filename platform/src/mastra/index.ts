
import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { LibSQLStore } from '@mastra/libsql';
import { LangfuseExporter } from 'langfuse-vercel';

import { weatherAgent } from './agents';

const cors = {
  origin: ['*'],
  allowMethods: ['*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

export const mastra = new Mastra({
  agents: { weatherAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  server: {
    port: process.env.PORT ? Number.parseInt(process.env.PORT) : undefined,
    host: process.env.AWS_LAMBDA_EXEC_WRAPPER ? '0.0.0.0' : 'localhost',
    timeout: 10000,
    cors,
  },
  logger: new ConsoleLogger({
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
