import 'server-only';
import { validateServerEnvAtStartup } from './env';
import { log } from './observability';

/**
 * Milestone 7 (Node.js runtime only): validate the environment when the server starts. A throw
 * from `register()` would only fail each request, so a bad configuration exits the process and
 * the container visibly fails to start.
 */
export function checkStartupEnvironment(): void {
  try {
    validateServerEnvAtStartup();
  } catch (error) {
    log('error', 'startup failed', { reason: (error as Error).message });
    if (process.env.NEXT_PHASE !== 'phase-production-build') process.exit(1);
    throw error;
  }
}
