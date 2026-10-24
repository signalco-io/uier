import { initBotId } from 'botid/client/core';

// Vercel BotID: attaches the bot classification headers to same-origin requests to these routes.
// Every write handler of the comments API verifies them with `checkBotId()` (src/lib/comments/botProtection.ts).
initBotId({
    protect: [
        { path: '/api/comments', method: 'POST' },
        { path: '/api/comments/*', method: 'POST' },
        { path: '/api/comments/*', method: 'PATCH' },
        { path: '/api/comments/*', method: 'DELETE' }
    ]
});
