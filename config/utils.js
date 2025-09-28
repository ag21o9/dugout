
import multer from 'multer'
import cloudinary from './cloudinary.js'

const upload = multer({ storage: multer.memoryStorage() });

// Helper to upload a single image buffer to cloudinary
async function uploadImageBuffer(buffer) {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream({ folder: 'dugout' }, (err, result) => {
            if (err) return reject(err);
            resolve(result.secure_url);
        }).end(buffer);
    });
}

// Helper to upload multiple image buffers to cloudinary
async function uploadImageBuffers(files) {
    const urls = [];
    for (const file of files) {
        const url = await uploadImageBuffer(file.buffer);
        urls.push(url);
    }
    return urls;
}

export { upload, uploadImageBuffer, uploadImageBuffers }