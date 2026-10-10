import { listen } from '@colyseus/tools';
import server from './app.config.js';
import { config } from './config.js';

await listen(server, config.PORT);
