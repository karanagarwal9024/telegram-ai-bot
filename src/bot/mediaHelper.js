import fs from 'fs';
import path from 'path';
import { bot } from './telegram.js';

export const downloadTelegramFile = async (fileId, fileName) => {
    const fileLink = await bot.telegram.getFileLink(fileId);
    
    const response = await fetch(fileLink.href);
    const buffer = await response.arrayBuffer();
    
    // Create tmp directory if it doesn't exist
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }
    
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    
    return filePath;
};
