import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';

import { weatherAgent } from './agents/index.js';

const cors = {
  origin: ['*'],
  allowMethods: ['*'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

export const mastra = new Mastra({
  agents: { weatherAgent },
  server: {
    port: process.env.PORT ? Number.parseInt(process.env.PORT) : undefined,
    host: process.env.AWS_LAMBDA_EXEC_WRAPPER ? '0.0.0.0' : 'localhost',
    timeout: 10000,
    cors,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      langfuse: {
        serviceName: 'my-service',
        exporters: [new LangfuseExporter()],
      },
    },
  }),
});
