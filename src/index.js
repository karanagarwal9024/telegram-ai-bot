import { connectRedis } from './redis/client.js';
import { launchBot } from './bot/telegram.js';

const main = async () => {
    try {
        console.log('Starting Background Worker...');
        
        // 1. Connect to Redis
        await connectRedis();

        // 2. Launch Telegram Bot (Long polling for now)
        await launchBot();

        console.log('Background Worker is running.');
    } catch (error) {
        console.error('Error starting worker:', error);
        process.exit(1);
    }
};

main();
