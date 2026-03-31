#!/usr/bin/env node
import http from 'http';

const PORT = Number(process.env.PORT || 4040);
const MCP_AUTH = process.env.MCP_AUTH === '1';
const MCP_EXPECTED_KEY = process.env.MCP_EXPECTED_KEY || 'test-secret';
const MCP_402 = process.env.MCP_402 === '1';
const MCP_SESSION_REQUIRED = process.env.MCP_SESSION_REQUIRED === '1';
const MCP_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2025-06-18';

const accepts = (() => {
  try {
    if (process.env.ACCEPTS_JSON) return JSON.parse(process.env.ACCEPTS_JSON);
  } catch {}
  return [
    {
      price: '1000000',
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      network: '84532',
      scheme: 'exact',
      destination: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    },
  ];
})();

let serverSessionId = 'sess-1';
const tools = [
  { name: 'get_weather', description: 'Weather by location', inputSchema: { type: 'object' } },
  { name: 'user-profile/update', description: 'Update profile', inputSchema: { type: 'object' } },
];
const prompts = [{ name: 'code_review', description: 'Review code' }];
const resources = [{ uri: 'file:///README.md', name: 'README.md', mimeType: 'text/markdown' }];
const resourceTemplates = [{ uriTemplate: 'file:///{path}', name: 'Project Files', mimeType: 'application/octet-stream' }];

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function parsePaymentSignature(sig) {
  if (!sig || typeof sig !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(sig, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function send402(res) {
  const payload = Buffer.from(JSON.stringify({ x402Version: 2, accepts }), 'utf8').toString('base64');
  res.writeHead(402, { 'PAYMENT-REQUIRED': payload, 'Content-Type': 'application/json' });
  res.end('{}');
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function checkAuth(req) {
  if (!MCP_AUTH) return true;
  const auth = req.headers.authorization;
  const key = req.headers['x-api-key'];
  if (typeof auth === 'string' && auth === `Bearer ${MCP_EXPECTED_KEY}`) return true;
  if (key === MCP_EXPECTED_KEY) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname !== '/mcp') {
    return sendJson(res, 404, { error: 'not found' });
  }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    return sendJson(res, 405, { error: 'method not allowed' });
  }
  if (!checkAuth(req)) {
    return sendJson(
      res,
      401,
      { error: 'unauthorized' },
      { 'WWW-Authenticate': 'Bearer realm="mcp", resource_metadata="http://localhost/.well-known/oauth-protected-resource"' }
    );
  }
  if (req.method === 'GET') {
    return sendJson(res, 405, { error: 'sse not supported in test server' });
  }
  if (req.method === 'DELETE') {
    serverSessionId = `sess-${Date.now()}`;
    return sendJson(res, 200, { ok: true });
  }

  if (MCP_402 && !parsePaymentSignature(req.headers['payment-signature'])) {
    return send402(res);
  }

  const body = await parseBody(req);
  const method = body?.method;
  const sessionId = req.headers['mcp-session-id'];
  const protocolVersion = req.headers['mcp-protocol-version'];
  if (method !== 'initialize') {
    if (MCP_SESSION_REQUIRED && sessionId !== serverSessionId) {
      return sendJson(res, 400, { error: 'missing session id' });
    }
    if (MCP_SESSION_REQUIRED && protocolVersion !== MCP_PROTOCOL_VERSION) {
      return sendJson(res, 400, { error: 'unsupported protocol header' });
    }
  }

  const id = body?.id ?? '1';
  if (method === 'initialize') {
    return sendJson(
      res,
      200,
      {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: true },
            prompts: { listChanged: true },
            resources: { listChanged: true },
          },
          serverInfo: { name: 'mcp-test-server', version: '1.0.0' },
        },
      },
      { 'Mcp-Session-Id': serverSessionId }
    );
  }
  if (method === 'notifications/initialized') {
    res.writeHead(202);
    return res.end();
  }
  if (method === 'tools/list') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: { tools } });
  }
  if (method === 'tools/call') {
    const toolName = body?.params?.name;
    if (toolName === 'get_weather') {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'Weather: Sunny' }], isError: false },
      });
    }
    if (toolName === 'user-profile/update') {
      return sendJson(res, 200, {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'Profile Updated' }], isError: false },
      });
    }
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `Unknown tool: ${toolName}` },
    });
  }
  if (method === 'prompts/list') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: { prompts } });
  }
  if (method === 'prompts/get') {
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: {
        messages: [{ role: 'user', content: { type: 'text', text: 'Please review this code.' } }],
      },
    });
  }
  if (method === 'resources/list') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: { resources } });
  }
  if (method === 'resources/read') {
    return sendJson(res, 200, {
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri: 'file:///README.md', mimeType: 'text/markdown', text: '# Hello' }] },
    });
  }
  if (method === 'resources/templates/list') {
    return sendJson(res, 200, { jsonrpc: '2.0', id, result: { resourceTemplates } });
  }

  return sendJson(res, 200, {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});

server.listen(PORT, () => {
  console.log(`MCP test server on http://localhost:${PORT}/mcp`);
});

