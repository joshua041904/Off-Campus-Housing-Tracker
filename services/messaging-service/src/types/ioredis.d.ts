// Minimal TypeScript shim for environments without `@types/ioredis`.
declare module 'ioredis' {
  class Redis {
    // Allow any additional redis commands without maintaining a full surface area.
    [key: string]: any

    constructor(...args: any[])
    connect(): Promise<void>
    disconnect(): Promise<void>

    on(event: string, cb: (...args: any[]) => void): void
    script(...args: any[]): Promise<any>
    evalsha(...args: any[]): Promise<any>
    get(...args: any[]): Promise<string | null>
    setnx(...args: any[]): Promise<number>
    pexpire(...args: any[]): Promise<number>

    multi(...args: any[]): any
    psetex(...args: any[]): Promise<any>

    ping(...args: any[]): Promise<string>
  }

  export default Redis
}

