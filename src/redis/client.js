import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl,{maxRetriesPerRequest: null});

redis.on('error', (err) => console.log('Redis Client Error', err));
redis.on('connect', () => console.log('Redis Client Connected'));

export const connectRedis = async () => {
    console.log('Redis connection initialized.');
};
