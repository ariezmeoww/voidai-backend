import { ApplicationBootstrap } from './bootstrap';
import { ApplicationServer } from './server';
import type { BootstrapConfig } from './bootstrap';

const DEFAULT_ENVIRONMENT = 'development';
const DEFAULT_LOG_LEVEL = 'info';
const EXIT_CODE_ERROR = 1;

function getBootstrapConfig(): BootstrapConfig {
  return {
    environment: (process.env.NODE_ENV as BootstrapConfig['environment']) || DEFAULT_ENVIRONMENT,
    logLevel: (process.env.LOG_LEVEL as BootstrapConfig['logLevel']) || DEFAULT_LOG_LEVEL
  };
}

async function main(): Promise<void> {
  try {
    const config = getBootstrapConfig();
    const bootstrap = new ApplicationBootstrap(config);
    const server = new ApplicationServer(bootstrap);
    
    await server.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(EXIT_CODE_ERROR);
  }
}

function handleUncaughtError(error: unknown): void {
  console.error('Unhandled error in main:', error);
  process.exit(EXIT_CODE_ERROR);
}

if (require.main === module) {
  main().catch(handleUncaughtError);
}