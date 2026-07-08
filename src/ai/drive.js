import { google } from 'googleapis';
import fs from 'fs';

export const uploadToDrive = async (filePath, fileName, mimeType, providerToken, providerRefreshToken) => {
    try {
        const oauth2Client = new google.auth.OAuth2();

        // Set the tokens we got from Supabase
        oauth2Client.setCredentials({
            access_token: providerToken,
            refresh_token: providerRefreshToken
        });

        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const fileMetadata = {
            name: fileName,
        };
        
        const media = {
            mimeType: mimeType,
            body: fs.createReadStream(filePath),
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id',
        });

        return response.data.id;
    } catch (error) {
        console.error("Google Drive Upload Error:", error);
        throw error;
    }
};
