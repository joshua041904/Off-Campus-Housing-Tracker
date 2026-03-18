// Type declarations for nodemailer
// Fallback declarations if @types/nodemailer is not available
declare module 'nodemailer' {
  export interface Transporter {
    sendMail(mailOptions: any): Promise<any>;
  }
  
  export function createTransport(options: any): Transporter;
  
  const nodemailer: {
    createTransport: typeof createTransport;
  };
  export default nodemailer;
}

