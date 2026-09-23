import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/logic.check.ts');
  mod.runChecks();
  console.log('logic checks passed');
} finally {
  await server.close();
}
