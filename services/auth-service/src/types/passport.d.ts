// Type declarations for passport and passport-google-oauth20
// These are fallback declarations if @types packages are not available
declare module 'passport' {
  export interface Authenticator {
    use(strategy: any): this;
    initialize(options?: any): any;
    authenticate(strategy: string | string[], options?: any): any;
  }
  
  const passport: Authenticator;
  export default passport;
}

declare module 'passport-google-oauth20' {
  export interface Profile {
    id: string;
    displayName?: string;
    emails?: Array<{ value: string }>;
    photos?: Array<{ value: string }>;
    _json?: any;
  }
  
  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
  }
  
  export type VerifyCallback = (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (error: any, user?: any) => void
  ) => void;
  
  export class Strategy {
    constructor(options: StrategyOptions, verify: VerifyCallback);
  }
}

