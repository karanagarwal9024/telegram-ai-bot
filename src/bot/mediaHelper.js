import fs from 'fs';
import path from 'path';
import { bot } from './telegram.js';

export const downloadTelegramFile = async (fileId, fileName) => {
    const fileLink = await bot.telegram.getFileLink(fileId);
    
    let buffer;
    let retries = 3;
    
    while (retries > 0) {
        try {
            // Use AbortSignal to increase the default timeout from 10s to 30s
            const response = await fetch(fileLink.href, {
                signal: AbortSignal.timeout(30000) 
            });
            
            if (!response.ok) {
                throw new Error(`Telegram API responded with status: ${response.status}`);
            }
            
            buffer = await response.arrayBuffer();
            break; // Success, exit retry loop
        } catch (error) {
            retries--;
            console.warn(`[Download Warning] Failed to download file from Telegram. Retries left: ${retries}. Error: ${error.message}`);
            if (retries === 0) {
                throw new Error(`Failed to download Telegram file after 3 attempts: ${error.message}`);
            }
            // Wait 2 seconds before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // Create tmp directory if it doesn't exist
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    
    return filePath;
};
