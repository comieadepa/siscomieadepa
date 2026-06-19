import { PDFDocument } from 'pdf-lib';

export async function optimizePdfClient(file: File): Promise<{ blob: Blob; originalSize: number; optimizedSize: number; success: boolean }> {
  const originalSize = file.size;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    
    // Remover metadados para reduzir tamanho
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');
    
    // Salvar compactando streams de objetos
    const savedBytes = await pdfDoc.save({
      useObjectStreams: true,
    });
    
    const blob = new Blob([savedBytes as any], { type: 'application/pdf' });
    return {
      blob,
      originalSize,
      optimizedSize: blob.size,
      success: true,
    };
  } catch (error) {
    console.error('Erro ao otimizar PDF no navegador:', error);
    return {
      blob: file,
      originalSize,
      optimizedSize: originalSize,
      success: false,
    };
  }
}

export async function compressImageClient(file: File): Promise<{ blob: Blob; originalSize: number; optimizedSize: number; success: boolean }> {
  const originalSize = file.size;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ blob: file, originalSize, optimizedSize: originalSize, success: false });
          return;
        }

        const MAX_WIDTH = 1600;
        const MAX_HEIGHT = 1600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve({
              blob,
              originalSize,
              optimizedSize: blob.size,
              success: true,
            });
          } else {
            resolve({ blob: file, originalSize, optimizedSize: originalSize, success: false });
          }
        }, 'image/jpeg', 0.75);
      };
      img.onerror = () => {
        resolve({ blob: file, originalSize, optimizedSize: originalSize, success: false });
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      resolve({ blob: file, originalSize, optimizedSize: originalSize, success: false });
    };
    reader.readAsDataURL(file);
  });
}
