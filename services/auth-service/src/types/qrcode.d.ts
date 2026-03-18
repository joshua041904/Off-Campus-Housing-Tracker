// Type declarations for qrcode
// Fallback declarations if @types/qrcode is not available
declare module 'qrcode' {
  export function toDataURL(text: string, options?: any): Promise<string>;
  export function toBuffer(text: string, options?: any): Promise<Buffer>;
  export function toString(text: string, options?: any): Promise<string>;
  
  const QRCode: {
    toDataURL: typeof toDataURL;
    toBuffer: typeof toBuffer;
    toString: typeof toString;
  };
  
  export default QRCode;
}

