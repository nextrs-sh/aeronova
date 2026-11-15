import { main } from './db-tool';

// The TalaDB handle may keep the event loop alive; exit with the command's status.
process.exit(await main());
