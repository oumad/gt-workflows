/**
 * Compresses an image file by resizing it to a maximum dimension and converting to JPEG format
 * @param file - The image file to compress
 * @param maxDimension - Maximum width or height in pixels (default: 800)
 * @param quality - JPEG quality from 0 to 1 (default: 0.85)
 * @returns A Promise that resolves to a compressed File object
 */
export async function compressImage(
  file: File,
  maxDimension: number = 800,
  quality: number = 0.85
): Promise<File> {
  return new Promise((resolve, reject) => {
    // Check if file is an image
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }

    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;
        
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }
        
        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        // Draw image with high quality
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            
            // Create a new File object with JPEG extension
            const originalName = file.name;
            const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
            const compressedFileName = `${nameWithoutExt}.jpg`;
            const compressedFile = new File(
              [blob],
              compressedFileName,
              {
                type: 'image/jpeg',
                lastModified: Date.now(),
              }
            );
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
}

