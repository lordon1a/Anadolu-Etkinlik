import { refreshSnapshot } from './event-source.mjs';

refreshSnapshot({ force: true }).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
