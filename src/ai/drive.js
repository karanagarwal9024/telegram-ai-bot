import { google } from 'googleapis';
import fs from 'fs';

export const uploadToDrive = async (filePath, fileName, mimeType, providerToken, providerRefreshToken) => {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );

        // We ONLY pass the refresh_token. Because we don't know the exact expiration date 
        // of the access token, passing only the refresh token forces Google to fetch a 
        // brand new access token every single time, guaranteeing it never fails!
        oauth2Client.setCredentials({
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
