import { connectRedis } from './redis/client.js';
import { launchBot } from './bot/telegram.js';
import { startServer } from './auth/server.js';
import { startMediaWorker } from './worker/mediaWorker.js';

const main = async () => {
    try {
        console.log('Starting Background Worker...');
        
        // 1. Start Auth Web Server
        startServer();

        // 2. Connect to Redis
        await connectRedis();
        
        // 3. Start BullMQ Background Worker
        startMediaWorker();

        // 3. Launch Telegram Bot (Long polling for now)
        await launchBot();

        console.log('Background Worker is running.');
    } catch (error) {
        console.error('Error starting worker:', error);
        process.exit(1);
    }
};

main();
