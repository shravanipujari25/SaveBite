import multer from 'multer';
import env from '../config/env.js';
import { AppError } from './errorHandler.js';

/**
 * Validates binary signature (magic bytes) of uploaded buffer.
 *
 * @param {Buffer} buffer
 * @returns {string|null} Detected MIME type or null if unrecognized
 */
export const detectMimeTypeFromMagicBytes = (buffer) => {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 (\x89PNG)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
};

const ALLOWED_RECEIPT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
];

const ALLOWED_CAMERA_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp'
];

/**
 * Creates a file upload middleware handler for a specific field name and allowed types.
 *
 * @param {string} fieldName - Form field name (e.g. 'file')
 * @param {string[]} allowedMimes - Allowed MIME types
 * @returns {Function} Express middleware
 */
export const createUploadMiddleware = (fieldName = 'file', allowedMimes = ALLOWED_RECEIPT_MIMES) => {
  const maxBytes = env.RECEIPT_MAX_FILE_SIZE_MB * 1024 * 1024;

  const storage = multer.memoryStorage();
  const upload = multer({
    storage,
    limits: {
      fileSize: maxBytes,
      files: 1
    }
  }).single(fieldName);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE' || err.message === 'File too large') {
          return next(
            new AppError(
              `Uploaded file exceeds the maximum allowable limit of ${env.RECEIPT_MAX_FILE_SIZE_MB}MB`,
              413,
              'PAYLOAD_TOO_LARGE'
            )
          );
        }
        return next(
          new AppError(
            err.message || 'Error processing uploaded file',
            400,
            'MALFORMED_UPLOAD'
          )
        );
      }

      // Check if file was provided
      if (!req.file) {
        return next(
          new AppError(
            `No file uploaded under form-data field '${fieldName}'. Please attach a valid file.`,
            400,
            'FILE_MISSING'
          )
        );
      }

      // Verify file signature (magic bytes)
      const detectedMime = detectMimeTypeFromMagicBytes(req.file.buffer);

      if (!detectedMime || !allowedMimes.includes(detectedMime)) {
        return next(
          new AppError(
            `Unsupported file format. Supported formats: ${allowedMimes.join(', ')}`,
            415,
            'UNSUPPORTED_MEDIA_TYPE'
          )
        );
      }

      // Normalize detected mime type onto req.file
      req.file.detectedMime = detectedMime;
      next();
    });
  };
};

export const uploadReceiptFile = createUploadMiddleware('file', ALLOWED_RECEIPT_MIMES);
export const uploadFreshnessImage = createUploadMiddleware('file', ALLOWED_CAMERA_MIMES);

export default {
  detectMimeTypeFromMagicBytes,
  createUploadMiddleware,
  uploadReceiptFile,
  uploadFreshnessImage
};
