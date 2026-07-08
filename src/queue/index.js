import { Queue } from 'bullmq';
import { redis } from '../redis/client.js';

// Create a BullMQ Queue using our existing Redis connection
export const mediaQueue = new Queue('media-upload-queue', { connection: redis });
