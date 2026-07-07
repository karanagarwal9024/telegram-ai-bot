import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { redis } from '../redis/client.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

export const bot = new Telegraf(token);

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    
    const userId = ctx.from.id;
    const key = `rate_limit:${userId}`;
    
    try {
        const requests = await redis.incr(key);
        if (requests === 1) {
            await redis.expire(key, 10); // 10 seconds window
        }
        
        if (requests > 5) {
            await ctx.reply('You are sending messages too fast! Please slow down.');
            return;
        }
    } catch (error) {
        console.error('Redis error in rate limit', error);
    }
    
    return next();
});

bot.command('start', (ctx) => {
    ctx.reply('Welcome to the AI Bot! Send me text, voice notes, images, or PDFs.');
});

bot.on('text', (ctx) => {
    ctx.reply(`Echo: ${ctx.message.text}`);
});

export const launchBot = async () => {
    await bot.launch();
    console.log('Telegram Bot successfully launched via long polling.');

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
};
