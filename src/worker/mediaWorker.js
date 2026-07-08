import { Worker } from 'bullmq';
import { redis } from '../redis/client.js';
import { supabase } from '../supabase/client.js';
import { uploadToDrive } from '../ai/drive.js';
import { bot } from '../bot/telegram.js';
import fs from 'fs';

export const startMediaWorker = () => {
    const worker = new Worker('media-upload-queue', async (job) => {
        const { telegramId, filePath, fileName, mimeType, journalEntryId } = job.data;
        
        try {
            console.log(`[Worker] Started background upload for job ${job.id}`);
            
            // 1. Fetch Google Provider Tokens from Supabase
            const { data: userData, error: userError } = await supabase
                .from('telegram_users')
                .select('provider_token, provider_refresh_token')
                .eq('telegram_id', telegramId)
                .single();
                
            if (userError || !userData || !userData.provider_token) {
                throw new Error('Google Drive tokens not found for user. Please login again.');
            }
            
            // 2. Upload to Google Drive (HEAVY TASK)
            const driveFileId = await uploadToDrive(
                filePath, 
                fileName, 
                mimeType, 
                userData.provider_token, 
                userData.provider_refresh_token
            );
            
            // 3. Update database with drive_file_id
            await supabase
                .from('journal_entries')
                .update({ drive_file_id: driveFileId })
                .eq('id', journalEntryId);
                
            // 4. Delete local temporary file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // 5. Send Telegram Notification
            await bot.telegram.sendMessage(telegramId, `✅ Success! Your file was securely backed up to Google Drive.`);
            
        } catch (error) {
            console.error("Worker Error processing job:", error);
            // Cleanup on failure just in case
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            await bot.telegram.sendMessage(telegramId, `❌ Failed to backup your file to Google Drive: ${error.message}`);
        }
    }, { connection: redis });
    
    worker.on('ready', () => {
        console.log('BullMQ Media Worker is successfully running in the background!');
    });
};
