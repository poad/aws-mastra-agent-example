import { MCPClient } from '@mastra/mcp';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import sha256 from 'crypto-js/sha256.js';

const getMcpServerEndpointUrl = async () => {
  if (!process.env.MCP_SERVER_ENDPOINT_URL) {
    const parameterName = process.env.MCP_SERVER_ENDPOINT_URL_PARAM;
    if (parameterName) {
      const ssm = new SSMClient({});
      const parameter = await ssm.send(new GetParameterCommand({
        Name: parameterName,
        WithDecryption: false,
      }));
      return parameter.Parameter?.Value ?? 'http://localhost:3000/mcp';
    }
    return 'http://localhost:3000/mcp';
  }
  return process.env.MCP_SERVER_ENDPOINT_URL;
};

// Configure MCPClient to connect to your server(s)
export const mcp = new MCPClient({
  servers: {
    weather: {
      url: new URL(await getMcpServerEndpointUrl()),
      // これもカスタムヘッダーを持つSSE接続には必要です
      eventSourceInit: {
        fetch(input: Request | URL | string, init?: RequestInit) {
          const headers = new Headers(init?.headers || {});
          if (init?.body) {
            const hash = sha256(JSON.stringify(init.body));
            headers.set('x-amz-content-sha256', hash.toString());
          }

          return fetch(input, {
            ...init,
            headers,
          });
        },
      },
    },
  },
});
