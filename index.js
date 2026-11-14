// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. ThreemaApp (src/app.js) registers its handlers
// BEFORE connect(); /data holds the sends of the last hour, the pause and the
// refused ID (src/store.js); the Threema Gateway is reached through
// src/threema.js.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { ThreemaApp } from './src/app.js';
import { createThreema } from './src/threema.js';
import { FileStore } from './src/store.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const gladys = new GladysIntegration();
const app = new ThreemaApp({
  gladys,
  logger,
  store: new FileStore(),
  threema: createThreema({
    userAgent: `gladys-threema/${version} (+https://github.com/LM1LC3N7/gladys-threema)`,
  }),
});

gladys.handleShutdown(() => app.stop());

logger.info('Starting the Threema integration...');
app.start().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
