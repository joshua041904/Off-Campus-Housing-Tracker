
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Post
 * 
 */
export type Post = $Result.DefaultSelection<Prisma.$PostPayload>
/**
 * Model PostAttachment
 * 
 */
export type PostAttachment = $Result.DefaultSelection<Prisma.$PostAttachmentPayload>
/**
 * Model Comment
 * 
 */
export type Comment = $Result.DefaultSelection<Prisma.$CommentPayload>
/**
 * Model CommentAttachment
 * 
 */
export type CommentAttachment = $Result.DefaultSelection<Prisma.$CommentAttachmentPayload>
/**
 * Model PostVote
 * 
 */
export type PostVote = $Result.DefaultSelection<Prisma.$PostVotePayload>
/**
 * Model CommentVote
 * 
 */
export type CommentVote = $Result.DefaultSelection<Prisma.$CommentVotePayload>
/**
 * Model Group
 * 
 */
export type Group = $Result.DefaultSelection<Prisma.$GroupPayload>
/**
 * Model GroupMember
 * 
 */
export type GroupMember = $Result.DefaultSelection<Prisma.$GroupMemberPayload>
/**
 * Model Message
 * 
 */
export type Message = $Result.DefaultSelection<Prisma.$MessagePayload>
/**
 * Model MessageAttachment
 * 
 */
export type MessageAttachment = $Result.DefaultSelection<Prisma.$MessageAttachmentPayload>
/**
 * Model MessageRead
 * 
 */
export type MessageRead = $Result.DefaultSelection<Prisma.$MessageReadPayload>

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Posts
 * const posts = await prisma.post.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Posts
   * const posts = await prisma.post.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.post`: Exposes CRUD operations for the **Post** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Posts
    * const posts = await prisma.post.findMany()
    * ```
    */
  get post(): Prisma.PostDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.postAttachment`: Exposes CRUD operations for the **PostAttachment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PostAttachments
    * const postAttachments = await prisma.postAttachment.findMany()
    * ```
    */
  get postAttachment(): Prisma.PostAttachmentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.comment`: Exposes CRUD operations for the **Comment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Comments
    * const comments = await prisma.comment.findMany()
    * ```
    */
  get comment(): Prisma.CommentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.commentAttachment`: Exposes CRUD operations for the **CommentAttachment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more CommentAttachments
    * const commentAttachments = await prisma.commentAttachment.findMany()
    * ```
    */
  get commentAttachment(): Prisma.CommentAttachmentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.postVote`: Exposes CRUD operations for the **PostVote** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PostVotes
    * const postVotes = await prisma.postVote.findMany()
    * ```
    */
  get postVote(): Prisma.PostVoteDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.commentVote`: Exposes CRUD operations for the **CommentVote** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more CommentVotes
    * const commentVotes = await prisma.commentVote.findMany()
    * ```
    */
  get commentVote(): Prisma.CommentVoteDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.group`: Exposes CRUD operations for the **Group** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Groups
    * const groups = await prisma.group.findMany()
    * ```
    */
  get group(): Prisma.GroupDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.groupMember`: Exposes CRUD operations for the **GroupMember** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GroupMembers
    * const groupMembers = await prisma.groupMember.findMany()
    * ```
    */
  get groupMember(): Prisma.GroupMemberDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.message`: Exposes CRUD operations for the **Message** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Messages
    * const messages = await prisma.message.findMany()
    * ```
    */
  get message(): Prisma.MessageDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.messageAttachment`: Exposes CRUD operations for the **MessageAttachment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more MessageAttachments
    * const messageAttachments = await prisma.messageAttachment.findMany()
    * ```
    */
  get messageAttachment(): Prisma.MessageAttachmentDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.messageRead`: Exposes CRUD operations for the **MessageRead** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more MessageReads
    * const messageReads = await prisma.messageRead.findMany()
    * ```
    */
  get messageRead(): Prisma.MessageReadDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.17.1
   * Query Engine version: 272a37d34178c2894197e17273bf937f25acdeac
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Post: 'Post',
    PostAttachment: 'PostAttachment',
    Comment: 'Comment',
    CommentAttachment: 'CommentAttachment',
    PostVote: 'PostVote',
    CommentVote: 'CommentVote',
    Group: 'Group',
    GroupMember: 'GroupMember',
    Message: 'Message',
    MessageAttachment: 'MessageAttachment',
    MessageRead: 'MessageRead'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "post" | "postAttachment" | "comment" | "commentAttachment" | "postVote" | "commentVote" | "group" | "groupMember" | "message" | "messageAttachment" | "messageRead"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Post: {
        payload: Prisma.$PostPayload<ExtArgs>
        fields: Prisma.PostFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PostFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PostFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          findFirst: {
            args: Prisma.PostFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PostFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          findMany: {
            args: Prisma.PostFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>[]
          }
          create: {
            args: Prisma.PostCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          createMany: {
            args: Prisma.PostCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PostCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>[]
          }
          delete: {
            args: Prisma.PostDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          update: {
            args: Prisma.PostUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          deleteMany: {
            args: Prisma.PostDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PostUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PostUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>[]
          }
          upsert: {
            args: Prisma.PostUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostPayload>
          }
          aggregate: {
            args: Prisma.PostAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePost>
          }
          groupBy: {
            args: Prisma.PostGroupByArgs<ExtArgs>
            result: $Utils.Optional<PostGroupByOutputType>[]
          }
          count: {
            args: Prisma.PostCountArgs<ExtArgs>
            result: $Utils.Optional<PostCountAggregateOutputType> | number
          }
        }
      }
      PostAttachment: {
        payload: Prisma.$PostAttachmentPayload<ExtArgs>
        fields: Prisma.PostAttachmentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PostAttachmentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PostAttachmentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          findFirst: {
            args: Prisma.PostAttachmentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PostAttachmentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          findMany: {
            args: Prisma.PostAttachmentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>[]
          }
          create: {
            args: Prisma.PostAttachmentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          createMany: {
            args: Prisma.PostAttachmentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PostAttachmentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>[]
          }
          delete: {
            args: Prisma.PostAttachmentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          update: {
            args: Prisma.PostAttachmentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          deleteMany: {
            args: Prisma.PostAttachmentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PostAttachmentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PostAttachmentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>[]
          }
          upsert: {
            args: Prisma.PostAttachmentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostAttachmentPayload>
          }
          aggregate: {
            args: Prisma.PostAttachmentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePostAttachment>
          }
          groupBy: {
            args: Prisma.PostAttachmentGroupByArgs<ExtArgs>
            result: $Utils.Optional<PostAttachmentGroupByOutputType>[]
          }
          count: {
            args: Prisma.PostAttachmentCountArgs<ExtArgs>
            result: $Utils.Optional<PostAttachmentCountAggregateOutputType> | number
          }
        }
      }
      Comment: {
        payload: Prisma.$CommentPayload<ExtArgs>
        fields: Prisma.CommentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.CommentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.CommentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          findFirst: {
            args: Prisma.CommentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.CommentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          findMany: {
            args: Prisma.CommentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>[]
          }
          create: {
            args: Prisma.CommentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          createMany: {
            args: Prisma.CommentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.CommentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>[]
          }
          delete: {
            args: Prisma.CommentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          update: {
            args: Prisma.CommentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          deleteMany: {
            args: Prisma.CommentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.CommentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.CommentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>[]
          }
          upsert: {
            args: Prisma.CommentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentPayload>
          }
          aggregate: {
            args: Prisma.CommentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateComment>
          }
          groupBy: {
            args: Prisma.CommentGroupByArgs<ExtArgs>
            result: $Utils.Optional<CommentGroupByOutputType>[]
          }
          count: {
            args: Prisma.CommentCountArgs<ExtArgs>
            result: $Utils.Optional<CommentCountAggregateOutputType> | number
          }
        }
      }
      CommentAttachment: {
        payload: Prisma.$CommentAttachmentPayload<ExtArgs>
        fields: Prisma.CommentAttachmentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.CommentAttachmentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.CommentAttachmentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          findFirst: {
            args: Prisma.CommentAttachmentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.CommentAttachmentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          findMany: {
            args: Prisma.CommentAttachmentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>[]
          }
          create: {
            args: Prisma.CommentAttachmentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          createMany: {
            args: Prisma.CommentAttachmentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.CommentAttachmentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>[]
          }
          delete: {
            args: Prisma.CommentAttachmentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          update: {
            args: Prisma.CommentAttachmentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          deleteMany: {
            args: Prisma.CommentAttachmentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.CommentAttachmentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.CommentAttachmentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>[]
          }
          upsert: {
            args: Prisma.CommentAttachmentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentAttachmentPayload>
          }
          aggregate: {
            args: Prisma.CommentAttachmentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateCommentAttachment>
          }
          groupBy: {
            args: Prisma.CommentAttachmentGroupByArgs<ExtArgs>
            result: $Utils.Optional<CommentAttachmentGroupByOutputType>[]
          }
          count: {
            args: Prisma.CommentAttachmentCountArgs<ExtArgs>
            result: $Utils.Optional<CommentAttachmentCountAggregateOutputType> | number
          }
        }
      }
      PostVote: {
        payload: Prisma.$PostVotePayload<ExtArgs>
        fields: Prisma.PostVoteFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PostVoteFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PostVoteFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          findFirst: {
            args: Prisma.PostVoteFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PostVoteFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          findMany: {
            args: Prisma.PostVoteFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>[]
          }
          create: {
            args: Prisma.PostVoteCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          createMany: {
            args: Prisma.PostVoteCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PostVoteCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>[]
          }
          delete: {
            args: Prisma.PostVoteDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          update: {
            args: Prisma.PostVoteUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          deleteMany: {
            args: Prisma.PostVoteDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PostVoteUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PostVoteUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>[]
          }
          upsert: {
            args: Prisma.PostVoteUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PostVotePayload>
          }
          aggregate: {
            args: Prisma.PostVoteAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePostVote>
          }
          groupBy: {
            args: Prisma.PostVoteGroupByArgs<ExtArgs>
            result: $Utils.Optional<PostVoteGroupByOutputType>[]
          }
          count: {
            args: Prisma.PostVoteCountArgs<ExtArgs>
            result: $Utils.Optional<PostVoteCountAggregateOutputType> | number
          }
        }
      }
      CommentVote: {
        payload: Prisma.$CommentVotePayload<ExtArgs>
        fields: Prisma.CommentVoteFieldRefs
        operations: {
          findUnique: {
            args: Prisma.CommentVoteFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.CommentVoteFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          findFirst: {
            args: Prisma.CommentVoteFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.CommentVoteFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          findMany: {
            args: Prisma.CommentVoteFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>[]
          }
          create: {
            args: Prisma.CommentVoteCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          createMany: {
            args: Prisma.CommentVoteCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.CommentVoteCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>[]
          }
          delete: {
            args: Prisma.CommentVoteDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          update: {
            args: Prisma.CommentVoteUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          deleteMany: {
            args: Prisma.CommentVoteDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.CommentVoteUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.CommentVoteUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>[]
          }
          upsert: {
            args: Prisma.CommentVoteUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CommentVotePayload>
          }
          aggregate: {
            args: Prisma.CommentVoteAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateCommentVote>
          }
          groupBy: {
            args: Prisma.CommentVoteGroupByArgs<ExtArgs>
            result: $Utils.Optional<CommentVoteGroupByOutputType>[]
          }
          count: {
            args: Prisma.CommentVoteCountArgs<ExtArgs>
            result: $Utils.Optional<CommentVoteCountAggregateOutputType> | number
          }
        }
      }
      Group: {
        payload: Prisma.$GroupPayload<ExtArgs>
        fields: Prisma.GroupFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GroupFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GroupFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          findFirst: {
            args: Prisma.GroupFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GroupFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          findMany: {
            args: Prisma.GroupFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>[]
          }
          create: {
            args: Prisma.GroupCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          createMany: {
            args: Prisma.GroupCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GroupCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>[]
          }
          delete: {
            args: Prisma.GroupDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          update: {
            args: Prisma.GroupUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          deleteMany: {
            args: Prisma.GroupDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GroupUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.GroupUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>[]
          }
          upsert: {
            args: Prisma.GroupUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupPayload>
          }
          aggregate: {
            args: Prisma.GroupAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGroup>
          }
          groupBy: {
            args: Prisma.GroupGroupByArgs<ExtArgs>
            result: $Utils.Optional<GroupGroupByOutputType>[]
          }
          count: {
            args: Prisma.GroupCountArgs<ExtArgs>
            result: $Utils.Optional<GroupCountAggregateOutputType> | number
          }
        }
      }
      GroupMember: {
        payload: Prisma.$GroupMemberPayload<ExtArgs>
        fields: Prisma.GroupMemberFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GroupMemberFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GroupMemberFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          findFirst: {
            args: Prisma.GroupMemberFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GroupMemberFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          findMany: {
            args: Prisma.GroupMemberFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>[]
          }
          create: {
            args: Prisma.GroupMemberCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          createMany: {
            args: Prisma.GroupMemberCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GroupMemberCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>[]
          }
          delete: {
            args: Prisma.GroupMemberDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          update: {
            args: Prisma.GroupMemberUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          deleteMany: {
            args: Prisma.GroupMemberDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GroupMemberUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.GroupMemberUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>[]
          }
          upsert: {
            args: Prisma.GroupMemberUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GroupMemberPayload>
          }
          aggregate: {
            args: Prisma.GroupMemberAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGroupMember>
          }
          groupBy: {
            args: Prisma.GroupMemberGroupByArgs<ExtArgs>
            result: $Utils.Optional<GroupMemberGroupByOutputType>[]
          }
          count: {
            args: Prisma.GroupMemberCountArgs<ExtArgs>
            result: $Utils.Optional<GroupMemberCountAggregateOutputType> | number
          }
        }
      }
      Message: {
        payload: Prisma.$MessagePayload<ExtArgs>
        fields: Prisma.MessageFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MessageFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MessageFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          findFirst: {
            args: Prisma.MessageFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MessageFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          findMany: {
            args: Prisma.MessageFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>[]
          }
          create: {
            args: Prisma.MessageCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          createMany: {
            args: Prisma.MessageCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MessageCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>[]
          }
          delete: {
            args: Prisma.MessageDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          update: {
            args: Prisma.MessageUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          deleteMany: {
            args: Prisma.MessageDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MessageUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.MessageUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>[]
          }
          upsert: {
            args: Prisma.MessageUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessagePayload>
          }
          aggregate: {
            args: Prisma.MessageAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMessage>
          }
          groupBy: {
            args: Prisma.MessageGroupByArgs<ExtArgs>
            result: $Utils.Optional<MessageGroupByOutputType>[]
          }
          count: {
            args: Prisma.MessageCountArgs<ExtArgs>
            result: $Utils.Optional<MessageCountAggregateOutputType> | number
          }
        }
      }
      MessageAttachment: {
        payload: Prisma.$MessageAttachmentPayload<ExtArgs>
        fields: Prisma.MessageAttachmentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MessageAttachmentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MessageAttachmentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          findFirst: {
            args: Prisma.MessageAttachmentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MessageAttachmentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          findMany: {
            args: Prisma.MessageAttachmentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>[]
          }
          create: {
            args: Prisma.MessageAttachmentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          createMany: {
            args: Prisma.MessageAttachmentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MessageAttachmentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>[]
          }
          delete: {
            args: Prisma.MessageAttachmentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          update: {
            args: Prisma.MessageAttachmentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          deleteMany: {
            args: Prisma.MessageAttachmentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MessageAttachmentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.MessageAttachmentUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>[]
          }
          upsert: {
            args: Prisma.MessageAttachmentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageAttachmentPayload>
          }
          aggregate: {
            args: Prisma.MessageAttachmentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMessageAttachment>
          }
          groupBy: {
            args: Prisma.MessageAttachmentGroupByArgs<ExtArgs>
            result: $Utils.Optional<MessageAttachmentGroupByOutputType>[]
          }
          count: {
            args: Prisma.MessageAttachmentCountArgs<ExtArgs>
            result: $Utils.Optional<MessageAttachmentCountAggregateOutputType> | number
          }
        }
      }
      MessageRead: {
        payload: Prisma.$MessageReadPayload<ExtArgs>
        fields: Prisma.MessageReadFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MessageReadFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MessageReadFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          findFirst: {
            args: Prisma.MessageReadFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MessageReadFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          findMany: {
            args: Prisma.MessageReadFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>[]
          }
          create: {
            args: Prisma.MessageReadCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          createMany: {
            args: Prisma.MessageReadCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MessageReadCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>[]
          }
          delete: {
            args: Prisma.MessageReadDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          update: {
            args: Prisma.MessageReadUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          deleteMany: {
            args: Prisma.MessageReadDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MessageReadUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.MessageReadUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>[]
          }
          upsert: {
            args: Prisma.MessageReadUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MessageReadPayload>
          }
          aggregate: {
            args: Prisma.MessageReadAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMessageRead>
          }
          groupBy: {
            args: Prisma.MessageReadGroupByArgs<ExtArgs>
            result: $Utils.Optional<MessageReadGroupByOutputType>[]
          }
          count: {
            args: Prisma.MessageReadCountArgs<ExtArgs>
            result: $Utils.Optional<MessageReadCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-planetscale`
     */
    adapter?: runtime.SqlDriverAdapterFactory | null
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    post?: PostOmit
    postAttachment?: PostAttachmentOmit
    comment?: CommentOmit
    commentAttachment?: CommentAttachmentOmit
    postVote?: PostVoteOmit
    commentVote?: CommentVoteOmit
    group?: GroupOmit
    groupMember?: GroupMemberOmit
    message?: MessageOmit
    messageAttachment?: MessageAttachmentOmit
    messageRead?: MessageReadOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type PostCountOutputType
   */

  export type PostCountOutputType = {
    comments: number
    votes: number
    attachments: number
  }

  export type PostCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comments?: boolean | PostCountOutputTypeCountCommentsArgs
    votes?: boolean | PostCountOutputTypeCountVotesArgs
    attachments?: boolean | PostCountOutputTypeCountAttachmentsArgs
  }

  // Custom InputTypes
  /**
   * PostCountOutputType without action
   */
  export type PostCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostCountOutputType
     */
    select?: PostCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * PostCountOutputType without action
   */
  export type PostCountOutputTypeCountCommentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentWhereInput
  }

  /**
   * PostCountOutputType without action
   */
  export type PostCountOutputTypeCountVotesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PostVoteWhereInput
  }

  /**
   * PostCountOutputType without action
   */
  export type PostCountOutputTypeCountAttachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PostAttachmentWhereInput
  }


  /**
   * Count Type CommentCountOutputType
   */

  export type CommentCountOutputType = {
    replies: number
    votes: number
    attachments: number
  }

  export type CommentCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    replies?: boolean | CommentCountOutputTypeCountRepliesArgs
    votes?: boolean | CommentCountOutputTypeCountVotesArgs
    attachments?: boolean | CommentCountOutputTypeCountAttachmentsArgs
  }

  // Custom InputTypes
  /**
   * CommentCountOutputType without action
   */
  export type CommentCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentCountOutputType
     */
    select?: CommentCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * CommentCountOutputType without action
   */
  export type CommentCountOutputTypeCountRepliesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentWhereInput
  }

  /**
   * CommentCountOutputType without action
   */
  export type CommentCountOutputTypeCountVotesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentVoteWhereInput
  }

  /**
   * CommentCountOutputType without action
   */
  export type CommentCountOutputTypeCountAttachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentAttachmentWhereInput
  }


  /**
   * Count Type GroupCountOutputType
   */

  export type GroupCountOutputType = {
    members: number
    messages: number
  }

  export type GroupCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | GroupCountOutputTypeCountMembersArgs
    messages?: boolean | GroupCountOutputTypeCountMessagesArgs
  }

  // Custom InputTypes
  /**
   * GroupCountOutputType without action
   */
  export type GroupCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupCountOutputType
     */
    select?: GroupCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * GroupCountOutputType without action
   */
  export type GroupCountOutputTypeCountMembersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GroupMemberWhereInput
  }

  /**
   * GroupCountOutputType without action
   */
  export type GroupCountOutputTypeCountMessagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageWhereInput
  }


  /**
   * Count Type MessageCountOutputType
   */

  export type MessageCountOutputType = {
    replies: number
    reads: number
    attachments: number
  }

  export type MessageCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    replies?: boolean | MessageCountOutputTypeCountRepliesArgs
    reads?: boolean | MessageCountOutputTypeCountReadsArgs
    attachments?: boolean | MessageCountOutputTypeCountAttachmentsArgs
  }

  // Custom InputTypes
  /**
   * MessageCountOutputType without action
   */
  export type MessageCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageCountOutputType
     */
    select?: MessageCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * MessageCountOutputType without action
   */
  export type MessageCountOutputTypeCountRepliesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageWhereInput
  }

  /**
   * MessageCountOutputType without action
   */
  export type MessageCountOutputTypeCountReadsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageReadWhereInput
  }

  /**
   * MessageCountOutputType without action
   */
  export type MessageCountOutputTypeCountAttachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageAttachmentWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Post
   */

  export type AggregatePost = {
    _count: PostCountAggregateOutputType | null
    _avg: PostAvgAggregateOutputType | null
    _sum: PostSumAggregateOutputType | null
    _min: PostMinAggregateOutputType | null
    _max: PostMaxAggregateOutputType | null
  }

  export type PostAvgAggregateOutputType = {
    upvotes: number | null
    downvotes: number | null
    comment_count: number | null
  }

  export type PostSumAggregateOutputType = {
    upvotes: number | null
    downvotes: number | null
    comment_count: number | null
  }

  export type PostMinAggregateOutputType = {
    id: string | null
    user_id: string | null
    title: string | null
    content: string | null
    flair: string | null
    upload_type: string | null
    upvotes: number | null
    downvotes: number | null
    comment_count: number | null
    is_pinned: boolean | null
    is_locked: boolean | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type PostMaxAggregateOutputType = {
    id: string | null
    user_id: string | null
    title: string | null
    content: string | null
    flair: string | null
    upload_type: string | null
    upvotes: number | null
    downvotes: number | null
    comment_count: number | null
    is_pinned: boolean | null
    is_locked: boolean | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type PostCountAggregateOutputType = {
    id: number
    user_id: number
    title: number
    content: number
    flair: number
    upload_type: number
    upvotes: number
    downvotes: number
    comment_count: number
    is_pinned: number
    is_locked: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type PostAvgAggregateInputType = {
    upvotes?: true
    downvotes?: true
    comment_count?: true
  }

  export type PostSumAggregateInputType = {
    upvotes?: true
    downvotes?: true
    comment_count?: true
  }

  export type PostMinAggregateInputType = {
    id?: true
    user_id?: true
    title?: true
    content?: true
    flair?: true
    upload_type?: true
    upvotes?: true
    downvotes?: true
    comment_count?: true
    is_pinned?: true
    is_locked?: true
    created_at?: true
    updated_at?: true
  }

  export type PostMaxAggregateInputType = {
    id?: true
    user_id?: true
    title?: true
    content?: true
    flair?: true
    upload_type?: true
    upvotes?: true
    downvotes?: true
    comment_count?: true
    is_pinned?: true
    is_locked?: true
    created_at?: true
    updated_at?: true
  }

  export type PostCountAggregateInputType = {
    id?: true
    user_id?: true
    title?: true
    content?: true
    flair?: true
    upload_type?: true
    upvotes?: true
    downvotes?: true
    comment_count?: true
    is_pinned?: true
    is_locked?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type PostAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Post to aggregate.
     */
    where?: PostWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Posts to fetch.
     */
    orderBy?: PostOrderByWithRelationInput | PostOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PostWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Posts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Posts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Posts
    **/
    _count?: true | PostCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PostAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PostSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PostMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PostMaxAggregateInputType
  }

  export type GetPostAggregateType<T extends PostAggregateArgs> = {
        [P in keyof T & keyof AggregatePost]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePost[P]>
      : GetScalarType<T[P], AggregatePost[P]>
  }




  export type PostGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PostWhereInput
    orderBy?: PostOrderByWithAggregationInput | PostOrderByWithAggregationInput[]
    by: PostScalarFieldEnum[] | PostScalarFieldEnum
    having?: PostScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PostCountAggregateInputType | true
    _avg?: PostAvgAggregateInputType
    _sum?: PostSumAggregateInputType
    _min?: PostMinAggregateInputType
    _max?: PostMaxAggregateInputType
  }

  export type PostGroupByOutputType = {
    id: string
    user_id: string
    title: string
    content: string
    flair: string
    upload_type: string
    upvotes: number
    downvotes: number
    comment_count: number
    is_pinned: boolean
    is_locked: boolean
    created_at: Date
    updated_at: Date
    _count: PostCountAggregateOutputType | null
    _avg: PostAvgAggregateOutputType | null
    _sum: PostSumAggregateOutputType | null
    _min: PostMinAggregateOutputType | null
    _max: PostMaxAggregateOutputType | null
  }

  type GetPostGroupByPayload<T extends PostGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PostGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PostGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PostGroupByOutputType[P]>
            : GetScalarType<T[P], PostGroupByOutputType[P]>
        }
      >
    >


  export type PostSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    title?: boolean
    content?: boolean
    flair?: boolean
    upload_type?: boolean
    upvotes?: boolean
    downvotes?: boolean
    comment_count?: boolean
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: boolean
    updated_at?: boolean
    comments?: boolean | Post$commentsArgs<ExtArgs>
    votes?: boolean | Post$votesArgs<ExtArgs>
    attachments?: boolean | Post$attachmentsArgs<ExtArgs>
    _count?: boolean | PostCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["post"]>

  export type PostSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    title?: boolean
    content?: boolean
    flair?: boolean
    upload_type?: boolean
    upvotes?: boolean
    downvotes?: boolean
    comment_count?: boolean
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["post"]>

  export type PostSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    title?: boolean
    content?: boolean
    flair?: boolean
    upload_type?: boolean
    upvotes?: boolean
    downvotes?: boolean
    comment_count?: boolean
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["post"]>

  export type PostSelectScalar = {
    id?: boolean
    user_id?: boolean
    title?: boolean
    content?: boolean
    flair?: boolean
    upload_type?: boolean
    upvotes?: boolean
    downvotes?: boolean
    comment_count?: boolean
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type PostOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "user_id" | "title" | "content" | "flair" | "upload_type" | "upvotes" | "downvotes" | "comment_count" | "is_pinned" | "is_locked" | "created_at" | "updated_at", ExtArgs["result"]["post"]>
  export type PostInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comments?: boolean | Post$commentsArgs<ExtArgs>
    votes?: boolean | Post$votesArgs<ExtArgs>
    attachments?: boolean | Post$attachmentsArgs<ExtArgs>
    _count?: boolean | PostCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type PostIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type PostIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $PostPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Post"
    objects: {
      comments: Prisma.$CommentPayload<ExtArgs>[]
      votes: Prisma.$PostVotePayload<ExtArgs>[]
      attachments: Prisma.$PostAttachmentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      user_id: string
      title: string
      content: string
      flair: string
      upload_type: string
      upvotes: number
      downvotes: number
      comment_count: number
      is_pinned: boolean
      is_locked: boolean
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["post"]>
    composites: {}
  }

  type PostGetPayload<S extends boolean | null | undefined | PostDefaultArgs> = $Result.GetResult<Prisma.$PostPayload, S>

  type PostCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PostFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PostCountAggregateInputType | true
    }

  export interface PostDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Post'], meta: { name: 'Post' } }
    /**
     * Find zero or one Post that matches the filter.
     * @param {PostFindUniqueArgs} args - Arguments to find a Post
     * @example
     * // Get one Post
     * const post = await prisma.post.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PostFindUniqueArgs>(args: SelectSubset<T, PostFindUniqueArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Post that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PostFindUniqueOrThrowArgs} args - Arguments to find a Post
     * @example
     * // Get one Post
     * const post = await prisma.post.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PostFindUniqueOrThrowArgs>(args: SelectSubset<T, PostFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Post that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostFindFirstArgs} args - Arguments to find a Post
     * @example
     * // Get one Post
     * const post = await prisma.post.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PostFindFirstArgs>(args?: SelectSubset<T, PostFindFirstArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Post that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostFindFirstOrThrowArgs} args - Arguments to find a Post
     * @example
     * // Get one Post
     * const post = await prisma.post.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PostFindFirstOrThrowArgs>(args?: SelectSubset<T, PostFindFirstOrThrowArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Posts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Posts
     * const posts = await prisma.post.findMany()
     * 
     * // Get first 10 Posts
     * const posts = await prisma.post.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const postWithIdOnly = await prisma.post.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PostFindManyArgs>(args?: SelectSubset<T, PostFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Post.
     * @param {PostCreateArgs} args - Arguments to create a Post.
     * @example
     * // Create one Post
     * const Post = await prisma.post.create({
     *   data: {
     *     // ... data to create a Post
     *   }
     * })
     * 
     */
    create<T extends PostCreateArgs>(args: SelectSubset<T, PostCreateArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Posts.
     * @param {PostCreateManyArgs} args - Arguments to create many Posts.
     * @example
     * // Create many Posts
     * const post = await prisma.post.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PostCreateManyArgs>(args?: SelectSubset<T, PostCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Posts and returns the data saved in the database.
     * @param {PostCreateManyAndReturnArgs} args - Arguments to create many Posts.
     * @example
     * // Create many Posts
     * const post = await prisma.post.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Posts and only return the `id`
     * const postWithIdOnly = await prisma.post.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PostCreateManyAndReturnArgs>(args?: SelectSubset<T, PostCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Post.
     * @param {PostDeleteArgs} args - Arguments to delete one Post.
     * @example
     * // Delete one Post
     * const Post = await prisma.post.delete({
     *   where: {
     *     // ... filter to delete one Post
     *   }
     * })
     * 
     */
    delete<T extends PostDeleteArgs>(args: SelectSubset<T, PostDeleteArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Post.
     * @param {PostUpdateArgs} args - Arguments to update one Post.
     * @example
     * // Update one Post
     * const post = await prisma.post.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PostUpdateArgs>(args: SelectSubset<T, PostUpdateArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Posts.
     * @param {PostDeleteManyArgs} args - Arguments to filter Posts to delete.
     * @example
     * // Delete a few Posts
     * const { count } = await prisma.post.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PostDeleteManyArgs>(args?: SelectSubset<T, PostDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Posts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Posts
     * const post = await prisma.post.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PostUpdateManyArgs>(args: SelectSubset<T, PostUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Posts and returns the data updated in the database.
     * @param {PostUpdateManyAndReturnArgs} args - Arguments to update many Posts.
     * @example
     * // Update many Posts
     * const post = await prisma.post.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Posts and only return the `id`
     * const postWithIdOnly = await prisma.post.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PostUpdateManyAndReturnArgs>(args: SelectSubset<T, PostUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Post.
     * @param {PostUpsertArgs} args - Arguments to update or create a Post.
     * @example
     * // Update or create a Post
     * const post = await prisma.post.upsert({
     *   create: {
     *     // ... data to create a Post
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Post we want to update
     *   }
     * })
     */
    upsert<T extends PostUpsertArgs>(args: SelectSubset<T, PostUpsertArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Posts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostCountArgs} args - Arguments to filter Posts to count.
     * @example
     * // Count the number of Posts
     * const count = await prisma.post.count({
     *   where: {
     *     // ... the filter for the Posts we want to count
     *   }
     * })
    **/
    count<T extends PostCountArgs>(
      args?: Subset<T, PostCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PostCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Post.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PostAggregateArgs>(args: Subset<T, PostAggregateArgs>): Prisma.PrismaPromise<GetPostAggregateType<T>>

    /**
     * Group by Post.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PostGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PostGroupByArgs['orderBy'] }
        : { orderBy?: PostGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PostGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPostGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Post model
   */
  readonly fields: PostFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Post.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PostClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    comments<T extends Post$commentsArgs<ExtArgs> = {}>(args?: Subset<T, Post$commentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    votes<T extends Post$votesArgs<ExtArgs> = {}>(args?: Subset<T, Post$votesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    attachments<T extends Post$attachmentsArgs<ExtArgs> = {}>(args?: Subset<T, Post$attachmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Post model
   */
  interface PostFieldRefs {
    readonly id: FieldRef<"Post", 'String'>
    readonly user_id: FieldRef<"Post", 'String'>
    readonly title: FieldRef<"Post", 'String'>
    readonly content: FieldRef<"Post", 'String'>
    readonly flair: FieldRef<"Post", 'String'>
    readonly upload_type: FieldRef<"Post", 'String'>
    readonly upvotes: FieldRef<"Post", 'Int'>
    readonly downvotes: FieldRef<"Post", 'Int'>
    readonly comment_count: FieldRef<"Post", 'Int'>
    readonly is_pinned: FieldRef<"Post", 'Boolean'>
    readonly is_locked: FieldRef<"Post", 'Boolean'>
    readonly created_at: FieldRef<"Post", 'DateTime'>
    readonly updated_at: FieldRef<"Post", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Post findUnique
   */
  export type PostFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter, which Post to fetch.
     */
    where: PostWhereUniqueInput
  }

  /**
   * Post findUniqueOrThrow
   */
  export type PostFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter, which Post to fetch.
     */
    where: PostWhereUniqueInput
  }

  /**
   * Post findFirst
   */
  export type PostFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter, which Post to fetch.
     */
    where?: PostWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Posts to fetch.
     */
    orderBy?: PostOrderByWithRelationInput | PostOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Posts.
     */
    cursor?: PostWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Posts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Posts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Posts.
     */
    distinct?: PostScalarFieldEnum | PostScalarFieldEnum[]
  }

  /**
   * Post findFirstOrThrow
   */
  export type PostFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter, which Post to fetch.
     */
    where?: PostWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Posts to fetch.
     */
    orderBy?: PostOrderByWithRelationInput | PostOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Posts.
     */
    cursor?: PostWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Posts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Posts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Posts.
     */
    distinct?: PostScalarFieldEnum | PostScalarFieldEnum[]
  }

  /**
   * Post findMany
   */
  export type PostFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter, which Posts to fetch.
     */
    where?: PostWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Posts to fetch.
     */
    orderBy?: PostOrderByWithRelationInput | PostOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Posts.
     */
    cursor?: PostWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Posts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Posts.
     */
    skip?: number
    distinct?: PostScalarFieldEnum | PostScalarFieldEnum[]
  }

  /**
   * Post create
   */
  export type PostCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * The data needed to create a Post.
     */
    data: XOR<PostCreateInput, PostUncheckedCreateInput>
  }

  /**
   * Post createMany
   */
  export type PostCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Posts.
     */
    data: PostCreateManyInput | PostCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Post createManyAndReturn
   */
  export type PostCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * The data used to create many Posts.
     */
    data: PostCreateManyInput | PostCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Post update
   */
  export type PostUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * The data needed to update a Post.
     */
    data: XOR<PostUpdateInput, PostUncheckedUpdateInput>
    /**
     * Choose, which Post to update.
     */
    where: PostWhereUniqueInput
  }

  /**
   * Post updateMany
   */
  export type PostUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Posts.
     */
    data: XOR<PostUpdateManyMutationInput, PostUncheckedUpdateManyInput>
    /**
     * Filter which Posts to update
     */
    where?: PostWhereInput
    /**
     * Limit how many Posts to update.
     */
    limit?: number
  }

  /**
   * Post updateManyAndReturn
   */
  export type PostUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * The data used to update Posts.
     */
    data: XOR<PostUpdateManyMutationInput, PostUncheckedUpdateManyInput>
    /**
     * Filter which Posts to update
     */
    where?: PostWhereInput
    /**
     * Limit how many Posts to update.
     */
    limit?: number
  }

  /**
   * Post upsert
   */
  export type PostUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * The filter to search for the Post to update in case it exists.
     */
    where: PostWhereUniqueInput
    /**
     * In case the Post found by the `where` argument doesn't exist, create a new Post with this data.
     */
    create: XOR<PostCreateInput, PostUncheckedCreateInput>
    /**
     * In case the Post was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PostUpdateInput, PostUncheckedUpdateInput>
  }

  /**
   * Post delete
   */
  export type PostDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
    /**
     * Filter which Post to delete.
     */
    where: PostWhereUniqueInput
  }

  /**
   * Post deleteMany
   */
  export type PostDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Posts to delete
     */
    where?: PostWhereInput
    /**
     * Limit how many Posts to delete.
     */
    limit?: number
  }

  /**
   * Post.comments
   */
  export type Post$commentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    where?: CommentWhereInput
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    cursor?: CommentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CommentScalarFieldEnum | CommentScalarFieldEnum[]
  }

  /**
   * Post.votes
   */
  export type Post$votesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    where?: PostVoteWhereInput
    orderBy?: PostVoteOrderByWithRelationInput | PostVoteOrderByWithRelationInput[]
    cursor?: PostVoteWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PostVoteScalarFieldEnum | PostVoteScalarFieldEnum[]
  }

  /**
   * Post.attachments
   */
  export type Post$attachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    where?: PostAttachmentWhereInput
    orderBy?: PostAttachmentOrderByWithRelationInput | PostAttachmentOrderByWithRelationInput[]
    cursor?: PostAttachmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PostAttachmentScalarFieldEnum | PostAttachmentScalarFieldEnum[]
  }

  /**
   * Post without action
   */
  export type PostDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Post
     */
    select?: PostSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Post
     */
    omit?: PostOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostInclude<ExtArgs> | null
  }


  /**
   * Model PostAttachment
   */

  export type AggregatePostAttachment = {
    _count: PostAttachmentCountAggregateOutputType | null
    _avg: PostAttachmentAvgAggregateOutputType | null
    _sum: PostAttachmentSumAggregateOutputType | null
    _min: PostAttachmentMinAggregateOutputType | null
    _max: PostAttachmentMaxAggregateOutputType | null
  }

  export type PostAttachmentAvgAggregateOutputType = {
    file_size: number | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type PostAttachmentSumAggregateOutputType = {
    file_size: bigint | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type PostAttachmentMinAggregateOutputType = {
    id: string | null
    post_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type PostAttachmentMaxAggregateOutputType = {
    id: string | null
    post_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type PostAttachmentCountAggregateOutputType = {
    id: number
    post_id: number
    file_url: number
    file_path: number
    thumbnail_url: number
    file_name: number
    file_size: number
    mime_type: number
    file_type: number
    width: number
    height: number
    duration: number
    display_order: number
    created_at: number
    _all: number
  }


  export type PostAttachmentAvgAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type PostAttachmentSumAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type PostAttachmentMinAggregateInputType = {
    id?: true
    post_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type PostAttachmentMaxAggregateInputType = {
    id?: true
    post_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type PostAttachmentCountAggregateInputType = {
    id?: true
    post_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
    _all?: true
  }

  export type PostAttachmentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PostAttachment to aggregate.
     */
    where?: PostAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostAttachments to fetch.
     */
    orderBy?: PostAttachmentOrderByWithRelationInput | PostAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PostAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PostAttachments
    **/
    _count?: true | PostAttachmentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PostAttachmentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PostAttachmentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PostAttachmentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PostAttachmentMaxAggregateInputType
  }

  export type GetPostAttachmentAggregateType<T extends PostAttachmentAggregateArgs> = {
        [P in keyof T & keyof AggregatePostAttachment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePostAttachment[P]>
      : GetScalarType<T[P], AggregatePostAttachment[P]>
  }




  export type PostAttachmentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PostAttachmentWhereInput
    orderBy?: PostAttachmentOrderByWithAggregationInput | PostAttachmentOrderByWithAggregationInput[]
    by: PostAttachmentScalarFieldEnum[] | PostAttachmentScalarFieldEnum
    having?: PostAttachmentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PostAttachmentCountAggregateInputType | true
    _avg?: PostAttachmentAvgAggregateInputType
    _sum?: PostAttachmentSumAggregateInputType
    _min?: PostAttachmentMinAggregateInputType
    _max?: PostAttachmentMaxAggregateInputType
  }

  export type PostAttachmentGroupByOutputType = {
    id: string
    post_id: string
    file_url: string
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string
    width: number | null
    height: number | null
    duration: number | null
    display_order: number
    created_at: Date
    _count: PostAttachmentCountAggregateOutputType | null
    _avg: PostAttachmentAvgAggregateOutputType | null
    _sum: PostAttachmentSumAggregateOutputType | null
    _min: PostAttachmentMinAggregateOutputType | null
    _max: PostAttachmentMaxAggregateOutputType | null
  }

  type GetPostAttachmentGroupByPayload<T extends PostAttachmentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PostAttachmentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PostAttachmentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PostAttachmentGroupByOutputType[P]>
            : GetScalarType<T[P], PostAttachmentGroupByOutputType[P]>
        }
      >
    >


  export type PostAttachmentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postAttachment"]>

  export type PostAttachmentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postAttachment"]>

  export type PostAttachmentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postAttachment"]>

  export type PostAttachmentSelectScalar = {
    id?: boolean
    post_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
  }

  export type PostAttachmentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "post_id" | "file_url" | "file_path" | "thumbnail_url" | "file_name" | "file_size" | "mime_type" | "file_type" | "width" | "height" | "duration" | "display_order" | "created_at", ExtArgs["result"]["postAttachment"]>
  export type PostAttachmentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }
  export type PostAttachmentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }
  export type PostAttachmentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }

  export type $PostAttachmentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PostAttachment"
    objects: {
      post: Prisma.$PostPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      post_id: string
      file_url: string
      file_path: string | null
      thumbnail_url: string | null
      file_name: string | null
      file_size: bigint | null
      mime_type: string | null
      file_type: string
      width: number | null
      height: number | null
      duration: number | null
      display_order: number
      created_at: Date
    }, ExtArgs["result"]["postAttachment"]>
    composites: {}
  }

  type PostAttachmentGetPayload<S extends boolean | null | undefined | PostAttachmentDefaultArgs> = $Result.GetResult<Prisma.$PostAttachmentPayload, S>

  type PostAttachmentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PostAttachmentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PostAttachmentCountAggregateInputType | true
    }

  export interface PostAttachmentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PostAttachment'], meta: { name: 'PostAttachment' } }
    /**
     * Find zero or one PostAttachment that matches the filter.
     * @param {PostAttachmentFindUniqueArgs} args - Arguments to find a PostAttachment
     * @example
     * // Get one PostAttachment
     * const postAttachment = await prisma.postAttachment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PostAttachmentFindUniqueArgs>(args: SelectSubset<T, PostAttachmentFindUniqueArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one PostAttachment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PostAttachmentFindUniqueOrThrowArgs} args - Arguments to find a PostAttachment
     * @example
     * // Get one PostAttachment
     * const postAttachment = await prisma.postAttachment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PostAttachmentFindUniqueOrThrowArgs>(args: SelectSubset<T, PostAttachmentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PostAttachment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentFindFirstArgs} args - Arguments to find a PostAttachment
     * @example
     * // Get one PostAttachment
     * const postAttachment = await prisma.postAttachment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PostAttachmentFindFirstArgs>(args?: SelectSubset<T, PostAttachmentFindFirstArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PostAttachment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentFindFirstOrThrowArgs} args - Arguments to find a PostAttachment
     * @example
     * // Get one PostAttachment
     * const postAttachment = await prisma.postAttachment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PostAttachmentFindFirstOrThrowArgs>(args?: SelectSubset<T, PostAttachmentFindFirstOrThrowArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more PostAttachments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PostAttachments
     * const postAttachments = await prisma.postAttachment.findMany()
     * 
     * // Get first 10 PostAttachments
     * const postAttachments = await prisma.postAttachment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const postAttachmentWithIdOnly = await prisma.postAttachment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PostAttachmentFindManyArgs>(args?: SelectSubset<T, PostAttachmentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a PostAttachment.
     * @param {PostAttachmentCreateArgs} args - Arguments to create a PostAttachment.
     * @example
     * // Create one PostAttachment
     * const PostAttachment = await prisma.postAttachment.create({
     *   data: {
     *     // ... data to create a PostAttachment
     *   }
     * })
     * 
     */
    create<T extends PostAttachmentCreateArgs>(args: SelectSubset<T, PostAttachmentCreateArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many PostAttachments.
     * @param {PostAttachmentCreateManyArgs} args - Arguments to create many PostAttachments.
     * @example
     * // Create many PostAttachments
     * const postAttachment = await prisma.postAttachment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PostAttachmentCreateManyArgs>(args?: SelectSubset<T, PostAttachmentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PostAttachments and returns the data saved in the database.
     * @param {PostAttachmentCreateManyAndReturnArgs} args - Arguments to create many PostAttachments.
     * @example
     * // Create many PostAttachments
     * const postAttachment = await prisma.postAttachment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PostAttachments and only return the `id`
     * const postAttachmentWithIdOnly = await prisma.postAttachment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PostAttachmentCreateManyAndReturnArgs>(args?: SelectSubset<T, PostAttachmentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a PostAttachment.
     * @param {PostAttachmentDeleteArgs} args - Arguments to delete one PostAttachment.
     * @example
     * // Delete one PostAttachment
     * const PostAttachment = await prisma.postAttachment.delete({
     *   where: {
     *     // ... filter to delete one PostAttachment
     *   }
     * })
     * 
     */
    delete<T extends PostAttachmentDeleteArgs>(args: SelectSubset<T, PostAttachmentDeleteArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one PostAttachment.
     * @param {PostAttachmentUpdateArgs} args - Arguments to update one PostAttachment.
     * @example
     * // Update one PostAttachment
     * const postAttachment = await prisma.postAttachment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PostAttachmentUpdateArgs>(args: SelectSubset<T, PostAttachmentUpdateArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more PostAttachments.
     * @param {PostAttachmentDeleteManyArgs} args - Arguments to filter PostAttachments to delete.
     * @example
     * // Delete a few PostAttachments
     * const { count } = await prisma.postAttachment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PostAttachmentDeleteManyArgs>(args?: SelectSubset<T, PostAttachmentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PostAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PostAttachments
     * const postAttachment = await prisma.postAttachment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PostAttachmentUpdateManyArgs>(args: SelectSubset<T, PostAttachmentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PostAttachments and returns the data updated in the database.
     * @param {PostAttachmentUpdateManyAndReturnArgs} args - Arguments to update many PostAttachments.
     * @example
     * // Update many PostAttachments
     * const postAttachment = await prisma.postAttachment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more PostAttachments and only return the `id`
     * const postAttachmentWithIdOnly = await prisma.postAttachment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PostAttachmentUpdateManyAndReturnArgs>(args: SelectSubset<T, PostAttachmentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one PostAttachment.
     * @param {PostAttachmentUpsertArgs} args - Arguments to update or create a PostAttachment.
     * @example
     * // Update or create a PostAttachment
     * const postAttachment = await prisma.postAttachment.upsert({
     *   create: {
     *     // ... data to create a PostAttachment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PostAttachment we want to update
     *   }
     * })
     */
    upsert<T extends PostAttachmentUpsertArgs>(args: SelectSubset<T, PostAttachmentUpsertArgs<ExtArgs>>): Prisma__PostAttachmentClient<$Result.GetResult<Prisma.$PostAttachmentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of PostAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentCountArgs} args - Arguments to filter PostAttachments to count.
     * @example
     * // Count the number of PostAttachments
     * const count = await prisma.postAttachment.count({
     *   where: {
     *     // ... the filter for the PostAttachments we want to count
     *   }
     * })
    **/
    count<T extends PostAttachmentCountArgs>(
      args?: Subset<T, PostAttachmentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PostAttachmentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PostAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PostAttachmentAggregateArgs>(args: Subset<T, PostAttachmentAggregateArgs>): Prisma.PrismaPromise<GetPostAttachmentAggregateType<T>>

    /**
     * Group by PostAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostAttachmentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PostAttachmentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PostAttachmentGroupByArgs['orderBy'] }
        : { orderBy?: PostAttachmentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PostAttachmentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPostAttachmentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PostAttachment model
   */
  readonly fields: PostAttachmentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PostAttachment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PostAttachmentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    post<T extends PostDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PostDefaultArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PostAttachment model
   */
  interface PostAttachmentFieldRefs {
    readonly id: FieldRef<"PostAttachment", 'String'>
    readonly post_id: FieldRef<"PostAttachment", 'String'>
    readonly file_url: FieldRef<"PostAttachment", 'String'>
    readonly file_path: FieldRef<"PostAttachment", 'String'>
    readonly thumbnail_url: FieldRef<"PostAttachment", 'String'>
    readonly file_name: FieldRef<"PostAttachment", 'String'>
    readonly file_size: FieldRef<"PostAttachment", 'BigInt'>
    readonly mime_type: FieldRef<"PostAttachment", 'String'>
    readonly file_type: FieldRef<"PostAttachment", 'String'>
    readonly width: FieldRef<"PostAttachment", 'Int'>
    readonly height: FieldRef<"PostAttachment", 'Int'>
    readonly duration: FieldRef<"PostAttachment", 'Int'>
    readonly display_order: FieldRef<"PostAttachment", 'Int'>
    readonly created_at: FieldRef<"PostAttachment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PostAttachment findUnique
   */
  export type PostAttachmentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which PostAttachment to fetch.
     */
    where: PostAttachmentWhereUniqueInput
  }

  /**
   * PostAttachment findUniqueOrThrow
   */
  export type PostAttachmentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which PostAttachment to fetch.
     */
    where: PostAttachmentWhereUniqueInput
  }

  /**
   * PostAttachment findFirst
   */
  export type PostAttachmentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which PostAttachment to fetch.
     */
    where?: PostAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostAttachments to fetch.
     */
    orderBy?: PostAttachmentOrderByWithRelationInput | PostAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PostAttachments.
     */
    cursor?: PostAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PostAttachments.
     */
    distinct?: PostAttachmentScalarFieldEnum | PostAttachmentScalarFieldEnum[]
  }

  /**
   * PostAttachment findFirstOrThrow
   */
  export type PostAttachmentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which PostAttachment to fetch.
     */
    where?: PostAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostAttachments to fetch.
     */
    orderBy?: PostAttachmentOrderByWithRelationInput | PostAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PostAttachments.
     */
    cursor?: PostAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PostAttachments.
     */
    distinct?: PostAttachmentScalarFieldEnum | PostAttachmentScalarFieldEnum[]
  }

  /**
   * PostAttachment findMany
   */
  export type PostAttachmentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which PostAttachments to fetch.
     */
    where?: PostAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostAttachments to fetch.
     */
    orderBy?: PostAttachmentOrderByWithRelationInput | PostAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PostAttachments.
     */
    cursor?: PostAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostAttachments.
     */
    skip?: number
    distinct?: PostAttachmentScalarFieldEnum | PostAttachmentScalarFieldEnum[]
  }

  /**
   * PostAttachment create
   */
  export type PostAttachmentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to create a PostAttachment.
     */
    data: XOR<PostAttachmentCreateInput, PostAttachmentUncheckedCreateInput>
  }

  /**
   * PostAttachment createMany
   */
  export type PostAttachmentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PostAttachments.
     */
    data: PostAttachmentCreateManyInput | PostAttachmentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PostAttachment createManyAndReturn
   */
  export type PostAttachmentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * The data used to create many PostAttachments.
     */
    data: PostAttachmentCreateManyInput | PostAttachmentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PostAttachment update
   */
  export type PostAttachmentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to update a PostAttachment.
     */
    data: XOR<PostAttachmentUpdateInput, PostAttachmentUncheckedUpdateInput>
    /**
     * Choose, which PostAttachment to update.
     */
    where: PostAttachmentWhereUniqueInput
  }

  /**
   * PostAttachment updateMany
   */
  export type PostAttachmentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PostAttachments.
     */
    data: XOR<PostAttachmentUpdateManyMutationInput, PostAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which PostAttachments to update
     */
    where?: PostAttachmentWhereInput
    /**
     * Limit how many PostAttachments to update.
     */
    limit?: number
  }

  /**
   * PostAttachment updateManyAndReturn
   */
  export type PostAttachmentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * The data used to update PostAttachments.
     */
    data: XOR<PostAttachmentUpdateManyMutationInput, PostAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which PostAttachments to update
     */
    where?: PostAttachmentWhereInput
    /**
     * Limit how many PostAttachments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * PostAttachment upsert
   */
  export type PostAttachmentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * The filter to search for the PostAttachment to update in case it exists.
     */
    where: PostAttachmentWhereUniqueInput
    /**
     * In case the PostAttachment found by the `where` argument doesn't exist, create a new PostAttachment with this data.
     */
    create: XOR<PostAttachmentCreateInput, PostAttachmentUncheckedCreateInput>
    /**
     * In case the PostAttachment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PostAttachmentUpdateInput, PostAttachmentUncheckedUpdateInput>
  }

  /**
   * PostAttachment delete
   */
  export type PostAttachmentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
    /**
     * Filter which PostAttachment to delete.
     */
    where: PostAttachmentWhereUniqueInput
  }

  /**
   * PostAttachment deleteMany
   */
  export type PostAttachmentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PostAttachments to delete
     */
    where?: PostAttachmentWhereInput
    /**
     * Limit how many PostAttachments to delete.
     */
    limit?: number
  }

  /**
   * PostAttachment without action
   */
  export type PostAttachmentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostAttachment
     */
    select?: PostAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostAttachment
     */
    omit?: PostAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostAttachmentInclude<ExtArgs> | null
  }


  /**
   * Model Comment
   */

  export type AggregateComment = {
    _count: CommentCountAggregateOutputType | null
    _avg: CommentAvgAggregateOutputType | null
    _sum: CommentSumAggregateOutputType | null
    _min: CommentMinAggregateOutputType | null
    _max: CommentMaxAggregateOutputType | null
  }

  export type CommentAvgAggregateOutputType = {
    upvotes: number | null
    downvotes: number | null
  }

  export type CommentSumAggregateOutputType = {
    upvotes: number | null
    downvotes: number | null
  }

  export type CommentMinAggregateOutputType = {
    id: string | null
    post_id: string | null
    user_id: string | null
    parent_id: string | null
    content: string | null
    upvotes: number | null
    downvotes: number | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type CommentMaxAggregateOutputType = {
    id: string | null
    post_id: string | null
    user_id: string | null
    parent_id: string | null
    content: string | null
    upvotes: number | null
    downvotes: number | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type CommentCountAggregateOutputType = {
    id: number
    post_id: number
    user_id: number
    parent_id: number
    content: number
    upvotes: number
    downvotes: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type CommentAvgAggregateInputType = {
    upvotes?: true
    downvotes?: true
  }

  export type CommentSumAggregateInputType = {
    upvotes?: true
    downvotes?: true
  }

  export type CommentMinAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    parent_id?: true
    content?: true
    upvotes?: true
    downvotes?: true
    created_at?: true
    updated_at?: true
  }

  export type CommentMaxAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    parent_id?: true
    content?: true
    upvotes?: true
    downvotes?: true
    created_at?: true
    updated_at?: true
  }

  export type CommentCountAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    parent_id?: true
    content?: true
    upvotes?: true
    downvotes?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type CommentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Comment to aggregate.
     */
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     */
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Comments
    **/
    _count?: true | CommentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: CommentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: CommentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CommentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CommentMaxAggregateInputType
  }

  export type GetCommentAggregateType<T extends CommentAggregateArgs> = {
        [P in keyof T & keyof AggregateComment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateComment[P]>
      : GetScalarType<T[P], AggregateComment[P]>
  }




  export type CommentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentWhereInput
    orderBy?: CommentOrderByWithAggregationInput | CommentOrderByWithAggregationInput[]
    by: CommentScalarFieldEnum[] | CommentScalarFieldEnum
    having?: CommentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CommentCountAggregateInputType | true
    _avg?: CommentAvgAggregateInputType
    _sum?: CommentSumAggregateInputType
    _min?: CommentMinAggregateInputType
    _max?: CommentMaxAggregateInputType
  }

  export type CommentGroupByOutputType = {
    id: string
    post_id: string
    user_id: string
    parent_id: string | null
    content: string
    upvotes: number
    downvotes: number
    created_at: Date
    updated_at: Date
    _count: CommentCountAggregateOutputType | null
    _avg: CommentAvgAggregateOutputType | null
    _sum: CommentSumAggregateOutputType | null
    _min: CommentMinAggregateOutputType | null
    _max: CommentMaxAggregateOutputType | null
  }

  type GetCommentGroupByPayload<T extends CommentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<CommentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CommentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CommentGroupByOutputType[P]>
            : GetScalarType<T[P], CommentGroupByOutputType[P]>
        }
      >
    >


  export type CommentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    parent_id?: boolean
    content?: boolean
    upvotes?: boolean
    downvotes?: boolean
    created_at?: boolean
    updated_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
    replies?: boolean | Comment$repliesArgs<ExtArgs>
    votes?: boolean | Comment$votesArgs<ExtArgs>
    attachments?: boolean | Comment$attachmentsArgs<ExtArgs>
    _count?: boolean | CommentCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["comment"]>

  export type CommentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    parent_id?: boolean
    content?: boolean
    upvotes?: boolean
    downvotes?: boolean
    created_at?: boolean
    updated_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
  }, ExtArgs["result"]["comment"]>

  export type CommentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    parent_id?: boolean
    content?: boolean
    upvotes?: boolean
    downvotes?: boolean
    created_at?: boolean
    updated_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
  }, ExtArgs["result"]["comment"]>

  export type CommentSelectScalar = {
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    parent_id?: boolean
    content?: boolean
    upvotes?: boolean
    downvotes?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type CommentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "post_id" | "user_id" | "parent_id" | "content" | "upvotes" | "downvotes" | "created_at" | "updated_at", ExtArgs["result"]["comment"]>
  export type CommentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
    replies?: boolean | Comment$repliesArgs<ExtArgs>
    votes?: boolean | Comment$votesArgs<ExtArgs>
    attachments?: boolean | Comment$attachmentsArgs<ExtArgs>
    _count?: boolean | CommentCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type CommentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
  }
  export type CommentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
    parent?: boolean | Comment$parentArgs<ExtArgs>
  }

  export type $CommentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Comment"
    objects: {
      post: Prisma.$PostPayload<ExtArgs>
      parent: Prisma.$CommentPayload<ExtArgs> | null
      replies: Prisma.$CommentPayload<ExtArgs>[]
      votes: Prisma.$CommentVotePayload<ExtArgs>[]
      attachments: Prisma.$CommentAttachmentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      post_id: string
      user_id: string
      parent_id: string | null
      content: string
      upvotes: number
      downvotes: number
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["comment"]>
    composites: {}
  }

  type CommentGetPayload<S extends boolean | null | undefined | CommentDefaultArgs> = $Result.GetResult<Prisma.$CommentPayload, S>

  type CommentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<CommentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: CommentCountAggregateInputType | true
    }

  export interface CommentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Comment'], meta: { name: 'Comment' } }
    /**
     * Find zero or one Comment that matches the filter.
     * @param {CommentFindUniqueArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends CommentFindUniqueArgs>(args: SelectSubset<T, CommentFindUniqueArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Comment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {CommentFindUniqueOrThrowArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends CommentFindUniqueOrThrowArgs>(args: SelectSubset<T, CommentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Comment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindFirstArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends CommentFindFirstArgs>(args?: SelectSubset<T, CommentFindFirstArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Comment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindFirstOrThrowArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends CommentFindFirstOrThrowArgs>(args?: SelectSubset<T, CommentFindFirstOrThrowArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Comments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Comments
     * const comments = await prisma.comment.findMany()
     * 
     * // Get first 10 Comments
     * const comments = await prisma.comment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const commentWithIdOnly = await prisma.comment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends CommentFindManyArgs>(args?: SelectSubset<T, CommentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Comment.
     * @param {CommentCreateArgs} args - Arguments to create a Comment.
     * @example
     * // Create one Comment
     * const Comment = await prisma.comment.create({
     *   data: {
     *     // ... data to create a Comment
     *   }
     * })
     * 
     */
    create<T extends CommentCreateArgs>(args: SelectSubset<T, CommentCreateArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Comments.
     * @param {CommentCreateManyArgs} args - Arguments to create many Comments.
     * @example
     * // Create many Comments
     * const comment = await prisma.comment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends CommentCreateManyArgs>(args?: SelectSubset<T, CommentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Comments and returns the data saved in the database.
     * @param {CommentCreateManyAndReturnArgs} args - Arguments to create many Comments.
     * @example
     * // Create many Comments
     * const comment = await prisma.comment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Comments and only return the `id`
     * const commentWithIdOnly = await prisma.comment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends CommentCreateManyAndReturnArgs>(args?: SelectSubset<T, CommentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Comment.
     * @param {CommentDeleteArgs} args - Arguments to delete one Comment.
     * @example
     * // Delete one Comment
     * const Comment = await prisma.comment.delete({
     *   where: {
     *     // ... filter to delete one Comment
     *   }
     * })
     * 
     */
    delete<T extends CommentDeleteArgs>(args: SelectSubset<T, CommentDeleteArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Comment.
     * @param {CommentUpdateArgs} args - Arguments to update one Comment.
     * @example
     * // Update one Comment
     * const comment = await prisma.comment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends CommentUpdateArgs>(args: SelectSubset<T, CommentUpdateArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Comments.
     * @param {CommentDeleteManyArgs} args - Arguments to filter Comments to delete.
     * @example
     * // Delete a few Comments
     * const { count } = await prisma.comment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends CommentDeleteManyArgs>(args?: SelectSubset<T, CommentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Comments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Comments
     * const comment = await prisma.comment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends CommentUpdateManyArgs>(args: SelectSubset<T, CommentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Comments and returns the data updated in the database.
     * @param {CommentUpdateManyAndReturnArgs} args - Arguments to update many Comments.
     * @example
     * // Update many Comments
     * const comment = await prisma.comment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Comments and only return the `id`
     * const commentWithIdOnly = await prisma.comment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends CommentUpdateManyAndReturnArgs>(args: SelectSubset<T, CommentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Comment.
     * @param {CommentUpsertArgs} args - Arguments to update or create a Comment.
     * @example
     * // Update or create a Comment
     * const comment = await prisma.comment.upsert({
     *   create: {
     *     // ... data to create a Comment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Comment we want to update
     *   }
     * })
     */
    upsert<T extends CommentUpsertArgs>(args: SelectSubset<T, CommentUpsertArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Comments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentCountArgs} args - Arguments to filter Comments to count.
     * @example
     * // Count the number of Comments
     * const count = await prisma.comment.count({
     *   where: {
     *     // ... the filter for the Comments we want to count
     *   }
     * })
    **/
    count<T extends CommentCountArgs>(
      args?: Subset<T, CommentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CommentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Comment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CommentAggregateArgs>(args: Subset<T, CommentAggregateArgs>): Prisma.PrismaPromise<GetCommentAggregateType<T>>

    /**
     * Group by Comment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CommentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CommentGroupByArgs['orderBy'] }
        : { orderBy?: CommentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CommentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCommentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Comment model
   */
  readonly fields: CommentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Comment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__CommentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    post<T extends PostDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PostDefaultArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    parent<T extends Comment$parentArgs<ExtArgs> = {}>(args?: Subset<T, Comment$parentArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    replies<T extends Comment$repliesArgs<ExtArgs> = {}>(args?: Subset<T, Comment$repliesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    votes<T extends Comment$votesArgs<ExtArgs> = {}>(args?: Subset<T, Comment$votesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    attachments<T extends Comment$attachmentsArgs<ExtArgs> = {}>(args?: Subset<T, Comment$attachmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Comment model
   */
  interface CommentFieldRefs {
    readonly id: FieldRef<"Comment", 'String'>
    readonly post_id: FieldRef<"Comment", 'String'>
    readonly user_id: FieldRef<"Comment", 'String'>
    readonly parent_id: FieldRef<"Comment", 'String'>
    readonly content: FieldRef<"Comment", 'String'>
    readonly upvotes: FieldRef<"Comment", 'Int'>
    readonly downvotes: FieldRef<"Comment", 'Int'>
    readonly created_at: FieldRef<"Comment", 'DateTime'>
    readonly updated_at: FieldRef<"Comment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Comment findUnique
   */
  export type CommentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter, which Comment to fetch.
     */
    where: CommentWhereUniqueInput
  }

  /**
   * Comment findUniqueOrThrow
   */
  export type CommentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter, which Comment to fetch.
     */
    where: CommentWhereUniqueInput
  }

  /**
   * Comment findFirst
   */
  export type CommentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter, which Comment to fetch.
     */
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     */
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Comments.
     */
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Comments.
     */
    distinct?: CommentScalarFieldEnum | CommentScalarFieldEnum[]
  }

  /**
   * Comment findFirstOrThrow
   */
  export type CommentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter, which Comment to fetch.
     */
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     */
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Comments.
     */
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Comments.
     */
    distinct?: CommentScalarFieldEnum | CommentScalarFieldEnum[]
  }

  /**
   * Comment findMany
   */
  export type CommentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter, which Comments to fetch.
     */
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     */
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Comments.
     */
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     */
    skip?: number
    distinct?: CommentScalarFieldEnum | CommentScalarFieldEnum[]
  }

  /**
   * Comment create
   */
  export type CommentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * The data needed to create a Comment.
     */
    data: XOR<CommentCreateInput, CommentUncheckedCreateInput>
  }

  /**
   * Comment createMany
   */
  export type CommentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Comments.
     */
    data: CommentCreateManyInput | CommentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Comment createManyAndReturn
   */
  export type CommentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * The data used to create many Comments.
     */
    data: CommentCreateManyInput | CommentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Comment update
   */
  export type CommentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * The data needed to update a Comment.
     */
    data: XOR<CommentUpdateInput, CommentUncheckedUpdateInput>
    /**
     * Choose, which Comment to update.
     */
    where: CommentWhereUniqueInput
  }

  /**
   * Comment updateMany
   */
  export type CommentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Comments.
     */
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyInput>
    /**
     * Filter which Comments to update
     */
    where?: CommentWhereInput
    /**
     * Limit how many Comments to update.
     */
    limit?: number
  }

  /**
   * Comment updateManyAndReturn
   */
  export type CommentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * The data used to update Comments.
     */
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyInput>
    /**
     * Filter which Comments to update
     */
    where?: CommentWhereInput
    /**
     * Limit how many Comments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Comment upsert
   */
  export type CommentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * The filter to search for the Comment to update in case it exists.
     */
    where: CommentWhereUniqueInput
    /**
     * In case the Comment found by the `where` argument doesn't exist, create a new Comment with this data.
     */
    create: XOR<CommentCreateInput, CommentUncheckedCreateInput>
    /**
     * In case the Comment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<CommentUpdateInput, CommentUncheckedUpdateInput>
  }

  /**
   * Comment delete
   */
  export type CommentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    /**
     * Filter which Comment to delete.
     */
    where: CommentWhereUniqueInput
  }

  /**
   * Comment deleteMany
   */
  export type CommentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Comments to delete
     */
    where?: CommentWhereInput
    /**
     * Limit how many Comments to delete.
     */
    limit?: number
  }

  /**
   * Comment.parent
   */
  export type Comment$parentArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    where?: CommentWhereInput
  }

  /**
   * Comment.replies
   */
  export type Comment$repliesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
    where?: CommentWhereInput
    orderBy?: CommentOrderByWithRelationInput | CommentOrderByWithRelationInput[]
    cursor?: CommentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CommentScalarFieldEnum | CommentScalarFieldEnum[]
  }

  /**
   * Comment.votes
   */
  export type Comment$votesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    where?: CommentVoteWhereInput
    orderBy?: CommentVoteOrderByWithRelationInput | CommentVoteOrderByWithRelationInput[]
    cursor?: CommentVoteWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CommentVoteScalarFieldEnum | CommentVoteScalarFieldEnum[]
  }

  /**
   * Comment.attachments
   */
  export type Comment$attachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    where?: CommentAttachmentWhereInput
    orderBy?: CommentAttachmentOrderByWithRelationInput | CommentAttachmentOrderByWithRelationInput[]
    cursor?: CommentAttachmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CommentAttachmentScalarFieldEnum | CommentAttachmentScalarFieldEnum[]
  }

  /**
   * Comment without action
   */
  export type CommentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Comment
     */
    select?: CommentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Comment
     */
    omit?: CommentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentInclude<ExtArgs> | null
  }


  /**
   * Model CommentAttachment
   */

  export type AggregateCommentAttachment = {
    _count: CommentAttachmentCountAggregateOutputType | null
    _avg: CommentAttachmentAvgAggregateOutputType | null
    _sum: CommentAttachmentSumAggregateOutputType | null
    _min: CommentAttachmentMinAggregateOutputType | null
    _max: CommentAttachmentMaxAggregateOutputType | null
  }

  export type CommentAttachmentAvgAggregateOutputType = {
    file_size: number | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type CommentAttachmentSumAggregateOutputType = {
    file_size: bigint | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type CommentAttachmentMinAggregateOutputType = {
    id: string | null
    comment_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type CommentAttachmentMaxAggregateOutputType = {
    id: string | null
    comment_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type CommentAttachmentCountAggregateOutputType = {
    id: number
    comment_id: number
    file_url: number
    file_path: number
    thumbnail_url: number
    file_name: number
    file_size: number
    mime_type: number
    file_type: number
    width: number
    height: number
    duration: number
    display_order: number
    created_at: number
    _all: number
  }


  export type CommentAttachmentAvgAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type CommentAttachmentSumAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type CommentAttachmentMinAggregateInputType = {
    id?: true
    comment_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type CommentAttachmentMaxAggregateInputType = {
    id?: true
    comment_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type CommentAttachmentCountAggregateInputType = {
    id?: true
    comment_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
    _all?: true
  }

  export type CommentAttachmentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CommentAttachment to aggregate.
     */
    where?: CommentAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentAttachments to fetch.
     */
    orderBy?: CommentAttachmentOrderByWithRelationInput | CommentAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: CommentAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned CommentAttachments
    **/
    _count?: true | CommentAttachmentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: CommentAttachmentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: CommentAttachmentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CommentAttachmentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CommentAttachmentMaxAggregateInputType
  }

  export type GetCommentAttachmentAggregateType<T extends CommentAttachmentAggregateArgs> = {
        [P in keyof T & keyof AggregateCommentAttachment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateCommentAttachment[P]>
      : GetScalarType<T[P], AggregateCommentAttachment[P]>
  }




  export type CommentAttachmentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentAttachmentWhereInput
    orderBy?: CommentAttachmentOrderByWithAggregationInput | CommentAttachmentOrderByWithAggregationInput[]
    by: CommentAttachmentScalarFieldEnum[] | CommentAttachmentScalarFieldEnum
    having?: CommentAttachmentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CommentAttachmentCountAggregateInputType | true
    _avg?: CommentAttachmentAvgAggregateInputType
    _sum?: CommentAttachmentSumAggregateInputType
    _min?: CommentAttachmentMinAggregateInputType
    _max?: CommentAttachmentMaxAggregateInputType
  }

  export type CommentAttachmentGroupByOutputType = {
    id: string
    comment_id: string
    file_url: string
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string
    width: number | null
    height: number | null
    duration: number | null
    display_order: number
    created_at: Date
    _count: CommentAttachmentCountAggregateOutputType | null
    _avg: CommentAttachmentAvgAggregateOutputType | null
    _sum: CommentAttachmentSumAggregateOutputType | null
    _min: CommentAttachmentMinAggregateOutputType | null
    _max: CommentAttachmentMaxAggregateOutputType | null
  }

  type GetCommentAttachmentGroupByPayload<T extends CommentAttachmentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<CommentAttachmentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CommentAttachmentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CommentAttachmentGroupByOutputType[P]>
            : GetScalarType<T[P], CommentAttachmentGroupByOutputType[P]>
        }
      >
    >


  export type CommentAttachmentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentAttachment"]>

  export type CommentAttachmentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentAttachment"]>

  export type CommentAttachmentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentAttachment"]>

  export type CommentAttachmentSelectScalar = {
    id?: boolean
    comment_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
  }

  export type CommentAttachmentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "comment_id" | "file_url" | "file_path" | "thumbnail_url" | "file_name" | "file_size" | "mime_type" | "file_type" | "width" | "height" | "duration" | "display_order" | "created_at", ExtArgs["result"]["commentAttachment"]>
  export type CommentAttachmentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }
  export type CommentAttachmentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }
  export type CommentAttachmentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }

  export type $CommentAttachmentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "CommentAttachment"
    objects: {
      comment: Prisma.$CommentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      comment_id: string
      file_url: string
      file_path: string | null
      thumbnail_url: string | null
      file_name: string | null
      file_size: bigint | null
      mime_type: string | null
      file_type: string
      width: number | null
      height: number | null
      duration: number | null
      display_order: number
      created_at: Date
    }, ExtArgs["result"]["commentAttachment"]>
    composites: {}
  }

  type CommentAttachmentGetPayload<S extends boolean | null | undefined | CommentAttachmentDefaultArgs> = $Result.GetResult<Prisma.$CommentAttachmentPayload, S>

  type CommentAttachmentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<CommentAttachmentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: CommentAttachmentCountAggregateInputType | true
    }

  export interface CommentAttachmentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['CommentAttachment'], meta: { name: 'CommentAttachment' } }
    /**
     * Find zero or one CommentAttachment that matches the filter.
     * @param {CommentAttachmentFindUniqueArgs} args - Arguments to find a CommentAttachment
     * @example
     * // Get one CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends CommentAttachmentFindUniqueArgs>(args: SelectSubset<T, CommentAttachmentFindUniqueArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one CommentAttachment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {CommentAttachmentFindUniqueOrThrowArgs} args - Arguments to find a CommentAttachment
     * @example
     * // Get one CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends CommentAttachmentFindUniqueOrThrowArgs>(args: SelectSubset<T, CommentAttachmentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CommentAttachment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentFindFirstArgs} args - Arguments to find a CommentAttachment
     * @example
     * // Get one CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends CommentAttachmentFindFirstArgs>(args?: SelectSubset<T, CommentAttachmentFindFirstArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CommentAttachment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentFindFirstOrThrowArgs} args - Arguments to find a CommentAttachment
     * @example
     * // Get one CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends CommentAttachmentFindFirstOrThrowArgs>(args?: SelectSubset<T, CommentAttachmentFindFirstOrThrowArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more CommentAttachments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all CommentAttachments
     * const commentAttachments = await prisma.commentAttachment.findMany()
     * 
     * // Get first 10 CommentAttachments
     * const commentAttachments = await prisma.commentAttachment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const commentAttachmentWithIdOnly = await prisma.commentAttachment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends CommentAttachmentFindManyArgs>(args?: SelectSubset<T, CommentAttachmentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a CommentAttachment.
     * @param {CommentAttachmentCreateArgs} args - Arguments to create a CommentAttachment.
     * @example
     * // Create one CommentAttachment
     * const CommentAttachment = await prisma.commentAttachment.create({
     *   data: {
     *     // ... data to create a CommentAttachment
     *   }
     * })
     * 
     */
    create<T extends CommentAttachmentCreateArgs>(args: SelectSubset<T, CommentAttachmentCreateArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many CommentAttachments.
     * @param {CommentAttachmentCreateManyArgs} args - Arguments to create many CommentAttachments.
     * @example
     * // Create many CommentAttachments
     * const commentAttachment = await prisma.commentAttachment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends CommentAttachmentCreateManyArgs>(args?: SelectSubset<T, CommentAttachmentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many CommentAttachments and returns the data saved in the database.
     * @param {CommentAttachmentCreateManyAndReturnArgs} args - Arguments to create many CommentAttachments.
     * @example
     * // Create many CommentAttachments
     * const commentAttachment = await prisma.commentAttachment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many CommentAttachments and only return the `id`
     * const commentAttachmentWithIdOnly = await prisma.commentAttachment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends CommentAttachmentCreateManyAndReturnArgs>(args?: SelectSubset<T, CommentAttachmentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a CommentAttachment.
     * @param {CommentAttachmentDeleteArgs} args - Arguments to delete one CommentAttachment.
     * @example
     * // Delete one CommentAttachment
     * const CommentAttachment = await prisma.commentAttachment.delete({
     *   where: {
     *     // ... filter to delete one CommentAttachment
     *   }
     * })
     * 
     */
    delete<T extends CommentAttachmentDeleteArgs>(args: SelectSubset<T, CommentAttachmentDeleteArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one CommentAttachment.
     * @param {CommentAttachmentUpdateArgs} args - Arguments to update one CommentAttachment.
     * @example
     * // Update one CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends CommentAttachmentUpdateArgs>(args: SelectSubset<T, CommentAttachmentUpdateArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more CommentAttachments.
     * @param {CommentAttachmentDeleteManyArgs} args - Arguments to filter CommentAttachments to delete.
     * @example
     * // Delete a few CommentAttachments
     * const { count } = await prisma.commentAttachment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends CommentAttachmentDeleteManyArgs>(args?: SelectSubset<T, CommentAttachmentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CommentAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many CommentAttachments
     * const commentAttachment = await prisma.commentAttachment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends CommentAttachmentUpdateManyArgs>(args: SelectSubset<T, CommentAttachmentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CommentAttachments and returns the data updated in the database.
     * @param {CommentAttachmentUpdateManyAndReturnArgs} args - Arguments to update many CommentAttachments.
     * @example
     * // Update many CommentAttachments
     * const commentAttachment = await prisma.commentAttachment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more CommentAttachments and only return the `id`
     * const commentAttachmentWithIdOnly = await prisma.commentAttachment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends CommentAttachmentUpdateManyAndReturnArgs>(args: SelectSubset<T, CommentAttachmentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one CommentAttachment.
     * @param {CommentAttachmentUpsertArgs} args - Arguments to update or create a CommentAttachment.
     * @example
     * // Update or create a CommentAttachment
     * const commentAttachment = await prisma.commentAttachment.upsert({
     *   create: {
     *     // ... data to create a CommentAttachment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the CommentAttachment we want to update
     *   }
     * })
     */
    upsert<T extends CommentAttachmentUpsertArgs>(args: SelectSubset<T, CommentAttachmentUpsertArgs<ExtArgs>>): Prisma__CommentAttachmentClient<$Result.GetResult<Prisma.$CommentAttachmentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of CommentAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentCountArgs} args - Arguments to filter CommentAttachments to count.
     * @example
     * // Count the number of CommentAttachments
     * const count = await prisma.commentAttachment.count({
     *   where: {
     *     // ... the filter for the CommentAttachments we want to count
     *   }
     * })
    **/
    count<T extends CommentAttachmentCountArgs>(
      args?: Subset<T, CommentAttachmentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CommentAttachmentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a CommentAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CommentAttachmentAggregateArgs>(args: Subset<T, CommentAttachmentAggregateArgs>): Prisma.PrismaPromise<GetCommentAttachmentAggregateType<T>>

    /**
     * Group by CommentAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAttachmentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CommentAttachmentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CommentAttachmentGroupByArgs['orderBy'] }
        : { orderBy?: CommentAttachmentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CommentAttachmentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCommentAttachmentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the CommentAttachment model
   */
  readonly fields: CommentAttachmentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for CommentAttachment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__CommentAttachmentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    comment<T extends CommentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, CommentDefaultArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the CommentAttachment model
   */
  interface CommentAttachmentFieldRefs {
    readonly id: FieldRef<"CommentAttachment", 'String'>
    readonly comment_id: FieldRef<"CommentAttachment", 'String'>
    readonly file_url: FieldRef<"CommentAttachment", 'String'>
    readonly file_path: FieldRef<"CommentAttachment", 'String'>
    readonly thumbnail_url: FieldRef<"CommentAttachment", 'String'>
    readonly file_name: FieldRef<"CommentAttachment", 'String'>
    readonly file_size: FieldRef<"CommentAttachment", 'BigInt'>
    readonly mime_type: FieldRef<"CommentAttachment", 'String'>
    readonly file_type: FieldRef<"CommentAttachment", 'String'>
    readonly width: FieldRef<"CommentAttachment", 'Int'>
    readonly height: FieldRef<"CommentAttachment", 'Int'>
    readonly duration: FieldRef<"CommentAttachment", 'Int'>
    readonly display_order: FieldRef<"CommentAttachment", 'Int'>
    readonly created_at: FieldRef<"CommentAttachment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * CommentAttachment findUnique
   */
  export type CommentAttachmentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which CommentAttachment to fetch.
     */
    where: CommentAttachmentWhereUniqueInput
  }

  /**
   * CommentAttachment findUniqueOrThrow
   */
  export type CommentAttachmentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which CommentAttachment to fetch.
     */
    where: CommentAttachmentWhereUniqueInput
  }

  /**
   * CommentAttachment findFirst
   */
  export type CommentAttachmentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which CommentAttachment to fetch.
     */
    where?: CommentAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentAttachments to fetch.
     */
    orderBy?: CommentAttachmentOrderByWithRelationInput | CommentAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CommentAttachments.
     */
    cursor?: CommentAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CommentAttachments.
     */
    distinct?: CommentAttachmentScalarFieldEnum | CommentAttachmentScalarFieldEnum[]
  }

  /**
   * CommentAttachment findFirstOrThrow
   */
  export type CommentAttachmentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which CommentAttachment to fetch.
     */
    where?: CommentAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentAttachments to fetch.
     */
    orderBy?: CommentAttachmentOrderByWithRelationInput | CommentAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CommentAttachments.
     */
    cursor?: CommentAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CommentAttachments.
     */
    distinct?: CommentAttachmentScalarFieldEnum | CommentAttachmentScalarFieldEnum[]
  }

  /**
   * CommentAttachment findMany
   */
  export type CommentAttachmentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which CommentAttachments to fetch.
     */
    where?: CommentAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentAttachments to fetch.
     */
    orderBy?: CommentAttachmentOrderByWithRelationInput | CommentAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing CommentAttachments.
     */
    cursor?: CommentAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentAttachments.
     */
    skip?: number
    distinct?: CommentAttachmentScalarFieldEnum | CommentAttachmentScalarFieldEnum[]
  }

  /**
   * CommentAttachment create
   */
  export type CommentAttachmentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to create a CommentAttachment.
     */
    data: XOR<CommentAttachmentCreateInput, CommentAttachmentUncheckedCreateInput>
  }

  /**
   * CommentAttachment createMany
   */
  export type CommentAttachmentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many CommentAttachments.
     */
    data: CommentAttachmentCreateManyInput | CommentAttachmentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * CommentAttachment createManyAndReturn
   */
  export type CommentAttachmentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * The data used to create many CommentAttachments.
     */
    data: CommentAttachmentCreateManyInput | CommentAttachmentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * CommentAttachment update
   */
  export type CommentAttachmentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to update a CommentAttachment.
     */
    data: XOR<CommentAttachmentUpdateInput, CommentAttachmentUncheckedUpdateInput>
    /**
     * Choose, which CommentAttachment to update.
     */
    where: CommentAttachmentWhereUniqueInput
  }

  /**
   * CommentAttachment updateMany
   */
  export type CommentAttachmentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update CommentAttachments.
     */
    data: XOR<CommentAttachmentUpdateManyMutationInput, CommentAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which CommentAttachments to update
     */
    where?: CommentAttachmentWhereInput
    /**
     * Limit how many CommentAttachments to update.
     */
    limit?: number
  }

  /**
   * CommentAttachment updateManyAndReturn
   */
  export type CommentAttachmentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * The data used to update CommentAttachments.
     */
    data: XOR<CommentAttachmentUpdateManyMutationInput, CommentAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which CommentAttachments to update
     */
    where?: CommentAttachmentWhereInput
    /**
     * Limit how many CommentAttachments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * CommentAttachment upsert
   */
  export type CommentAttachmentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * The filter to search for the CommentAttachment to update in case it exists.
     */
    where: CommentAttachmentWhereUniqueInput
    /**
     * In case the CommentAttachment found by the `where` argument doesn't exist, create a new CommentAttachment with this data.
     */
    create: XOR<CommentAttachmentCreateInput, CommentAttachmentUncheckedCreateInput>
    /**
     * In case the CommentAttachment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<CommentAttachmentUpdateInput, CommentAttachmentUncheckedUpdateInput>
  }

  /**
   * CommentAttachment delete
   */
  export type CommentAttachmentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
    /**
     * Filter which CommentAttachment to delete.
     */
    where: CommentAttachmentWhereUniqueInput
  }

  /**
   * CommentAttachment deleteMany
   */
  export type CommentAttachmentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CommentAttachments to delete
     */
    where?: CommentAttachmentWhereInput
    /**
     * Limit how many CommentAttachments to delete.
     */
    limit?: number
  }

  /**
   * CommentAttachment without action
   */
  export type CommentAttachmentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentAttachment
     */
    select?: CommentAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentAttachment
     */
    omit?: CommentAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentAttachmentInclude<ExtArgs> | null
  }


  /**
   * Model PostVote
   */

  export type AggregatePostVote = {
    _count: PostVoteCountAggregateOutputType | null
    _min: PostVoteMinAggregateOutputType | null
    _max: PostVoteMaxAggregateOutputType | null
  }

  export type PostVoteMinAggregateOutputType = {
    id: string | null
    post_id: string | null
    user_id: string | null
    vote_type: string | null
    created_at: Date | null
  }

  export type PostVoteMaxAggregateOutputType = {
    id: string | null
    post_id: string | null
    user_id: string | null
    vote_type: string | null
    created_at: Date | null
  }

  export type PostVoteCountAggregateOutputType = {
    id: number
    post_id: number
    user_id: number
    vote_type: number
    created_at: number
    _all: number
  }


  export type PostVoteMinAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
  }

  export type PostVoteMaxAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
  }

  export type PostVoteCountAggregateInputType = {
    id?: true
    post_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
    _all?: true
  }

  export type PostVoteAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PostVote to aggregate.
     */
    where?: PostVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostVotes to fetch.
     */
    orderBy?: PostVoteOrderByWithRelationInput | PostVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PostVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PostVotes
    **/
    _count?: true | PostVoteCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PostVoteMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PostVoteMaxAggregateInputType
  }

  export type GetPostVoteAggregateType<T extends PostVoteAggregateArgs> = {
        [P in keyof T & keyof AggregatePostVote]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePostVote[P]>
      : GetScalarType<T[P], AggregatePostVote[P]>
  }




  export type PostVoteGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PostVoteWhereInput
    orderBy?: PostVoteOrderByWithAggregationInput | PostVoteOrderByWithAggregationInput[]
    by: PostVoteScalarFieldEnum[] | PostVoteScalarFieldEnum
    having?: PostVoteScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PostVoteCountAggregateInputType | true
    _min?: PostVoteMinAggregateInputType
    _max?: PostVoteMaxAggregateInputType
  }

  export type PostVoteGroupByOutputType = {
    id: string
    post_id: string
    user_id: string
    vote_type: string
    created_at: Date
    _count: PostVoteCountAggregateOutputType | null
    _min: PostVoteMinAggregateOutputType | null
    _max: PostVoteMaxAggregateOutputType | null
  }

  type GetPostVoteGroupByPayload<T extends PostVoteGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PostVoteGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PostVoteGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PostVoteGroupByOutputType[P]>
            : GetScalarType<T[P], PostVoteGroupByOutputType[P]>
        }
      >
    >


  export type PostVoteSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postVote"]>

  export type PostVoteSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postVote"]>

  export type PostVoteSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    post?: boolean | PostDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["postVote"]>

  export type PostVoteSelectScalar = {
    id?: boolean
    post_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
  }

  export type PostVoteOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "post_id" | "user_id" | "vote_type" | "created_at", ExtArgs["result"]["postVote"]>
  export type PostVoteInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }
  export type PostVoteIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }
  export type PostVoteIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    post?: boolean | PostDefaultArgs<ExtArgs>
  }

  export type $PostVotePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PostVote"
    objects: {
      post: Prisma.$PostPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      post_id: string
      user_id: string
      vote_type: string
      created_at: Date
    }, ExtArgs["result"]["postVote"]>
    composites: {}
  }

  type PostVoteGetPayload<S extends boolean | null | undefined | PostVoteDefaultArgs> = $Result.GetResult<Prisma.$PostVotePayload, S>

  type PostVoteCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PostVoteFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PostVoteCountAggregateInputType | true
    }

  export interface PostVoteDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PostVote'], meta: { name: 'PostVote' } }
    /**
     * Find zero or one PostVote that matches the filter.
     * @param {PostVoteFindUniqueArgs} args - Arguments to find a PostVote
     * @example
     * // Get one PostVote
     * const postVote = await prisma.postVote.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PostVoteFindUniqueArgs>(args: SelectSubset<T, PostVoteFindUniqueArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one PostVote that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PostVoteFindUniqueOrThrowArgs} args - Arguments to find a PostVote
     * @example
     * // Get one PostVote
     * const postVote = await prisma.postVote.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PostVoteFindUniqueOrThrowArgs>(args: SelectSubset<T, PostVoteFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PostVote that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteFindFirstArgs} args - Arguments to find a PostVote
     * @example
     * // Get one PostVote
     * const postVote = await prisma.postVote.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PostVoteFindFirstArgs>(args?: SelectSubset<T, PostVoteFindFirstArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first PostVote that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteFindFirstOrThrowArgs} args - Arguments to find a PostVote
     * @example
     * // Get one PostVote
     * const postVote = await prisma.postVote.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PostVoteFindFirstOrThrowArgs>(args?: SelectSubset<T, PostVoteFindFirstOrThrowArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more PostVotes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PostVotes
     * const postVotes = await prisma.postVote.findMany()
     * 
     * // Get first 10 PostVotes
     * const postVotes = await prisma.postVote.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const postVoteWithIdOnly = await prisma.postVote.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PostVoteFindManyArgs>(args?: SelectSubset<T, PostVoteFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a PostVote.
     * @param {PostVoteCreateArgs} args - Arguments to create a PostVote.
     * @example
     * // Create one PostVote
     * const PostVote = await prisma.postVote.create({
     *   data: {
     *     // ... data to create a PostVote
     *   }
     * })
     * 
     */
    create<T extends PostVoteCreateArgs>(args: SelectSubset<T, PostVoteCreateArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many PostVotes.
     * @param {PostVoteCreateManyArgs} args - Arguments to create many PostVotes.
     * @example
     * // Create many PostVotes
     * const postVote = await prisma.postVote.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PostVoteCreateManyArgs>(args?: SelectSubset<T, PostVoteCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many PostVotes and returns the data saved in the database.
     * @param {PostVoteCreateManyAndReturnArgs} args - Arguments to create many PostVotes.
     * @example
     * // Create many PostVotes
     * const postVote = await prisma.postVote.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many PostVotes and only return the `id`
     * const postVoteWithIdOnly = await prisma.postVote.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PostVoteCreateManyAndReturnArgs>(args?: SelectSubset<T, PostVoteCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a PostVote.
     * @param {PostVoteDeleteArgs} args - Arguments to delete one PostVote.
     * @example
     * // Delete one PostVote
     * const PostVote = await prisma.postVote.delete({
     *   where: {
     *     // ... filter to delete one PostVote
     *   }
     * })
     * 
     */
    delete<T extends PostVoteDeleteArgs>(args: SelectSubset<T, PostVoteDeleteArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one PostVote.
     * @param {PostVoteUpdateArgs} args - Arguments to update one PostVote.
     * @example
     * // Update one PostVote
     * const postVote = await prisma.postVote.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PostVoteUpdateArgs>(args: SelectSubset<T, PostVoteUpdateArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more PostVotes.
     * @param {PostVoteDeleteManyArgs} args - Arguments to filter PostVotes to delete.
     * @example
     * // Delete a few PostVotes
     * const { count } = await prisma.postVote.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PostVoteDeleteManyArgs>(args?: SelectSubset<T, PostVoteDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PostVotes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PostVotes
     * const postVote = await prisma.postVote.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PostVoteUpdateManyArgs>(args: SelectSubset<T, PostVoteUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PostVotes and returns the data updated in the database.
     * @param {PostVoteUpdateManyAndReturnArgs} args - Arguments to update many PostVotes.
     * @example
     * // Update many PostVotes
     * const postVote = await prisma.postVote.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more PostVotes and only return the `id`
     * const postVoteWithIdOnly = await prisma.postVote.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PostVoteUpdateManyAndReturnArgs>(args: SelectSubset<T, PostVoteUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one PostVote.
     * @param {PostVoteUpsertArgs} args - Arguments to update or create a PostVote.
     * @example
     * // Update or create a PostVote
     * const postVote = await prisma.postVote.upsert({
     *   create: {
     *     // ... data to create a PostVote
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PostVote we want to update
     *   }
     * })
     */
    upsert<T extends PostVoteUpsertArgs>(args: SelectSubset<T, PostVoteUpsertArgs<ExtArgs>>): Prisma__PostVoteClient<$Result.GetResult<Prisma.$PostVotePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of PostVotes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteCountArgs} args - Arguments to filter PostVotes to count.
     * @example
     * // Count the number of PostVotes
     * const count = await prisma.postVote.count({
     *   where: {
     *     // ... the filter for the PostVotes we want to count
     *   }
     * })
    **/
    count<T extends PostVoteCountArgs>(
      args?: Subset<T, PostVoteCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PostVoteCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PostVote.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PostVoteAggregateArgs>(args: Subset<T, PostVoteAggregateArgs>): Prisma.PrismaPromise<GetPostVoteAggregateType<T>>

    /**
     * Group by PostVote.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PostVoteGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PostVoteGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PostVoteGroupByArgs['orderBy'] }
        : { orderBy?: PostVoteGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PostVoteGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPostVoteGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PostVote model
   */
  readonly fields: PostVoteFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PostVote.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PostVoteClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    post<T extends PostDefaultArgs<ExtArgs> = {}>(args?: Subset<T, PostDefaultArgs<ExtArgs>>): Prisma__PostClient<$Result.GetResult<Prisma.$PostPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the PostVote model
   */
  interface PostVoteFieldRefs {
    readonly id: FieldRef<"PostVote", 'String'>
    readonly post_id: FieldRef<"PostVote", 'String'>
    readonly user_id: FieldRef<"PostVote", 'String'>
    readonly vote_type: FieldRef<"PostVote", 'String'>
    readonly created_at: FieldRef<"PostVote", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * PostVote findUnique
   */
  export type PostVoteFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter, which PostVote to fetch.
     */
    where: PostVoteWhereUniqueInput
  }

  /**
   * PostVote findUniqueOrThrow
   */
  export type PostVoteFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter, which PostVote to fetch.
     */
    where: PostVoteWhereUniqueInput
  }

  /**
   * PostVote findFirst
   */
  export type PostVoteFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter, which PostVote to fetch.
     */
    where?: PostVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostVotes to fetch.
     */
    orderBy?: PostVoteOrderByWithRelationInput | PostVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PostVotes.
     */
    cursor?: PostVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PostVotes.
     */
    distinct?: PostVoteScalarFieldEnum | PostVoteScalarFieldEnum[]
  }

  /**
   * PostVote findFirstOrThrow
   */
  export type PostVoteFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter, which PostVote to fetch.
     */
    where?: PostVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostVotes to fetch.
     */
    orderBy?: PostVoteOrderByWithRelationInput | PostVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PostVotes.
     */
    cursor?: PostVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PostVotes.
     */
    distinct?: PostVoteScalarFieldEnum | PostVoteScalarFieldEnum[]
  }

  /**
   * PostVote findMany
   */
  export type PostVoteFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter, which PostVotes to fetch.
     */
    where?: PostVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PostVotes to fetch.
     */
    orderBy?: PostVoteOrderByWithRelationInput | PostVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PostVotes.
     */
    cursor?: PostVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PostVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PostVotes.
     */
    skip?: number
    distinct?: PostVoteScalarFieldEnum | PostVoteScalarFieldEnum[]
  }

  /**
   * PostVote create
   */
  export type PostVoteCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * The data needed to create a PostVote.
     */
    data: XOR<PostVoteCreateInput, PostVoteUncheckedCreateInput>
  }

  /**
   * PostVote createMany
   */
  export type PostVoteCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PostVotes.
     */
    data: PostVoteCreateManyInput | PostVoteCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * PostVote createManyAndReturn
   */
  export type PostVoteCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * The data used to create many PostVotes.
     */
    data: PostVoteCreateManyInput | PostVoteCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * PostVote update
   */
  export type PostVoteUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * The data needed to update a PostVote.
     */
    data: XOR<PostVoteUpdateInput, PostVoteUncheckedUpdateInput>
    /**
     * Choose, which PostVote to update.
     */
    where: PostVoteWhereUniqueInput
  }

  /**
   * PostVote updateMany
   */
  export type PostVoteUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PostVotes.
     */
    data: XOR<PostVoteUpdateManyMutationInput, PostVoteUncheckedUpdateManyInput>
    /**
     * Filter which PostVotes to update
     */
    where?: PostVoteWhereInput
    /**
     * Limit how many PostVotes to update.
     */
    limit?: number
  }

  /**
   * PostVote updateManyAndReturn
   */
  export type PostVoteUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * The data used to update PostVotes.
     */
    data: XOR<PostVoteUpdateManyMutationInput, PostVoteUncheckedUpdateManyInput>
    /**
     * Filter which PostVotes to update
     */
    where?: PostVoteWhereInput
    /**
     * Limit how many PostVotes to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * PostVote upsert
   */
  export type PostVoteUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * The filter to search for the PostVote to update in case it exists.
     */
    where: PostVoteWhereUniqueInput
    /**
     * In case the PostVote found by the `where` argument doesn't exist, create a new PostVote with this data.
     */
    create: XOR<PostVoteCreateInput, PostVoteUncheckedCreateInput>
    /**
     * In case the PostVote was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PostVoteUpdateInput, PostVoteUncheckedUpdateInput>
  }

  /**
   * PostVote delete
   */
  export type PostVoteDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
    /**
     * Filter which PostVote to delete.
     */
    where: PostVoteWhereUniqueInput
  }

  /**
   * PostVote deleteMany
   */
  export type PostVoteDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PostVotes to delete
     */
    where?: PostVoteWhereInput
    /**
     * Limit how many PostVotes to delete.
     */
    limit?: number
  }

  /**
   * PostVote without action
   */
  export type PostVoteDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PostVote
     */
    select?: PostVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the PostVote
     */
    omit?: PostVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PostVoteInclude<ExtArgs> | null
  }


  /**
   * Model CommentVote
   */

  export type AggregateCommentVote = {
    _count: CommentVoteCountAggregateOutputType | null
    _min: CommentVoteMinAggregateOutputType | null
    _max: CommentVoteMaxAggregateOutputType | null
  }

  export type CommentVoteMinAggregateOutputType = {
    id: string | null
    comment_id: string | null
    user_id: string | null
    vote_type: string | null
    created_at: Date | null
  }

  export type CommentVoteMaxAggregateOutputType = {
    id: string | null
    comment_id: string | null
    user_id: string | null
    vote_type: string | null
    created_at: Date | null
  }

  export type CommentVoteCountAggregateOutputType = {
    id: number
    comment_id: number
    user_id: number
    vote_type: number
    created_at: number
    _all: number
  }


  export type CommentVoteMinAggregateInputType = {
    id?: true
    comment_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
  }

  export type CommentVoteMaxAggregateInputType = {
    id?: true
    comment_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
  }

  export type CommentVoteCountAggregateInputType = {
    id?: true
    comment_id?: true
    user_id?: true
    vote_type?: true
    created_at?: true
    _all?: true
  }

  export type CommentVoteAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CommentVote to aggregate.
     */
    where?: CommentVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentVotes to fetch.
     */
    orderBy?: CommentVoteOrderByWithRelationInput | CommentVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: CommentVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned CommentVotes
    **/
    _count?: true | CommentVoteCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CommentVoteMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CommentVoteMaxAggregateInputType
  }

  export type GetCommentVoteAggregateType<T extends CommentVoteAggregateArgs> = {
        [P in keyof T & keyof AggregateCommentVote]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateCommentVote[P]>
      : GetScalarType<T[P], AggregateCommentVote[P]>
  }




  export type CommentVoteGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CommentVoteWhereInput
    orderBy?: CommentVoteOrderByWithAggregationInput | CommentVoteOrderByWithAggregationInput[]
    by: CommentVoteScalarFieldEnum[] | CommentVoteScalarFieldEnum
    having?: CommentVoteScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CommentVoteCountAggregateInputType | true
    _min?: CommentVoteMinAggregateInputType
    _max?: CommentVoteMaxAggregateInputType
  }

  export type CommentVoteGroupByOutputType = {
    id: string
    comment_id: string
    user_id: string
    vote_type: string
    created_at: Date
    _count: CommentVoteCountAggregateOutputType | null
    _min: CommentVoteMinAggregateOutputType | null
    _max: CommentVoteMaxAggregateOutputType | null
  }

  type GetCommentVoteGroupByPayload<T extends CommentVoteGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<CommentVoteGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CommentVoteGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CommentVoteGroupByOutputType[P]>
            : GetScalarType<T[P], CommentVoteGroupByOutputType[P]>
        }
      >
    >


  export type CommentVoteSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentVote"]>

  export type CommentVoteSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentVote"]>

  export type CommentVoteSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    comment_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["commentVote"]>

  export type CommentVoteSelectScalar = {
    id?: boolean
    comment_id?: boolean
    user_id?: boolean
    vote_type?: boolean
    created_at?: boolean
  }

  export type CommentVoteOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "comment_id" | "user_id" | "vote_type" | "created_at", ExtArgs["result"]["commentVote"]>
  export type CommentVoteInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }
  export type CommentVoteIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }
  export type CommentVoteIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    comment?: boolean | CommentDefaultArgs<ExtArgs>
  }

  export type $CommentVotePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "CommentVote"
    objects: {
      comment: Prisma.$CommentPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      comment_id: string
      user_id: string
      vote_type: string
      created_at: Date
    }, ExtArgs["result"]["commentVote"]>
    composites: {}
  }

  type CommentVoteGetPayload<S extends boolean | null | undefined | CommentVoteDefaultArgs> = $Result.GetResult<Prisma.$CommentVotePayload, S>

  type CommentVoteCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<CommentVoteFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: CommentVoteCountAggregateInputType | true
    }

  export interface CommentVoteDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['CommentVote'], meta: { name: 'CommentVote' } }
    /**
     * Find zero or one CommentVote that matches the filter.
     * @param {CommentVoteFindUniqueArgs} args - Arguments to find a CommentVote
     * @example
     * // Get one CommentVote
     * const commentVote = await prisma.commentVote.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends CommentVoteFindUniqueArgs>(args: SelectSubset<T, CommentVoteFindUniqueArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one CommentVote that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {CommentVoteFindUniqueOrThrowArgs} args - Arguments to find a CommentVote
     * @example
     * // Get one CommentVote
     * const commentVote = await prisma.commentVote.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends CommentVoteFindUniqueOrThrowArgs>(args: SelectSubset<T, CommentVoteFindUniqueOrThrowArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CommentVote that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteFindFirstArgs} args - Arguments to find a CommentVote
     * @example
     * // Get one CommentVote
     * const commentVote = await prisma.commentVote.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends CommentVoteFindFirstArgs>(args?: SelectSubset<T, CommentVoteFindFirstArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CommentVote that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteFindFirstOrThrowArgs} args - Arguments to find a CommentVote
     * @example
     * // Get one CommentVote
     * const commentVote = await prisma.commentVote.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends CommentVoteFindFirstOrThrowArgs>(args?: SelectSubset<T, CommentVoteFindFirstOrThrowArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more CommentVotes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all CommentVotes
     * const commentVotes = await prisma.commentVote.findMany()
     * 
     * // Get first 10 CommentVotes
     * const commentVotes = await prisma.commentVote.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const commentVoteWithIdOnly = await prisma.commentVote.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends CommentVoteFindManyArgs>(args?: SelectSubset<T, CommentVoteFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a CommentVote.
     * @param {CommentVoteCreateArgs} args - Arguments to create a CommentVote.
     * @example
     * // Create one CommentVote
     * const CommentVote = await prisma.commentVote.create({
     *   data: {
     *     // ... data to create a CommentVote
     *   }
     * })
     * 
     */
    create<T extends CommentVoteCreateArgs>(args: SelectSubset<T, CommentVoteCreateArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many CommentVotes.
     * @param {CommentVoteCreateManyArgs} args - Arguments to create many CommentVotes.
     * @example
     * // Create many CommentVotes
     * const commentVote = await prisma.commentVote.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends CommentVoteCreateManyArgs>(args?: SelectSubset<T, CommentVoteCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many CommentVotes and returns the data saved in the database.
     * @param {CommentVoteCreateManyAndReturnArgs} args - Arguments to create many CommentVotes.
     * @example
     * // Create many CommentVotes
     * const commentVote = await prisma.commentVote.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many CommentVotes and only return the `id`
     * const commentVoteWithIdOnly = await prisma.commentVote.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends CommentVoteCreateManyAndReturnArgs>(args?: SelectSubset<T, CommentVoteCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a CommentVote.
     * @param {CommentVoteDeleteArgs} args - Arguments to delete one CommentVote.
     * @example
     * // Delete one CommentVote
     * const CommentVote = await prisma.commentVote.delete({
     *   where: {
     *     // ... filter to delete one CommentVote
     *   }
     * })
     * 
     */
    delete<T extends CommentVoteDeleteArgs>(args: SelectSubset<T, CommentVoteDeleteArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one CommentVote.
     * @param {CommentVoteUpdateArgs} args - Arguments to update one CommentVote.
     * @example
     * // Update one CommentVote
     * const commentVote = await prisma.commentVote.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends CommentVoteUpdateArgs>(args: SelectSubset<T, CommentVoteUpdateArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more CommentVotes.
     * @param {CommentVoteDeleteManyArgs} args - Arguments to filter CommentVotes to delete.
     * @example
     * // Delete a few CommentVotes
     * const { count } = await prisma.commentVote.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends CommentVoteDeleteManyArgs>(args?: SelectSubset<T, CommentVoteDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CommentVotes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many CommentVotes
     * const commentVote = await prisma.commentVote.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends CommentVoteUpdateManyArgs>(args: SelectSubset<T, CommentVoteUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CommentVotes and returns the data updated in the database.
     * @param {CommentVoteUpdateManyAndReturnArgs} args - Arguments to update many CommentVotes.
     * @example
     * // Update many CommentVotes
     * const commentVote = await prisma.commentVote.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more CommentVotes and only return the `id`
     * const commentVoteWithIdOnly = await prisma.commentVote.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends CommentVoteUpdateManyAndReturnArgs>(args: SelectSubset<T, CommentVoteUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one CommentVote.
     * @param {CommentVoteUpsertArgs} args - Arguments to update or create a CommentVote.
     * @example
     * // Update or create a CommentVote
     * const commentVote = await prisma.commentVote.upsert({
     *   create: {
     *     // ... data to create a CommentVote
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the CommentVote we want to update
     *   }
     * })
     */
    upsert<T extends CommentVoteUpsertArgs>(args: SelectSubset<T, CommentVoteUpsertArgs<ExtArgs>>): Prisma__CommentVoteClient<$Result.GetResult<Prisma.$CommentVotePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of CommentVotes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteCountArgs} args - Arguments to filter CommentVotes to count.
     * @example
     * // Count the number of CommentVotes
     * const count = await prisma.commentVote.count({
     *   where: {
     *     // ... the filter for the CommentVotes we want to count
     *   }
     * })
    **/
    count<T extends CommentVoteCountArgs>(
      args?: Subset<T, CommentVoteCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CommentVoteCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a CommentVote.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CommentVoteAggregateArgs>(args: Subset<T, CommentVoteAggregateArgs>): Prisma.PrismaPromise<GetCommentVoteAggregateType<T>>

    /**
     * Group by CommentVote.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentVoteGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CommentVoteGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CommentVoteGroupByArgs['orderBy'] }
        : { orderBy?: CommentVoteGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CommentVoteGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCommentVoteGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the CommentVote model
   */
  readonly fields: CommentVoteFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for CommentVote.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__CommentVoteClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    comment<T extends CommentDefaultArgs<ExtArgs> = {}>(args?: Subset<T, CommentDefaultArgs<ExtArgs>>): Prisma__CommentClient<$Result.GetResult<Prisma.$CommentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the CommentVote model
   */
  interface CommentVoteFieldRefs {
    readonly id: FieldRef<"CommentVote", 'String'>
    readonly comment_id: FieldRef<"CommentVote", 'String'>
    readonly user_id: FieldRef<"CommentVote", 'String'>
    readonly vote_type: FieldRef<"CommentVote", 'String'>
    readonly created_at: FieldRef<"CommentVote", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * CommentVote findUnique
   */
  export type CommentVoteFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter, which CommentVote to fetch.
     */
    where: CommentVoteWhereUniqueInput
  }

  /**
   * CommentVote findUniqueOrThrow
   */
  export type CommentVoteFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter, which CommentVote to fetch.
     */
    where: CommentVoteWhereUniqueInput
  }

  /**
   * CommentVote findFirst
   */
  export type CommentVoteFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter, which CommentVote to fetch.
     */
    where?: CommentVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentVotes to fetch.
     */
    orderBy?: CommentVoteOrderByWithRelationInput | CommentVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CommentVotes.
     */
    cursor?: CommentVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CommentVotes.
     */
    distinct?: CommentVoteScalarFieldEnum | CommentVoteScalarFieldEnum[]
  }

  /**
   * CommentVote findFirstOrThrow
   */
  export type CommentVoteFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter, which CommentVote to fetch.
     */
    where?: CommentVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentVotes to fetch.
     */
    orderBy?: CommentVoteOrderByWithRelationInput | CommentVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CommentVotes.
     */
    cursor?: CommentVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentVotes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CommentVotes.
     */
    distinct?: CommentVoteScalarFieldEnum | CommentVoteScalarFieldEnum[]
  }

  /**
   * CommentVote findMany
   */
  export type CommentVoteFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter, which CommentVotes to fetch.
     */
    where?: CommentVoteWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CommentVotes to fetch.
     */
    orderBy?: CommentVoteOrderByWithRelationInput | CommentVoteOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing CommentVotes.
     */
    cursor?: CommentVoteWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CommentVotes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CommentVotes.
     */
    skip?: number
    distinct?: CommentVoteScalarFieldEnum | CommentVoteScalarFieldEnum[]
  }

  /**
   * CommentVote create
   */
  export type CommentVoteCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * The data needed to create a CommentVote.
     */
    data: XOR<CommentVoteCreateInput, CommentVoteUncheckedCreateInput>
  }

  /**
   * CommentVote createMany
   */
  export type CommentVoteCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many CommentVotes.
     */
    data: CommentVoteCreateManyInput | CommentVoteCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * CommentVote createManyAndReturn
   */
  export type CommentVoteCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * The data used to create many CommentVotes.
     */
    data: CommentVoteCreateManyInput | CommentVoteCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * CommentVote update
   */
  export type CommentVoteUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * The data needed to update a CommentVote.
     */
    data: XOR<CommentVoteUpdateInput, CommentVoteUncheckedUpdateInput>
    /**
     * Choose, which CommentVote to update.
     */
    where: CommentVoteWhereUniqueInput
  }

  /**
   * CommentVote updateMany
   */
  export type CommentVoteUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update CommentVotes.
     */
    data: XOR<CommentVoteUpdateManyMutationInput, CommentVoteUncheckedUpdateManyInput>
    /**
     * Filter which CommentVotes to update
     */
    where?: CommentVoteWhereInput
    /**
     * Limit how many CommentVotes to update.
     */
    limit?: number
  }

  /**
   * CommentVote updateManyAndReturn
   */
  export type CommentVoteUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * The data used to update CommentVotes.
     */
    data: XOR<CommentVoteUpdateManyMutationInput, CommentVoteUncheckedUpdateManyInput>
    /**
     * Filter which CommentVotes to update
     */
    where?: CommentVoteWhereInput
    /**
     * Limit how many CommentVotes to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * CommentVote upsert
   */
  export type CommentVoteUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * The filter to search for the CommentVote to update in case it exists.
     */
    where: CommentVoteWhereUniqueInput
    /**
     * In case the CommentVote found by the `where` argument doesn't exist, create a new CommentVote with this data.
     */
    create: XOR<CommentVoteCreateInput, CommentVoteUncheckedCreateInput>
    /**
     * In case the CommentVote was found with the provided `where` argument, update it with this data.
     */
    update: XOR<CommentVoteUpdateInput, CommentVoteUncheckedUpdateInput>
  }

  /**
   * CommentVote delete
   */
  export type CommentVoteDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
    /**
     * Filter which CommentVote to delete.
     */
    where: CommentVoteWhereUniqueInput
  }

  /**
   * CommentVote deleteMany
   */
  export type CommentVoteDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CommentVotes to delete
     */
    where?: CommentVoteWhereInput
    /**
     * Limit how many CommentVotes to delete.
     */
    limit?: number
  }

  /**
   * CommentVote without action
   */
  export type CommentVoteDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CommentVote
     */
    select?: CommentVoteSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CommentVote
     */
    omit?: CommentVoteOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CommentVoteInclude<ExtArgs> | null
  }


  /**
   * Model Group
   */

  export type AggregateGroup = {
    _count: GroupCountAggregateOutputType | null
    _min: GroupMinAggregateOutputType | null
    _max: GroupMaxAggregateOutputType | null
  }

  export type GroupMinAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    created_by: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type GroupMaxAggregateOutputType = {
    id: string | null
    name: string | null
    description: string | null
    created_by: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type GroupCountAggregateOutputType = {
    id: number
    name: number
    description: number
    created_by: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type GroupMinAggregateInputType = {
    id?: true
    name?: true
    description?: true
    created_by?: true
    created_at?: true
    updated_at?: true
  }

  export type GroupMaxAggregateInputType = {
    id?: true
    name?: true
    description?: true
    created_by?: true
    created_at?: true
    updated_at?: true
  }

  export type GroupCountAggregateInputType = {
    id?: true
    name?: true
    description?: true
    created_by?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type GroupAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Group to aggregate.
     */
    where?: GroupWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Groups to fetch.
     */
    orderBy?: GroupOrderByWithRelationInput | GroupOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GroupWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Groups from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Groups.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Groups
    **/
    _count?: true | GroupCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GroupMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GroupMaxAggregateInputType
  }

  export type GetGroupAggregateType<T extends GroupAggregateArgs> = {
        [P in keyof T & keyof AggregateGroup]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGroup[P]>
      : GetScalarType<T[P], AggregateGroup[P]>
  }




  export type GroupGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GroupWhereInput
    orderBy?: GroupOrderByWithAggregationInput | GroupOrderByWithAggregationInput[]
    by: GroupScalarFieldEnum[] | GroupScalarFieldEnum
    having?: GroupScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GroupCountAggregateInputType | true
    _min?: GroupMinAggregateInputType
    _max?: GroupMaxAggregateInputType
  }

  export type GroupGroupByOutputType = {
    id: string
    name: string
    description: string | null
    created_by: string
    created_at: Date
    updated_at: Date
    _count: GroupCountAggregateOutputType | null
    _min: GroupMinAggregateOutputType | null
    _max: GroupMaxAggregateOutputType | null
  }

  type GetGroupGroupByPayload<T extends GroupGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GroupGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GroupGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GroupGroupByOutputType[P]>
            : GetScalarType<T[P], GroupGroupByOutputType[P]>
        }
      >
    >


  export type GroupSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    created_by?: boolean
    created_at?: boolean
    updated_at?: boolean
    members?: boolean | Group$membersArgs<ExtArgs>
    messages?: boolean | Group$messagesArgs<ExtArgs>
    _count?: boolean | GroupCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["group"]>

  export type GroupSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    created_by?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["group"]>

  export type GroupSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    description?: boolean
    created_by?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["group"]>

  export type GroupSelectScalar = {
    id?: boolean
    name?: boolean
    description?: boolean
    created_by?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type GroupOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "name" | "description" | "created_by" | "created_at" | "updated_at", ExtArgs["result"]["group"]>
  export type GroupInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | Group$membersArgs<ExtArgs>
    messages?: boolean | Group$messagesArgs<ExtArgs>
    _count?: boolean | GroupCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type GroupIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type GroupIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $GroupPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Group"
    objects: {
      members: Prisma.$GroupMemberPayload<ExtArgs>[]
      messages: Prisma.$MessagePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      description: string | null
      created_by: string
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["group"]>
    composites: {}
  }

  type GroupGetPayload<S extends boolean | null | undefined | GroupDefaultArgs> = $Result.GetResult<Prisma.$GroupPayload, S>

  type GroupCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<GroupFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: GroupCountAggregateInputType | true
    }

  export interface GroupDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Group'], meta: { name: 'Group' } }
    /**
     * Find zero or one Group that matches the filter.
     * @param {GroupFindUniqueArgs} args - Arguments to find a Group
     * @example
     * // Get one Group
     * const group = await prisma.group.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GroupFindUniqueArgs>(args: SelectSubset<T, GroupFindUniqueArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Group that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {GroupFindUniqueOrThrowArgs} args - Arguments to find a Group
     * @example
     * // Get one Group
     * const group = await prisma.group.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GroupFindUniqueOrThrowArgs>(args: SelectSubset<T, GroupFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Group that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupFindFirstArgs} args - Arguments to find a Group
     * @example
     * // Get one Group
     * const group = await prisma.group.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GroupFindFirstArgs>(args?: SelectSubset<T, GroupFindFirstArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Group that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupFindFirstOrThrowArgs} args - Arguments to find a Group
     * @example
     * // Get one Group
     * const group = await prisma.group.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GroupFindFirstOrThrowArgs>(args?: SelectSubset<T, GroupFindFirstOrThrowArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Groups that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Groups
     * const groups = await prisma.group.findMany()
     * 
     * // Get first 10 Groups
     * const groups = await prisma.group.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const groupWithIdOnly = await prisma.group.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GroupFindManyArgs>(args?: SelectSubset<T, GroupFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Group.
     * @param {GroupCreateArgs} args - Arguments to create a Group.
     * @example
     * // Create one Group
     * const Group = await prisma.group.create({
     *   data: {
     *     // ... data to create a Group
     *   }
     * })
     * 
     */
    create<T extends GroupCreateArgs>(args: SelectSubset<T, GroupCreateArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Groups.
     * @param {GroupCreateManyArgs} args - Arguments to create many Groups.
     * @example
     * // Create many Groups
     * const group = await prisma.group.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GroupCreateManyArgs>(args?: SelectSubset<T, GroupCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Groups and returns the data saved in the database.
     * @param {GroupCreateManyAndReturnArgs} args - Arguments to create many Groups.
     * @example
     * // Create many Groups
     * const group = await prisma.group.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Groups and only return the `id`
     * const groupWithIdOnly = await prisma.group.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GroupCreateManyAndReturnArgs>(args?: SelectSubset<T, GroupCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Group.
     * @param {GroupDeleteArgs} args - Arguments to delete one Group.
     * @example
     * // Delete one Group
     * const Group = await prisma.group.delete({
     *   where: {
     *     // ... filter to delete one Group
     *   }
     * })
     * 
     */
    delete<T extends GroupDeleteArgs>(args: SelectSubset<T, GroupDeleteArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Group.
     * @param {GroupUpdateArgs} args - Arguments to update one Group.
     * @example
     * // Update one Group
     * const group = await prisma.group.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GroupUpdateArgs>(args: SelectSubset<T, GroupUpdateArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Groups.
     * @param {GroupDeleteManyArgs} args - Arguments to filter Groups to delete.
     * @example
     * // Delete a few Groups
     * const { count } = await prisma.group.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GroupDeleteManyArgs>(args?: SelectSubset<T, GroupDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Groups.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Groups
     * const group = await prisma.group.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GroupUpdateManyArgs>(args: SelectSubset<T, GroupUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Groups and returns the data updated in the database.
     * @param {GroupUpdateManyAndReturnArgs} args - Arguments to update many Groups.
     * @example
     * // Update many Groups
     * const group = await prisma.group.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Groups and only return the `id`
     * const groupWithIdOnly = await prisma.group.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends GroupUpdateManyAndReturnArgs>(args: SelectSubset<T, GroupUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Group.
     * @param {GroupUpsertArgs} args - Arguments to update or create a Group.
     * @example
     * // Update or create a Group
     * const group = await prisma.group.upsert({
     *   create: {
     *     // ... data to create a Group
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Group we want to update
     *   }
     * })
     */
    upsert<T extends GroupUpsertArgs>(args: SelectSubset<T, GroupUpsertArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Groups.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupCountArgs} args - Arguments to filter Groups to count.
     * @example
     * // Count the number of Groups
     * const count = await prisma.group.count({
     *   where: {
     *     // ... the filter for the Groups we want to count
     *   }
     * })
    **/
    count<T extends GroupCountArgs>(
      args?: Subset<T, GroupCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GroupCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Group.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends GroupAggregateArgs>(args: Subset<T, GroupAggregateArgs>): Prisma.PrismaPromise<GetGroupAggregateType<T>>

    /**
     * Group by Group.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends GroupGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GroupGroupByArgs['orderBy'] }
        : { orderBy?: GroupGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, GroupGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGroupGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Group model
   */
  readonly fields: GroupFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Group.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GroupClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    members<T extends Group$membersArgs<ExtArgs> = {}>(args?: Subset<T, Group$membersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    messages<T extends Group$messagesArgs<ExtArgs> = {}>(args?: Subset<T, Group$messagesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Group model
   */
  interface GroupFieldRefs {
    readonly id: FieldRef<"Group", 'String'>
    readonly name: FieldRef<"Group", 'String'>
    readonly description: FieldRef<"Group", 'String'>
    readonly created_by: FieldRef<"Group", 'String'>
    readonly created_at: FieldRef<"Group", 'DateTime'>
    readonly updated_at: FieldRef<"Group", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Group findUnique
   */
  export type GroupFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter, which Group to fetch.
     */
    where: GroupWhereUniqueInput
  }

  /**
   * Group findUniqueOrThrow
   */
  export type GroupFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter, which Group to fetch.
     */
    where: GroupWhereUniqueInput
  }

  /**
   * Group findFirst
   */
  export type GroupFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter, which Group to fetch.
     */
    where?: GroupWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Groups to fetch.
     */
    orderBy?: GroupOrderByWithRelationInput | GroupOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Groups.
     */
    cursor?: GroupWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Groups from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Groups.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Groups.
     */
    distinct?: GroupScalarFieldEnum | GroupScalarFieldEnum[]
  }

  /**
   * Group findFirstOrThrow
   */
  export type GroupFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter, which Group to fetch.
     */
    where?: GroupWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Groups to fetch.
     */
    orderBy?: GroupOrderByWithRelationInput | GroupOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Groups.
     */
    cursor?: GroupWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Groups from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Groups.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Groups.
     */
    distinct?: GroupScalarFieldEnum | GroupScalarFieldEnum[]
  }

  /**
   * Group findMany
   */
  export type GroupFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter, which Groups to fetch.
     */
    where?: GroupWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Groups to fetch.
     */
    orderBy?: GroupOrderByWithRelationInput | GroupOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Groups.
     */
    cursor?: GroupWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Groups from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Groups.
     */
    skip?: number
    distinct?: GroupScalarFieldEnum | GroupScalarFieldEnum[]
  }

  /**
   * Group create
   */
  export type GroupCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * The data needed to create a Group.
     */
    data: XOR<GroupCreateInput, GroupUncheckedCreateInput>
  }

  /**
   * Group createMany
   */
  export type GroupCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Groups.
     */
    data: GroupCreateManyInput | GroupCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Group createManyAndReturn
   */
  export type GroupCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * The data used to create many Groups.
     */
    data: GroupCreateManyInput | GroupCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Group update
   */
  export type GroupUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * The data needed to update a Group.
     */
    data: XOR<GroupUpdateInput, GroupUncheckedUpdateInput>
    /**
     * Choose, which Group to update.
     */
    where: GroupWhereUniqueInput
  }

  /**
   * Group updateMany
   */
  export type GroupUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Groups.
     */
    data: XOR<GroupUpdateManyMutationInput, GroupUncheckedUpdateManyInput>
    /**
     * Filter which Groups to update
     */
    where?: GroupWhereInput
    /**
     * Limit how many Groups to update.
     */
    limit?: number
  }

  /**
   * Group updateManyAndReturn
   */
  export type GroupUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * The data used to update Groups.
     */
    data: XOR<GroupUpdateManyMutationInput, GroupUncheckedUpdateManyInput>
    /**
     * Filter which Groups to update
     */
    where?: GroupWhereInput
    /**
     * Limit how many Groups to update.
     */
    limit?: number
  }

  /**
   * Group upsert
   */
  export type GroupUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * The filter to search for the Group to update in case it exists.
     */
    where: GroupWhereUniqueInput
    /**
     * In case the Group found by the `where` argument doesn't exist, create a new Group with this data.
     */
    create: XOR<GroupCreateInput, GroupUncheckedCreateInput>
    /**
     * In case the Group was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GroupUpdateInput, GroupUncheckedUpdateInput>
  }

  /**
   * Group delete
   */
  export type GroupDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    /**
     * Filter which Group to delete.
     */
    where: GroupWhereUniqueInput
  }

  /**
   * Group deleteMany
   */
  export type GroupDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Groups to delete
     */
    where?: GroupWhereInput
    /**
     * Limit how many Groups to delete.
     */
    limit?: number
  }

  /**
   * Group.members
   */
  export type Group$membersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    where?: GroupMemberWhereInput
    orderBy?: GroupMemberOrderByWithRelationInput | GroupMemberOrderByWithRelationInput[]
    cursor?: GroupMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: GroupMemberScalarFieldEnum | GroupMemberScalarFieldEnum[]
  }

  /**
   * Group.messages
   */
  export type Group$messagesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    where?: MessageWhereInput
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    cursor?: MessageWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MessageScalarFieldEnum | MessageScalarFieldEnum[]
  }

  /**
   * Group without action
   */
  export type GroupDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
  }


  /**
   * Model GroupMember
   */

  export type AggregateGroupMember = {
    _count: GroupMemberCountAggregateOutputType | null
    _min: GroupMemberMinAggregateOutputType | null
    _max: GroupMemberMaxAggregateOutputType | null
  }

  export type GroupMemberMinAggregateOutputType = {
    id: string | null
    group_id: string | null
    user_id: string | null
    role: string | null
    joined_at: Date | null
  }

  export type GroupMemberMaxAggregateOutputType = {
    id: string | null
    group_id: string | null
    user_id: string | null
    role: string | null
    joined_at: Date | null
  }

  export type GroupMemberCountAggregateOutputType = {
    id: number
    group_id: number
    user_id: number
    role: number
    joined_at: number
    _all: number
  }


  export type GroupMemberMinAggregateInputType = {
    id?: true
    group_id?: true
    user_id?: true
    role?: true
    joined_at?: true
  }

  export type GroupMemberMaxAggregateInputType = {
    id?: true
    group_id?: true
    user_id?: true
    role?: true
    joined_at?: true
  }

  export type GroupMemberCountAggregateInputType = {
    id?: true
    group_id?: true
    user_id?: true
    role?: true
    joined_at?: true
    _all?: true
  }

  export type GroupMemberAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GroupMember to aggregate.
     */
    where?: GroupMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupMembers to fetch.
     */
    orderBy?: GroupMemberOrderByWithRelationInput | GroupMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GroupMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GroupMembers
    **/
    _count?: true | GroupMemberCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GroupMemberMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GroupMemberMaxAggregateInputType
  }

  export type GetGroupMemberAggregateType<T extends GroupMemberAggregateArgs> = {
        [P in keyof T & keyof AggregateGroupMember]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGroupMember[P]>
      : GetScalarType<T[P], AggregateGroupMember[P]>
  }




  export type GroupMemberGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GroupMemberWhereInput
    orderBy?: GroupMemberOrderByWithAggregationInput | GroupMemberOrderByWithAggregationInput[]
    by: GroupMemberScalarFieldEnum[] | GroupMemberScalarFieldEnum
    having?: GroupMemberScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GroupMemberCountAggregateInputType | true
    _min?: GroupMemberMinAggregateInputType
    _max?: GroupMemberMaxAggregateInputType
  }

  export type GroupMemberGroupByOutputType = {
    id: string
    group_id: string
    user_id: string
    role: string
    joined_at: Date
    _count: GroupMemberCountAggregateOutputType | null
    _min: GroupMemberMinAggregateOutputType | null
    _max: GroupMemberMaxAggregateOutputType | null
  }

  type GetGroupMemberGroupByPayload<T extends GroupMemberGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GroupMemberGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GroupMemberGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GroupMemberGroupByOutputType[P]>
            : GetScalarType<T[P], GroupMemberGroupByOutputType[P]>
        }
      >
    >


  export type GroupMemberSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    user_id?: boolean
    role?: boolean
    joined_at?: boolean
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["groupMember"]>

  export type GroupMemberSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    user_id?: boolean
    role?: boolean
    joined_at?: boolean
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["groupMember"]>

  export type GroupMemberSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    group_id?: boolean
    user_id?: boolean
    role?: boolean
    joined_at?: boolean
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["groupMember"]>

  export type GroupMemberSelectScalar = {
    id?: boolean
    group_id?: boolean
    user_id?: boolean
    role?: boolean
    joined_at?: boolean
  }

  export type GroupMemberOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "group_id" | "user_id" | "role" | "joined_at", ExtArgs["result"]["groupMember"]>
  export type GroupMemberInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }
  export type GroupMemberIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }
  export type GroupMemberIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | GroupDefaultArgs<ExtArgs>
  }

  export type $GroupMemberPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GroupMember"
    objects: {
      group: Prisma.$GroupPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      group_id: string
      user_id: string
      role: string
      joined_at: Date
    }, ExtArgs["result"]["groupMember"]>
    composites: {}
  }

  type GroupMemberGetPayload<S extends boolean | null | undefined | GroupMemberDefaultArgs> = $Result.GetResult<Prisma.$GroupMemberPayload, S>

  type GroupMemberCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<GroupMemberFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: GroupMemberCountAggregateInputType | true
    }

  export interface GroupMemberDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GroupMember'], meta: { name: 'GroupMember' } }
    /**
     * Find zero or one GroupMember that matches the filter.
     * @param {GroupMemberFindUniqueArgs} args - Arguments to find a GroupMember
     * @example
     * // Get one GroupMember
     * const groupMember = await prisma.groupMember.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GroupMemberFindUniqueArgs>(args: SelectSubset<T, GroupMemberFindUniqueArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one GroupMember that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {GroupMemberFindUniqueOrThrowArgs} args - Arguments to find a GroupMember
     * @example
     * // Get one GroupMember
     * const groupMember = await prisma.groupMember.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GroupMemberFindUniqueOrThrowArgs>(args: SelectSubset<T, GroupMemberFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GroupMember that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberFindFirstArgs} args - Arguments to find a GroupMember
     * @example
     * // Get one GroupMember
     * const groupMember = await prisma.groupMember.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GroupMemberFindFirstArgs>(args?: SelectSubset<T, GroupMemberFindFirstArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GroupMember that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberFindFirstOrThrowArgs} args - Arguments to find a GroupMember
     * @example
     * // Get one GroupMember
     * const groupMember = await prisma.groupMember.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GroupMemberFindFirstOrThrowArgs>(args?: SelectSubset<T, GroupMemberFindFirstOrThrowArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more GroupMembers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GroupMembers
     * const groupMembers = await prisma.groupMember.findMany()
     * 
     * // Get first 10 GroupMembers
     * const groupMembers = await prisma.groupMember.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const groupMemberWithIdOnly = await prisma.groupMember.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GroupMemberFindManyArgs>(args?: SelectSubset<T, GroupMemberFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a GroupMember.
     * @param {GroupMemberCreateArgs} args - Arguments to create a GroupMember.
     * @example
     * // Create one GroupMember
     * const GroupMember = await prisma.groupMember.create({
     *   data: {
     *     // ... data to create a GroupMember
     *   }
     * })
     * 
     */
    create<T extends GroupMemberCreateArgs>(args: SelectSubset<T, GroupMemberCreateArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many GroupMembers.
     * @param {GroupMemberCreateManyArgs} args - Arguments to create many GroupMembers.
     * @example
     * // Create many GroupMembers
     * const groupMember = await prisma.groupMember.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GroupMemberCreateManyArgs>(args?: SelectSubset<T, GroupMemberCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GroupMembers and returns the data saved in the database.
     * @param {GroupMemberCreateManyAndReturnArgs} args - Arguments to create many GroupMembers.
     * @example
     * // Create many GroupMembers
     * const groupMember = await prisma.groupMember.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GroupMembers and only return the `id`
     * const groupMemberWithIdOnly = await prisma.groupMember.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GroupMemberCreateManyAndReturnArgs>(args?: SelectSubset<T, GroupMemberCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a GroupMember.
     * @param {GroupMemberDeleteArgs} args - Arguments to delete one GroupMember.
     * @example
     * // Delete one GroupMember
     * const GroupMember = await prisma.groupMember.delete({
     *   where: {
     *     // ... filter to delete one GroupMember
     *   }
     * })
     * 
     */
    delete<T extends GroupMemberDeleteArgs>(args: SelectSubset<T, GroupMemberDeleteArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one GroupMember.
     * @param {GroupMemberUpdateArgs} args - Arguments to update one GroupMember.
     * @example
     * // Update one GroupMember
     * const groupMember = await prisma.groupMember.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GroupMemberUpdateArgs>(args: SelectSubset<T, GroupMemberUpdateArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more GroupMembers.
     * @param {GroupMemberDeleteManyArgs} args - Arguments to filter GroupMembers to delete.
     * @example
     * // Delete a few GroupMembers
     * const { count } = await prisma.groupMember.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GroupMemberDeleteManyArgs>(args?: SelectSubset<T, GroupMemberDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GroupMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GroupMembers
     * const groupMember = await prisma.groupMember.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GroupMemberUpdateManyArgs>(args: SelectSubset<T, GroupMemberUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GroupMembers and returns the data updated in the database.
     * @param {GroupMemberUpdateManyAndReturnArgs} args - Arguments to update many GroupMembers.
     * @example
     * // Update many GroupMembers
     * const groupMember = await prisma.groupMember.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more GroupMembers and only return the `id`
     * const groupMemberWithIdOnly = await prisma.groupMember.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends GroupMemberUpdateManyAndReturnArgs>(args: SelectSubset<T, GroupMemberUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one GroupMember.
     * @param {GroupMemberUpsertArgs} args - Arguments to update or create a GroupMember.
     * @example
     * // Update or create a GroupMember
     * const groupMember = await prisma.groupMember.upsert({
     *   create: {
     *     // ... data to create a GroupMember
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GroupMember we want to update
     *   }
     * })
     */
    upsert<T extends GroupMemberUpsertArgs>(args: SelectSubset<T, GroupMemberUpsertArgs<ExtArgs>>): Prisma__GroupMemberClient<$Result.GetResult<Prisma.$GroupMemberPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of GroupMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberCountArgs} args - Arguments to filter GroupMembers to count.
     * @example
     * // Count the number of GroupMembers
     * const count = await prisma.groupMember.count({
     *   where: {
     *     // ... the filter for the GroupMembers we want to count
     *   }
     * })
    **/
    count<T extends GroupMemberCountArgs>(
      args?: Subset<T, GroupMemberCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GroupMemberCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GroupMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends GroupMemberAggregateArgs>(args: Subset<T, GroupMemberAggregateArgs>): Prisma.PrismaPromise<GetGroupMemberAggregateType<T>>

    /**
     * Group by GroupMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GroupMemberGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends GroupMemberGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GroupMemberGroupByArgs['orderBy'] }
        : { orderBy?: GroupMemberGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, GroupMemberGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGroupMemberGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GroupMember model
   */
  readonly fields: GroupMemberFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GroupMember.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GroupMemberClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    group<T extends GroupDefaultArgs<ExtArgs> = {}>(args?: Subset<T, GroupDefaultArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the GroupMember model
   */
  interface GroupMemberFieldRefs {
    readonly id: FieldRef<"GroupMember", 'String'>
    readonly group_id: FieldRef<"GroupMember", 'String'>
    readonly user_id: FieldRef<"GroupMember", 'String'>
    readonly role: FieldRef<"GroupMember", 'String'>
    readonly joined_at: FieldRef<"GroupMember", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GroupMember findUnique
   */
  export type GroupMemberFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter, which GroupMember to fetch.
     */
    where: GroupMemberWhereUniqueInput
  }

  /**
   * GroupMember findUniqueOrThrow
   */
  export type GroupMemberFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter, which GroupMember to fetch.
     */
    where: GroupMemberWhereUniqueInput
  }

  /**
   * GroupMember findFirst
   */
  export type GroupMemberFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter, which GroupMember to fetch.
     */
    where?: GroupMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupMembers to fetch.
     */
    orderBy?: GroupMemberOrderByWithRelationInput | GroupMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GroupMembers.
     */
    cursor?: GroupMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GroupMembers.
     */
    distinct?: GroupMemberScalarFieldEnum | GroupMemberScalarFieldEnum[]
  }

  /**
   * GroupMember findFirstOrThrow
   */
  export type GroupMemberFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter, which GroupMember to fetch.
     */
    where?: GroupMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupMembers to fetch.
     */
    orderBy?: GroupMemberOrderByWithRelationInput | GroupMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GroupMembers.
     */
    cursor?: GroupMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GroupMembers.
     */
    distinct?: GroupMemberScalarFieldEnum | GroupMemberScalarFieldEnum[]
  }

  /**
   * GroupMember findMany
   */
  export type GroupMemberFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter, which GroupMembers to fetch.
     */
    where?: GroupMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GroupMembers to fetch.
     */
    orderBy?: GroupMemberOrderByWithRelationInput | GroupMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GroupMembers.
     */
    cursor?: GroupMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GroupMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GroupMembers.
     */
    skip?: number
    distinct?: GroupMemberScalarFieldEnum | GroupMemberScalarFieldEnum[]
  }

  /**
   * GroupMember create
   */
  export type GroupMemberCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * The data needed to create a GroupMember.
     */
    data: XOR<GroupMemberCreateInput, GroupMemberUncheckedCreateInput>
  }

  /**
   * GroupMember createMany
   */
  export type GroupMemberCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GroupMembers.
     */
    data: GroupMemberCreateManyInput | GroupMemberCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GroupMember createManyAndReturn
   */
  export type GroupMemberCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * The data used to create many GroupMembers.
     */
    data: GroupMemberCreateManyInput | GroupMemberCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * GroupMember update
   */
  export type GroupMemberUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * The data needed to update a GroupMember.
     */
    data: XOR<GroupMemberUpdateInput, GroupMemberUncheckedUpdateInput>
    /**
     * Choose, which GroupMember to update.
     */
    where: GroupMemberWhereUniqueInput
  }

  /**
   * GroupMember updateMany
   */
  export type GroupMemberUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GroupMembers.
     */
    data: XOR<GroupMemberUpdateManyMutationInput, GroupMemberUncheckedUpdateManyInput>
    /**
     * Filter which GroupMembers to update
     */
    where?: GroupMemberWhereInput
    /**
     * Limit how many GroupMembers to update.
     */
    limit?: number
  }

  /**
   * GroupMember updateManyAndReturn
   */
  export type GroupMemberUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * The data used to update GroupMembers.
     */
    data: XOR<GroupMemberUpdateManyMutationInput, GroupMemberUncheckedUpdateManyInput>
    /**
     * Filter which GroupMembers to update
     */
    where?: GroupMemberWhereInput
    /**
     * Limit how many GroupMembers to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * GroupMember upsert
   */
  export type GroupMemberUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * The filter to search for the GroupMember to update in case it exists.
     */
    where: GroupMemberWhereUniqueInput
    /**
     * In case the GroupMember found by the `where` argument doesn't exist, create a new GroupMember with this data.
     */
    create: XOR<GroupMemberCreateInput, GroupMemberUncheckedCreateInput>
    /**
     * In case the GroupMember was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GroupMemberUpdateInput, GroupMemberUncheckedUpdateInput>
  }

  /**
   * GroupMember delete
   */
  export type GroupMemberDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
    /**
     * Filter which GroupMember to delete.
     */
    where: GroupMemberWhereUniqueInput
  }

  /**
   * GroupMember deleteMany
   */
  export type GroupMemberDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GroupMembers to delete
     */
    where?: GroupMemberWhereInput
    /**
     * Limit how many GroupMembers to delete.
     */
    limit?: number
  }

  /**
   * GroupMember without action
   */
  export type GroupMemberDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GroupMember
     */
    select?: GroupMemberSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GroupMember
     */
    omit?: GroupMemberOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupMemberInclude<ExtArgs> | null
  }


  /**
   * Model Message
   */

  export type AggregateMessage = {
    _count: MessageCountAggregateOutputType | null
    _min: MessageMinAggregateOutputType | null
    _max: MessageMaxAggregateOutputType | null
  }

  export type MessageMinAggregateOutputType = {
    id: string | null
    sender_id: string | null
    recipient_id: string | null
    group_id: string | null
    parent_message_id: string | null
    thread_id: string | null
    message_type: string | null
    subject: string | null
    content: string | null
    is_read: boolean | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type MessageMaxAggregateOutputType = {
    id: string | null
    sender_id: string | null
    recipient_id: string | null
    group_id: string | null
    parent_message_id: string | null
    thread_id: string | null
    message_type: string | null
    subject: string | null
    content: string | null
    is_read: boolean | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type MessageCountAggregateOutputType = {
    id: number
    sender_id: number
    recipient_id: number
    group_id: number
    parent_message_id: number
    thread_id: number
    message_type: number
    subject: number
    content: number
    is_read: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type MessageMinAggregateInputType = {
    id?: true
    sender_id?: true
    recipient_id?: true
    group_id?: true
    parent_message_id?: true
    thread_id?: true
    message_type?: true
    subject?: true
    content?: true
    is_read?: true
    created_at?: true
    updated_at?: true
  }

  export type MessageMaxAggregateInputType = {
    id?: true
    sender_id?: true
    recipient_id?: true
    group_id?: true
    parent_message_id?: true
    thread_id?: true
    message_type?: true
    subject?: true
    content?: true
    is_read?: true
    created_at?: true
    updated_at?: true
  }

  export type MessageCountAggregateInputType = {
    id?: true
    sender_id?: true
    recipient_id?: true
    group_id?: true
    parent_message_id?: true
    thread_id?: true
    message_type?: true
    subject?: true
    content?: true
    is_read?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type MessageAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Message to aggregate.
     */
    where?: MessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Messages to fetch.
     */
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Messages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Messages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Messages
    **/
    _count?: true | MessageCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MessageMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MessageMaxAggregateInputType
  }

  export type GetMessageAggregateType<T extends MessageAggregateArgs> = {
        [P in keyof T & keyof AggregateMessage]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMessage[P]>
      : GetScalarType<T[P], AggregateMessage[P]>
  }




  export type MessageGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageWhereInput
    orderBy?: MessageOrderByWithAggregationInput | MessageOrderByWithAggregationInput[]
    by: MessageScalarFieldEnum[] | MessageScalarFieldEnum
    having?: MessageScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MessageCountAggregateInputType | true
    _min?: MessageMinAggregateInputType
    _max?: MessageMaxAggregateInputType
  }

  export type MessageGroupByOutputType = {
    id: string
    sender_id: string
    recipient_id: string | null
    group_id: string | null
    parent_message_id: string | null
    thread_id: string | null
    message_type: string
    subject: string
    content: string
    is_read: boolean
    created_at: Date
    updated_at: Date
    _count: MessageCountAggregateOutputType | null
    _min: MessageMinAggregateOutputType | null
    _max: MessageMaxAggregateOutputType | null
  }

  type GetMessageGroupByPayload<T extends MessageGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MessageGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MessageGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MessageGroupByOutputType[P]>
            : GetScalarType<T[P], MessageGroupByOutputType[P]>
        }
      >
    >


  export type MessageSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sender_id?: boolean
    recipient_id?: boolean
    group_id?: boolean
    parent_message_id?: boolean
    thread_id?: boolean
    message_type?: boolean
    subject?: boolean
    content?: boolean
    is_read?: boolean
    created_at?: boolean
    updated_at?: boolean
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
    replies?: boolean | Message$repliesArgs<ExtArgs>
    reads?: boolean | Message$readsArgs<ExtArgs>
    attachments?: boolean | Message$attachmentsArgs<ExtArgs>
    _count?: boolean | MessageCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["message"]>

  export type MessageSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sender_id?: boolean
    recipient_id?: boolean
    group_id?: boolean
    parent_message_id?: boolean
    thread_id?: boolean
    message_type?: boolean
    subject?: boolean
    content?: boolean
    is_read?: boolean
    created_at?: boolean
    updated_at?: boolean
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
  }, ExtArgs["result"]["message"]>

  export type MessageSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sender_id?: boolean
    recipient_id?: boolean
    group_id?: boolean
    parent_message_id?: boolean
    thread_id?: boolean
    message_type?: boolean
    subject?: boolean
    content?: boolean
    is_read?: boolean
    created_at?: boolean
    updated_at?: boolean
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
  }, ExtArgs["result"]["message"]>

  export type MessageSelectScalar = {
    id?: boolean
    sender_id?: boolean
    recipient_id?: boolean
    group_id?: boolean
    parent_message_id?: boolean
    thread_id?: boolean
    message_type?: boolean
    subject?: boolean
    content?: boolean
    is_read?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type MessageOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "sender_id" | "recipient_id" | "group_id" | "parent_message_id" | "thread_id" | "message_type" | "subject" | "content" | "is_read" | "created_at" | "updated_at", ExtArgs["result"]["message"]>
  export type MessageInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
    replies?: boolean | Message$repliesArgs<ExtArgs>
    reads?: boolean | Message$readsArgs<ExtArgs>
    attachments?: boolean | Message$attachmentsArgs<ExtArgs>
    _count?: boolean | MessageCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type MessageIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
  }
  export type MessageIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    group?: boolean | Message$groupArgs<ExtArgs>
    parent?: boolean | Message$parentArgs<ExtArgs>
  }

  export type $MessagePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Message"
    objects: {
      group: Prisma.$GroupPayload<ExtArgs> | null
      parent: Prisma.$MessagePayload<ExtArgs> | null
      replies: Prisma.$MessagePayload<ExtArgs>[]
      reads: Prisma.$MessageReadPayload<ExtArgs>[]
      attachments: Prisma.$MessageAttachmentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      sender_id: string
      recipient_id: string | null
      group_id: string | null
      parent_message_id: string | null
      thread_id: string | null
      message_type: string
      subject: string
      content: string
      is_read: boolean
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["message"]>
    composites: {}
  }

  type MessageGetPayload<S extends boolean | null | undefined | MessageDefaultArgs> = $Result.GetResult<Prisma.$MessagePayload, S>

  type MessageCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<MessageFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: MessageCountAggregateInputType | true
    }

  export interface MessageDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Message'], meta: { name: 'Message' } }
    /**
     * Find zero or one Message that matches the filter.
     * @param {MessageFindUniqueArgs} args - Arguments to find a Message
     * @example
     * // Get one Message
     * const message = await prisma.message.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MessageFindUniqueArgs>(args: SelectSubset<T, MessageFindUniqueArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Message that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {MessageFindUniqueOrThrowArgs} args - Arguments to find a Message
     * @example
     * // Get one Message
     * const message = await prisma.message.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MessageFindUniqueOrThrowArgs>(args: SelectSubset<T, MessageFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Message that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageFindFirstArgs} args - Arguments to find a Message
     * @example
     * // Get one Message
     * const message = await prisma.message.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MessageFindFirstArgs>(args?: SelectSubset<T, MessageFindFirstArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Message that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageFindFirstOrThrowArgs} args - Arguments to find a Message
     * @example
     * // Get one Message
     * const message = await prisma.message.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MessageFindFirstOrThrowArgs>(args?: SelectSubset<T, MessageFindFirstOrThrowArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Messages that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Messages
     * const messages = await prisma.message.findMany()
     * 
     * // Get first 10 Messages
     * const messages = await prisma.message.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const messageWithIdOnly = await prisma.message.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MessageFindManyArgs>(args?: SelectSubset<T, MessageFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Message.
     * @param {MessageCreateArgs} args - Arguments to create a Message.
     * @example
     * // Create one Message
     * const Message = await prisma.message.create({
     *   data: {
     *     // ... data to create a Message
     *   }
     * })
     * 
     */
    create<T extends MessageCreateArgs>(args: SelectSubset<T, MessageCreateArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Messages.
     * @param {MessageCreateManyArgs} args - Arguments to create many Messages.
     * @example
     * // Create many Messages
     * const message = await prisma.message.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MessageCreateManyArgs>(args?: SelectSubset<T, MessageCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Messages and returns the data saved in the database.
     * @param {MessageCreateManyAndReturnArgs} args - Arguments to create many Messages.
     * @example
     * // Create many Messages
     * const message = await prisma.message.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Messages and only return the `id`
     * const messageWithIdOnly = await prisma.message.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MessageCreateManyAndReturnArgs>(args?: SelectSubset<T, MessageCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Message.
     * @param {MessageDeleteArgs} args - Arguments to delete one Message.
     * @example
     * // Delete one Message
     * const Message = await prisma.message.delete({
     *   where: {
     *     // ... filter to delete one Message
     *   }
     * })
     * 
     */
    delete<T extends MessageDeleteArgs>(args: SelectSubset<T, MessageDeleteArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Message.
     * @param {MessageUpdateArgs} args - Arguments to update one Message.
     * @example
     * // Update one Message
     * const message = await prisma.message.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MessageUpdateArgs>(args: SelectSubset<T, MessageUpdateArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Messages.
     * @param {MessageDeleteManyArgs} args - Arguments to filter Messages to delete.
     * @example
     * // Delete a few Messages
     * const { count } = await prisma.message.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MessageDeleteManyArgs>(args?: SelectSubset<T, MessageDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Messages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Messages
     * const message = await prisma.message.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MessageUpdateManyArgs>(args: SelectSubset<T, MessageUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Messages and returns the data updated in the database.
     * @param {MessageUpdateManyAndReturnArgs} args - Arguments to update many Messages.
     * @example
     * // Update many Messages
     * const message = await prisma.message.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Messages and only return the `id`
     * const messageWithIdOnly = await prisma.message.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends MessageUpdateManyAndReturnArgs>(args: SelectSubset<T, MessageUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Message.
     * @param {MessageUpsertArgs} args - Arguments to update or create a Message.
     * @example
     * // Update or create a Message
     * const message = await prisma.message.upsert({
     *   create: {
     *     // ... data to create a Message
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Message we want to update
     *   }
     * })
     */
    upsert<T extends MessageUpsertArgs>(args: SelectSubset<T, MessageUpsertArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Messages.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageCountArgs} args - Arguments to filter Messages to count.
     * @example
     * // Count the number of Messages
     * const count = await prisma.message.count({
     *   where: {
     *     // ... the filter for the Messages we want to count
     *   }
     * })
    **/
    count<T extends MessageCountArgs>(
      args?: Subset<T, MessageCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MessageCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Message.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MessageAggregateArgs>(args: Subset<T, MessageAggregateArgs>): Prisma.PrismaPromise<GetMessageAggregateType<T>>

    /**
     * Group by Message.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MessageGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MessageGroupByArgs['orderBy'] }
        : { orderBy?: MessageGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MessageGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMessageGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Message model
   */
  readonly fields: MessageFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Message.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MessageClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    group<T extends Message$groupArgs<ExtArgs> = {}>(args?: Subset<T, Message$groupArgs<ExtArgs>>): Prisma__GroupClient<$Result.GetResult<Prisma.$GroupPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    parent<T extends Message$parentArgs<ExtArgs> = {}>(args?: Subset<T, Message$parentArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    replies<T extends Message$repliesArgs<ExtArgs> = {}>(args?: Subset<T, Message$repliesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    reads<T extends Message$readsArgs<ExtArgs> = {}>(args?: Subset<T, Message$readsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    attachments<T extends Message$attachmentsArgs<ExtArgs> = {}>(args?: Subset<T, Message$attachmentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Message model
   */
  interface MessageFieldRefs {
    readonly id: FieldRef<"Message", 'String'>
    readonly sender_id: FieldRef<"Message", 'String'>
    readonly recipient_id: FieldRef<"Message", 'String'>
    readonly group_id: FieldRef<"Message", 'String'>
    readonly parent_message_id: FieldRef<"Message", 'String'>
    readonly thread_id: FieldRef<"Message", 'String'>
    readonly message_type: FieldRef<"Message", 'String'>
    readonly subject: FieldRef<"Message", 'String'>
    readonly content: FieldRef<"Message", 'String'>
    readonly is_read: FieldRef<"Message", 'Boolean'>
    readonly created_at: FieldRef<"Message", 'DateTime'>
    readonly updated_at: FieldRef<"Message", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Message findUnique
   */
  export type MessageFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter, which Message to fetch.
     */
    where: MessageWhereUniqueInput
  }

  /**
   * Message findUniqueOrThrow
   */
  export type MessageFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter, which Message to fetch.
     */
    where: MessageWhereUniqueInput
  }

  /**
   * Message findFirst
   */
  export type MessageFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter, which Message to fetch.
     */
    where?: MessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Messages to fetch.
     */
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Messages.
     */
    cursor?: MessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Messages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Messages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Messages.
     */
    distinct?: MessageScalarFieldEnum | MessageScalarFieldEnum[]
  }

  /**
   * Message findFirstOrThrow
   */
  export type MessageFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter, which Message to fetch.
     */
    where?: MessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Messages to fetch.
     */
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Messages.
     */
    cursor?: MessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Messages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Messages.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Messages.
     */
    distinct?: MessageScalarFieldEnum | MessageScalarFieldEnum[]
  }

  /**
   * Message findMany
   */
  export type MessageFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter, which Messages to fetch.
     */
    where?: MessageWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Messages to fetch.
     */
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Messages.
     */
    cursor?: MessageWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Messages from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Messages.
     */
    skip?: number
    distinct?: MessageScalarFieldEnum | MessageScalarFieldEnum[]
  }

  /**
   * Message create
   */
  export type MessageCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * The data needed to create a Message.
     */
    data: XOR<MessageCreateInput, MessageUncheckedCreateInput>
  }

  /**
   * Message createMany
   */
  export type MessageCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Messages.
     */
    data: MessageCreateManyInput | MessageCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Message createManyAndReturn
   */
  export type MessageCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * The data used to create many Messages.
     */
    data: MessageCreateManyInput | MessageCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Message update
   */
  export type MessageUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * The data needed to update a Message.
     */
    data: XOR<MessageUpdateInput, MessageUncheckedUpdateInput>
    /**
     * Choose, which Message to update.
     */
    where: MessageWhereUniqueInput
  }

  /**
   * Message updateMany
   */
  export type MessageUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Messages.
     */
    data: XOR<MessageUpdateManyMutationInput, MessageUncheckedUpdateManyInput>
    /**
     * Filter which Messages to update
     */
    where?: MessageWhereInput
    /**
     * Limit how many Messages to update.
     */
    limit?: number
  }

  /**
   * Message updateManyAndReturn
   */
  export type MessageUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * The data used to update Messages.
     */
    data: XOR<MessageUpdateManyMutationInput, MessageUncheckedUpdateManyInput>
    /**
     * Filter which Messages to update
     */
    where?: MessageWhereInput
    /**
     * Limit how many Messages to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Message upsert
   */
  export type MessageUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * The filter to search for the Message to update in case it exists.
     */
    where: MessageWhereUniqueInput
    /**
     * In case the Message found by the `where` argument doesn't exist, create a new Message with this data.
     */
    create: XOR<MessageCreateInput, MessageUncheckedCreateInput>
    /**
     * In case the Message was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MessageUpdateInput, MessageUncheckedUpdateInput>
  }

  /**
   * Message delete
   */
  export type MessageDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    /**
     * Filter which Message to delete.
     */
    where: MessageWhereUniqueInput
  }

  /**
   * Message deleteMany
   */
  export type MessageDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Messages to delete
     */
    where?: MessageWhereInput
    /**
     * Limit how many Messages to delete.
     */
    limit?: number
  }

  /**
   * Message.group
   */
  export type Message$groupArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Group
     */
    select?: GroupSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Group
     */
    omit?: GroupOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: GroupInclude<ExtArgs> | null
    where?: GroupWhereInput
  }

  /**
   * Message.parent
   */
  export type Message$parentArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    where?: MessageWhereInput
  }

  /**
   * Message.replies
   */
  export type Message$repliesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
    where?: MessageWhereInput
    orderBy?: MessageOrderByWithRelationInput | MessageOrderByWithRelationInput[]
    cursor?: MessageWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MessageScalarFieldEnum | MessageScalarFieldEnum[]
  }

  /**
   * Message.reads
   */
  export type Message$readsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    where?: MessageReadWhereInput
    orderBy?: MessageReadOrderByWithRelationInput | MessageReadOrderByWithRelationInput[]
    cursor?: MessageReadWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MessageReadScalarFieldEnum | MessageReadScalarFieldEnum[]
  }

  /**
   * Message.attachments
   */
  export type Message$attachmentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    where?: MessageAttachmentWhereInput
    orderBy?: MessageAttachmentOrderByWithRelationInput | MessageAttachmentOrderByWithRelationInput[]
    cursor?: MessageAttachmentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MessageAttachmentScalarFieldEnum | MessageAttachmentScalarFieldEnum[]
  }

  /**
   * Message without action
   */
  export type MessageDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Message
     */
    select?: MessageSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Message
     */
    omit?: MessageOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageInclude<ExtArgs> | null
  }


  /**
   * Model MessageAttachment
   */

  export type AggregateMessageAttachment = {
    _count: MessageAttachmentCountAggregateOutputType | null
    _avg: MessageAttachmentAvgAggregateOutputType | null
    _sum: MessageAttachmentSumAggregateOutputType | null
    _min: MessageAttachmentMinAggregateOutputType | null
    _max: MessageAttachmentMaxAggregateOutputType | null
  }

  export type MessageAttachmentAvgAggregateOutputType = {
    file_size: number | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type MessageAttachmentSumAggregateOutputType = {
    file_size: bigint | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
  }

  export type MessageAttachmentMinAggregateOutputType = {
    id: string | null
    message_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type MessageAttachmentMaxAggregateOutputType = {
    id: string | null
    message_id: string | null
    file_url: string | null
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string | null
    width: number | null
    height: number | null
    duration: number | null
    display_order: number | null
    created_at: Date | null
  }

  export type MessageAttachmentCountAggregateOutputType = {
    id: number
    message_id: number
    file_url: number
    file_path: number
    thumbnail_url: number
    file_name: number
    file_size: number
    mime_type: number
    file_type: number
    width: number
    height: number
    duration: number
    display_order: number
    created_at: number
    _all: number
  }


  export type MessageAttachmentAvgAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type MessageAttachmentSumAggregateInputType = {
    file_size?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
  }

  export type MessageAttachmentMinAggregateInputType = {
    id?: true
    message_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type MessageAttachmentMaxAggregateInputType = {
    id?: true
    message_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
  }

  export type MessageAttachmentCountAggregateInputType = {
    id?: true
    message_id?: true
    file_url?: true
    file_path?: true
    thumbnail_url?: true
    file_name?: true
    file_size?: true
    mime_type?: true
    file_type?: true
    width?: true
    height?: true
    duration?: true
    display_order?: true
    created_at?: true
    _all?: true
  }

  export type MessageAttachmentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MessageAttachment to aggregate.
     */
    where?: MessageAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageAttachments to fetch.
     */
    orderBy?: MessageAttachmentOrderByWithRelationInput | MessageAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MessageAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned MessageAttachments
    **/
    _count?: true | MessageAttachmentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MessageAttachmentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MessageAttachmentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MessageAttachmentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MessageAttachmentMaxAggregateInputType
  }

  export type GetMessageAttachmentAggregateType<T extends MessageAttachmentAggregateArgs> = {
        [P in keyof T & keyof AggregateMessageAttachment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMessageAttachment[P]>
      : GetScalarType<T[P], AggregateMessageAttachment[P]>
  }




  export type MessageAttachmentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageAttachmentWhereInput
    orderBy?: MessageAttachmentOrderByWithAggregationInput | MessageAttachmentOrderByWithAggregationInput[]
    by: MessageAttachmentScalarFieldEnum[] | MessageAttachmentScalarFieldEnum
    having?: MessageAttachmentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MessageAttachmentCountAggregateInputType | true
    _avg?: MessageAttachmentAvgAggregateInputType
    _sum?: MessageAttachmentSumAggregateInputType
    _min?: MessageAttachmentMinAggregateInputType
    _max?: MessageAttachmentMaxAggregateInputType
  }

  export type MessageAttachmentGroupByOutputType = {
    id: string
    message_id: string
    file_url: string
    file_path: string | null
    thumbnail_url: string | null
    file_name: string | null
    file_size: bigint | null
    mime_type: string | null
    file_type: string
    width: number | null
    height: number | null
    duration: number | null
    display_order: number
    created_at: Date
    _count: MessageAttachmentCountAggregateOutputType | null
    _avg: MessageAttachmentAvgAggregateOutputType | null
    _sum: MessageAttachmentSumAggregateOutputType | null
    _min: MessageAttachmentMinAggregateOutputType | null
    _max: MessageAttachmentMaxAggregateOutputType | null
  }

  type GetMessageAttachmentGroupByPayload<T extends MessageAttachmentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MessageAttachmentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MessageAttachmentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MessageAttachmentGroupByOutputType[P]>
            : GetScalarType<T[P], MessageAttachmentGroupByOutputType[P]>
        }
      >
    >


  export type MessageAttachmentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageAttachment"]>

  export type MessageAttachmentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageAttachment"]>

  export type MessageAttachmentSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageAttachment"]>

  export type MessageAttachmentSelectScalar = {
    id?: boolean
    message_id?: boolean
    file_url?: boolean
    file_path?: boolean
    thumbnail_url?: boolean
    file_name?: boolean
    file_size?: boolean
    mime_type?: boolean
    file_type?: boolean
    width?: boolean
    height?: boolean
    duration?: boolean
    display_order?: boolean
    created_at?: boolean
  }

  export type MessageAttachmentOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "message_id" | "file_url" | "file_path" | "thumbnail_url" | "file_name" | "file_size" | "mime_type" | "file_type" | "width" | "height" | "duration" | "display_order" | "created_at", ExtArgs["result"]["messageAttachment"]>
  export type MessageAttachmentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }
  export type MessageAttachmentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }
  export type MessageAttachmentIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }

  export type $MessageAttachmentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "MessageAttachment"
    objects: {
      message: Prisma.$MessagePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      message_id: string
      file_url: string
      file_path: string | null
      thumbnail_url: string | null
      file_name: string | null
      file_size: bigint | null
      mime_type: string | null
      file_type: string
      width: number | null
      height: number | null
      duration: number | null
      display_order: number
      created_at: Date
    }, ExtArgs["result"]["messageAttachment"]>
    composites: {}
  }

  type MessageAttachmentGetPayload<S extends boolean | null | undefined | MessageAttachmentDefaultArgs> = $Result.GetResult<Prisma.$MessageAttachmentPayload, S>

  type MessageAttachmentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<MessageAttachmentFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: MessageAttachmentCountAggregateInputType | true
    }

  export interface MessageAttachmentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['MessageAttachment'], meta: { name: 'MessageAttachment' } }
    /**
     * Find zero or one MessageAttachment that matches the filter.
     * @param {MessageAttachmentFindUniqueArgs} args - Arguments to find a MessageAttachment
     * @example
     * // Get one MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MessageAttachmentFindUniqueArgs>(args: SelectSubset<T, MessageAttachmentFindUniqueArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one MessageAttachment that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {MessageAttachmentFindUniqueOrThrowArgs} args - Arguments to find a MessageAttachment
     * @example
     * // Get one MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MessageAttachmentFindUniqueOrThrowArgs>(args: SelectSubset<T, MessageAttachmentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first MessageAttachment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentFindFirstArgs} args - Arguments to find a MessageAttachment
     * @example
     * // Get one MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MessageAttachmentFindFirstArgs>(args?: SelectSubset<T, MessageAttachmentFindFirstArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first MessageAttachment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentFindFirstOrThrowArgs} args - Arguments to find a MessageAttachment
     * @example
     * // Get one MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MessageAttachmentFindFirstOrThrowArgs>(args?: SelectSubset<T, MessageAttachmentFindFirstOrThrowArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more MessageAttachments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all MessageAttachments
     * const messageAttachments = await prisma.messageAttachment.findMany()
     * 
     * // Get first 10 MessageAttachments
     * const messageAttachments = await prisma.messageAttachment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const messageAttachmentWithIdOnly = await prisma.messageAttachment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MessageAttachmentFindManyArgs>(args?: SelectSubset<T, MessageAttachmentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a MessageAttachment.
     * @param {MessageAttachmentCreateArgs} args - Arguments to create a MessageAttachment.
     * @example
     * // Create one MessageAttachment
     * const MessageAttachment = await prisma.messageAttachment.create({
     *   data: {
     *     // ... data to create a MessageAttachment
     *   }
     * })
     * 
     */
    create<T extends MessageAttachmentCreateArgs>(args: SelectSubset<T, MessageAttachmentCreateArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many MessageAttachments.
     * @param {MessageAttachmentCreateManyArgs} args - Arguments to create many MessageAttachments.
     * @example
     * // Create many MessageAttachments
     * const messageAttachment = await prisma.messageAttachment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MessageAttachmentCreateManyArgs>(args?: SelectSubset<T, MessageAttachmentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many MessageAttachments and returns the data saved in the database.
     * @param {MessageAttachmentCreateManyAndReturnArgs} args - Arguments to create many MessageAttachments.
     * @example
     * // Create many MessageAttachments
     * const messageAttachment = await prisma.messageAttachment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many MessageAttachments and only return the `id`
     * const messageAttachmentWithIdOnly = await prisma.messageAttachment.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MessageAttachmentCreateManyAndReturnArgs>(args?: SelectSubset<T, MessageAttachmentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a MessageAttachment.
     * @param {MessageAttachmentDeleteArgs} args - Arguments to delete one MessageAttachment.
     * @example
     * // Delete one MessageAttachment
     * const MessageAttachment = await prisma.messageAttachment.delete({
     *   where: {
     *     // ... filter to delete one MessageAttachment
     *   }
     * })
     * 
     */
    delete<T extends MessageAttachmentDeleteArgs>(args: SelectSubset<T, MessageAttachmentDeleteArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one MessageAttachment.
     * @param {MessageAttachmentUpdateArgs} args - Arguments to update one MessageAttachment.
     * @example
     * // Update one MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MessageAttachmentUpdateArgs>(args: SelectSubset<T, MessageAttachmentUpdateArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more MessageAttachments.
     * @param {MessageAttachmentDeleteManyArgs} args - Arguments to filter MessageAttachments to delete.
     * @example
     * // Delete a few MessageAttachments
     * const { count } = await prisma.messageAttachment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MessageAttachmentDeleteManyArgs>(args?: SelectSubset<T, MessageAttachmentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MessageAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many MessageAttachments
     * const messageAttachment = await prisma.messageAttachment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MessageAttachmentUpdateManyArgs>(args: SelectSubset<T, MessageAttachmentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MessageAttachments and returns the data updated in the database.
     * @param {MessageAttachmentUpdateManyAndReturnArgs} args - Arguments to update many MessageAttachments.
     * @example
     * // Update many MessageAttachments
     * const messageAttachment = await prisma.messageAttachment.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more MessageAttachments and only return the `id`
     * const messageAttachmentWithIdOnly = await prisma.messageAttachment.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends MessageAttachmentUpdateManyAndReturnArgs>(args: SelectSubset<T, MessageAttachmentUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one MessageAttachment.
     * @param {MessageAttachmentUpsertArgs} args - Arguments to update or create a MessageAttachment.
     * @example
     * // Update or create a MessageAttachment
     * const messageAttachment = await prisma.messageAttachment.upsert({
     *   create: {
     *     // ... data to create a MessageAttachment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the MessageAttachment we want to update
     *   }
     * })
     */
    upsert<T extends MessageAttachmentUpsertArgs>(args: SelectSubset<T, MessageAttachmentUpsertArgs<ExtArgs>>): Prisma__MessageAttachmentClient<$Result.GetResult<Prisma.$MessageAttachmentPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of MessageAttachments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentCountArgs} args - Arguments to filter MessageAttachments to count.
     * @example
     * // Count the number of MessageAttachments
     * const count = await prisma.messageAttachment.count({
     *   where: {
     *     // ... the filter for the MessageAttachments we want to count
     *   }
     * })
    **/
    count<T extends MessageAttachmentCountArgs>(
      args?: Subset<T, MessageAttachmentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MessageAttachmentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a MessageAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MessageAttachmentAggregateArgs>(args: Subset<T, MessageAttachmentAggregateArgs>): Prisma.PrismaPromise<GetMessageAttachmentAggregateType<T>>

    /**
     * Group by MessageAttachment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageAttachmentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MessageAttachmentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MessageAttachmentGroupByArgs['orderBy'] }
        : { orderBy?: MessageAttachmentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MessageAttachmentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMessageAttachmentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the MessageAttachment model
   */
  readonly fields: MessageAttachmentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for MessageAttachment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MessageAttachmentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    message<T extends MessageDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MessageDefaultArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the MessageAttachment model
   */
  interface MessageAttachmentFieldRefs {
    readonly id: FieldRef<"MessageAttachment", 'String'>
    readonly message_id: FieldRef<"MessageAttachment", 'String'>
    readonly file_url: FieldRef<"MessageAttachment", 'String'>
    readonly file_path: FieldRef<"MessageAttachment", 'String'>
    readonly thumbnail_url: FieldRef<"MessageAttachment", 'String'>
    readonly file_name: FieldRef<"MessageAttachment", 'String'>
    readonly file_size: FieldRef<"MessageAttachment", 'BigInt'>
    readonly mime_type: FieldRef<"MessageAttachment", 'String'>
    readonly file_type: FieldRef<"MessageAttachment", 'String'>
    readonly width: FieldRef<"MessageAttachment", 'Int'>
    readonly height: FieldRef<"MessageAttachment", 'Int'>
    readonly duration: FieldRef<"MessageAttachment", 'Int'>
    readonly display_order: FieldRef<"MessageAttachment", 'Int'>
    readonly created_at: FieldRef<"MessageAttachment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * MessageAttachment findUnique
   */
  export type MessageAttachmentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which MessageAttachment to fetch.
     */
    where: MessageAttachmentWhereUniqueInput
  }

  /**
   * MessageAttachment findUniqueOrThrow
   */
  export type MessageAttachmentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which MessageAttachment to fetch.
     */
    where: MessageAttachmentWhereUniqueInput
  }

  /**
   * MessageAttachment findFirst
   */
  export type MessageAttachmentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which MessageAttachment to fetch.
     */
    where?: MessageAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageAttachments to fetch.
     */
    orderBy?: MessageAttachmentOrderByWithRelationInput | MessageAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MessageAttachments.
     */
    cursor?: MessageAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MessageAttachments.
     */
    distinct?: MessageAttachmentScalarFieldEnum | MessageAttachmentScalarFieldEnum[]
  }

  /**
   * MessageAttachment findFirstOrThrow
   */
  export type MessageAttachmentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which MessageAttachment to fetch.
     */
    where?: MessageAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageAttachments to fetch.
     */
    orderBy?: MessageAttachmentOrderByWithRelationInput | MessageAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MessageAttachments.
     */
    cursor?: MessageAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageAttachments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MessageAttachments.
     */
    distinct?: MessageAttachmentScalarFieldEnum | MessageAttachmentScalarFieldEnum[]
  }

  /**
   * MessageAttachment findMany
   */
  export type MessageAttachmentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter, which MessageAttachments to fetch.
     */
    where?: MessageAttachmentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageAttachments to fetch.
     */
    orderBy?: MessageAttachmentOrderByWithRelationInput | MessageAttachmentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing MessageAttachments.
     */
    cursor?: MessageAttachmentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageAttachments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageAttachments.
     */
    skip?: number
    distinct?: MessageAttachmentScalarFieldEnum | MessageAttachmentScalarFieldEnum[]
  }

  /**
   * MessageAttachment create
   */
  export type MessageAttachmentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to create a MessageAttachment.
     */
    data: XOR<MessageAttachmentCreateInput, MessageAttachmentUncheckedCreateInput>
  }

  /**
   * MessageAttachment createMany
   */
  export type MessageAttachmentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many MessageAttachments.
     */
    data: MessageAttachmentCreateManyInput | MessageAttachmentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * MessageAttachment createManyAndReturn
   */
  export type MessageAttachmentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * The data used to create many MessageAttachments.
     */
    data: MessageAttachmentCreateManyInput | MessageAttachmentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * MessageAttachment update
   */
  export type MessageAttachmentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * The data needed to update a MessageAttachment.
     */
    data: XOR<MessageAttachmentUpdateInput, MessageAttachmentUncheckedUpdateInput>
    /**
     * Choose, which MessageAttachment to update.
     */
    where: MessageAttachmentWhereUniqueInput
  }

  /**
   * MessageAttachment updateMany
   */
  export type MessageAttachmentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update MessageAttachments.
     */
    data: XOR<MessageAttachmentUpdateManyMutationInput, MessageAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which MessageAttachments to update
     */
    where?: MessageAttachmentWhereInput
    /**
     * Limit how many MessageAttachments to update.
     */
    limit?: number
  }

  /**
   * MessageAttachment updateManyAndReturn
   */
  export type MessageAttachmentUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * The data used to update MessageAttachments.
     */
    data: XOR<MessageAttachmentUpdateManyMutationInput, MessageAttachmentUncheckedUpdateManyInput>
    /**
     * Filter which MessageAttachments to update
     */
    where?: MessageAttachmentWhereInput
    /**
     * Limit how many MessageAttachments to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * MessageAttachment upsert
   */
  export type MessageAttachmentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * The filter to search for the MessageAttachment to update in case it exists.
     */
    where: MessageAttachmentWhereUniqueInput
    /**
     * In case the MessageAttachment found by the `where` argument doesn't exist, create a new MessageAttachment with this data.
     */
    create: XOR<MessageAttachmentCreateInput, MessageAttachmentUncheckedCreateInput>
    /**
     * In case the MessageAttachment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MessageAttachmentUpdateInput, MessageAttachmentUncheckedUpdateInput>
  }

  /**
   * MessageAttachment delete
   */
  export type MessageAttachmentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
    /**
     * Filter which MessageAttachment to delete.
     */
    where: MessageAttachmentWhereUniqueInput
  }

  /**
   * MessageAttachment deleteMany
   */
  export type MessageAttachmentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MessageAttachments to delete
     */
    where?: MessageAttachmentWhereInput
    /**
     * Limit how many MessageAttachments to delete.
     */
    limit?: number
  }

  /**
   * MessageAttachment without action
   */
  export type MessageAttachmentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageAttachment
     */
    select?: MessageAttachmentSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageAttachment
     */
    omit?: MessageAttachmentOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageAttachmentInclude<ExtArgs> | null
  }


  /**
   * Model MessageRead
   */

  export type AggregateMessageRead = {
    _count: MessageReadCountAggregateOutputType | null
    _min: MessageReadMinAggregateOutputType | null
    _max: MessageReadMaxAggregateOutputType | null
  }

  export type MessageReadMinAggregateOutputType = {
    id: string | null
    message_id: string | null
    user_id: string | null
    read_at: Date | null
    read_by_sender: boolean | null
  }

  export type MessageReadMaxAggregateOutputType = {
    id: string | null
    message_id: string | null
    user_id: string | null
    read_at: Date | null
    read_by_sender: boolean | null
  }

  export type MessageReadCountAggregateOutputType = {
    id: number
    message_id: number
    user_id: number
    read_at: number
    read_by_sender: number
    _all: number
  }


  export type MessageReadMinAggregateInputType = {
    id?: true
    message_id?: true
    user_id?: true
    read_at?: true
    read_by_sender?: true
  }

  export type MessageReadMaxAggregateInputType = {
    id?: true
    message_id?: true
    user_id?: true
    read_at?: true
    read_by_sender?: true
  }

  export type MessageReadCountAggregateInputType = {
    id?: true
    message_id?: true
    user_id?: true
    read_at?: true
    read_by_sender?: true
    _all?: true
  }

  export type MessageReadAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MessageRead to aggregate.
     */
    where?: MessageReadWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageReads to fetch.
     */
    orderBy?: MessageReadOrderByWithRelationInput | MessageReadOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MessageReadWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageReads from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageReads.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned MessageReads
    **/
    _count?: true | MessageReadCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MessageReadMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MessageReadMaxAggregateInputType
  }

  export type GetMessageReadAggregateType<T extends MessageReadAggregateArgs> = {
        [P in keyof T & keyof AggregateMessageRead]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMessageRead[P]>
      : GetScalarType<T[P], AggregateMessageRead[P]>
  }




  export type MessageReadGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MessageReadWhereInput
    orderBy?: MessageReadOrderByWithAggregationInput | MessageReadOrderByWithAggregationInput[]
    by: MessageReadScalarFieldEnum[] | MessageReadScalarFieldEnum
    having?: MessageReadScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MessageReadCountAggregateInputType | true
    _min?: MessageReadMinAggregateInputType
    _max?: MessageReadMaxAggregateInputType
  }

  export type MessageReadGroupByOutputType = {
    id: string
    message_id: string
    user_id: string
    read_at: Date
    read_by_sender: boolean
    _count: MessageReadCountAggregateOutputType | null
    _min: MessageReadMinAggregateOutputType | null
    _max: MessageReadMaxAggregateOutputType | null
  }

  type GetMessageReadGroupByPayload<T extends MessageReadGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MessageReadGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MessageReadGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MessageReadGroupByOutputType[P]>
            : GetScalarType<T[P], MessageReadGroupByOutputType[P]>
        }
      >
    >


  export type MessageReadSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    user_id?: boolean
    read_at?: boolean
    read_by_sender?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageRead"]>

  export type MessageReadSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    user_id?: boolean
    read_at?: boolean
    read_by_sender?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageRead"]>

  export type MessageReadSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    message_id?: boolean
    user_id?: boolean
    read_at?: boolean
    read_by_sender?: boolean
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["messageRead"]>

  export type MessageReadSelectScalar = {
    id?: boolean
    message_id?: boolean
    user_id?: boolean
    read_at?: boolean
    read_by_sender?: boolean
  }

  export type MessageReadOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "message_id" | "user_id" | "read_at" | "read_by_sender", ExtArgs["result"]["messageRead"]>
  export type MessageReadInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }
  export type MessageReadIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }
  export type MessageReadIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    message?: boolean | MessageDefaultArgs<ExtArgs>
  }

  export type $MessageReadPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "MessageRead"
    objects: {
      message: Prisma.$MessagePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      message_id: string
      user_id: string
      read_at: Date
      read_by_sender: boolean
    }, ExtArgs["result"]["messageRead"]>
    composites: {}
  }

  type MessageReadGetPayload<S extends boolean | null | undefined | MessageReadDefaultArgs> = $Result.GetResult<Prisma.$MessageReadPayload, S>

  type MessageReadCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<MessageReadFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: MessageReadCountAggregateInputType | true
    }

  export interface MessageReadDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['MessageRead'], meta: { name: 'MessageRead' } }
    /**
     * Find zero or one MessageRead that matches the filter.
     * @param {MessageReadFindUniqueArgs} args - Arguments to find a MessageRead
     * @example
     * // Get one MessageRead
     * const messageRead = await prisma.messageRead.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MessageReadFindUniqueArgs>(args: SelectSubset<T, MessageReadFindUniqueArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one MessageRead that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {MessageReadFindUniqueOrThrowArgs} args - Arguments to find a MessageRead
     * @example
     * // Get one MessageRead
     * const messageRead = await prisma.messageRead.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MessageReadFindUniqueOrThrowArgs>(args: SelectSubset<T, MessageReadFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first MessageRead that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadFindFirstArgs} args - Arguments to find a MessageRead
     * @example
     * // Get one MessageRead
     * const messageRead = await prisma.messageRead.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MessageReadFindFirstArgs>(args?: SelectSubset<T, MessageReadFindFirstArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first MessageRead that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadFindFirstOrThrowArgs} args - Arguments to find a MessageRead
     * @example
     * // Get one MessageRead
     * const messageRead = await prisma.messageRead.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MessageReadFindFirstOrThrowArgs>(args?: SelectSubset<T, MessageReadFindFirstOrThrowArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more MessageReads that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all MessageReads
     * const messageReads = await prisma.messageRead.findMany()
     * 
     * // Get first 10 MessageReads
     * const messageReads = await prisma.messageRead.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const messageReadWithIdOnly = await prisma.messageRead.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MessageReadFindManyArgs>(args?: SelectSubset<T, MessageReadFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a MessageRead.
     * @param {MessageReadCreateArgs} args - Arguments to create a MessageRead.
     * @example
     * // Create one MessageRead
     * const MessageRead = await prisma.messageRead.create({
     *   data: {
     *     // ... data to create a MessageRead
     *   }
     * })
     * 
     */
    create<T extends MessageReadCreateArgs>(args: SelectSubset<T, MessageReadCreateArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many MessageReads.
     * @param {MessageReadCreateManyArgs} args - Arguments to create many MessageReads.
     * @example
     * // Create many MessageReads
     * const messageRead = await prisma.messageRead.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MessageReadCreateManyArgs>(args?: SelectSubset<T, MessageReadCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many MessageReads and returns the data saved in the database.
     * @param {MessageReadCreateManyAndReturnArgs} args - Arguments to create many MessageReads.
     * @example
     * // Create many MessageReads
     * const messageRead = await prisma.messageRead.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many MessageReads and only return the `id`
     * const messageReadWithIdOnly = await prisma.messageRead.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MessageReadCreateManyAndReturnArgs>(args?: SelectSubset<T, MessageReadCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a MessageRead.
     * @param {MessageReadDeleteArgs} args - Arguments to delete one MessageRead.
     * @example
     * // Delete one MessageRead
     * const MessageRead = await prisma.messageRead.delete({
     *   where: {
     *     // ... filter to delete one MessageRead
     *   }
     * })
     * 
     */
    delete<T extends MessageReadDeleteArgs>(args: SelectSubset<T, MessageReadDeleteArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one MessageRead.
     * @param {MessageReadUpdateArgs} args - Arguments to update one MessageRead.
     * @example
     * // Update one MessageRead
     * const messageRead = await prisma.messageRead.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MessageReadUpdateArgs>(args: SelectSubset<T, MessageReadUpdateArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more MessageReads.
     * @param {MessageReadDeleteManyArgs} args - Arguments to filter MessageReads to delete.
     * @example
     * // Delete a few MessageReads
     * const { count } = await prisma.messageRead.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MessageReadDeleteManyArgs>(args?: SelectSubset<T, MessageReadDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MessageReads.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many MessageReads
     * const messageRead = await prisma.messageRead.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MessageReadUpdateManyArgs>(args: SelectSubset<T, MessageReadUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MessageReads and returns the data updated in the database.
     * @param {MessageReadUpdateManyAndReturnArgs} args - Arguments to update many MessageReads.
     * @example
     * // Update many MessageReads
     * const messageRead = await prisma.messageRead.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more MessageReads and only return the `id`
     * const messageReadWithIdOnly = await prisma.messageRead.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends MessageReadUpdateManyAndReturnArgs>(args: SelectSubset<T, MessageReadUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one MessageRead.
     * @param {MessageReadUpsertArgs} args - Arguments to update or create a MessageRead.
     * @example
     * // Update or create a MessageRead
     * const messageRead = await prisma.messageRead.upsert({
     *   create: {
     *     // ... data to create a MessageRead
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the MessageRead we want to update
     *   }
     * })
     */
    upsert<T extends MessageReadUpsertArgs>(args: SelectSubset<T, MessageReadUpsertArgs<ExtArgs>>): Prisma__MessageReadClient<$Result.GetResult<Prisma.$MessageReadPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of MessageReads.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadCountArgs} args - Arguments to filter MessageReads to count.
     * @example
     * // Count the number of MessageReads
     * const count = await prisma.messageRead.count({
     *   where: {
     *     // ... the filter for the MessageReads we want to count
     *   }
     * })
    **/
    count<T extends MessageReadCountArgs>(
      args?: Subset<T, MessageReadCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MessageReadCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a MessageRead.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MessageReadAggregateArgs>(args: Subset<T, MessageReadAggregateArgs>): Prisma.PrismaPromise<GetMessageReadAggregateType<T>>

    /**
     * Group by MessageRead.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MessageReadGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MessageReadGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MessageReadGroupByArgs['orderBy'] }
        : { orderBy?: MessageReadGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MessageReadGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMessageReadGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the MessageRead model
   */
  readonly fields: MessageReadFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for MessageRead.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MessageReadClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    message<T extends MessageDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MessageDefaultArgs<ExtArgs>>): Prisma__MessageClient<$Result.GetResult<Prisma.$MessagePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the MessageRead model
   */
  interface MessageReadFieldRefs {
    readonly id: FieldRef<"MessageRead", 'String'>
    readonly message_id: FieldRef<"MessageRead", 'String'>
    readonly user_id: FieldRef<"MessageRead", 'String'>
    readonly read_at: FieldRef<"MessageRead", 'DateTime'>
    readonly read_by_sender: FieldRef<"MessageRead", 'Boolean'>
  }
    

  // Custom InputTypes
  /**
   * MessageRead findUnique
   */
  export type MessageReadFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter, which MessageRead to fetch.
     */
    where: MessageReadWhereUniqueInput
  }

  /**
   * MessageRead findUniqueOrThrow
   */
  export type MessageReadFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter, which MessageRead to fetch.
     */
    where: MessageReadWhereUniqueInput
  }

  /**
   * MessageRead findFirst
   */
  export type MessageReadFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter, which MessageRead to fetch.
     */
    where?: MessageReadWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageReads to fetch.
     */
    orderBy?: MessageReadOrderByWithRelationInput | MessageReadOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MessageReads.
     */
    cursor?: MessageReadWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageReads from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageReads.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MessageReads.
     */
    distinct?: MessageReadScalarFieldEnum | MessageReadScalarFieldEnum[]
  }

  /**
   * MessageRead findFirstOrThrow
   */
  export type MessageReadFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter, which MessageRead to fetch.
     */
    where?: MessageReadWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageReads to fetch.
     */
    orderBy?: MessageReadOrderByWithRelationInput | MessageReadOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MessageReads.
     */
    cursor?: MessageReadWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageReads from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageReads.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MessageReads.
     */
    distinct?: MessageReadScalarFieldEnum | MessageReadScalarFieldEnum[]
  }

  /**
   * MessageRead findMany
   */
  export type MessageReadFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter, which MessageReads to fetch.
     */
    where?: MessageReadWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MessageReads to fetch.
     */
    orderBy?: MessageReadOrderByWithRelationInput | MessageReadOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing MessageReads.
     */
    cursor?: MessageReadWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MessageReads from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MessageReads.
     */
    skip?: number
    distinct?: MessageReadScalarFieldEnum | MessageReadScalarFieldEnum[]
  }

  /**
   * MessageRead create
   */
  export type MessageReadCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * The data needed to create a MessageRead.
     */
    data: XOR<MessageReadCreateInput, MessageReadUncheckedCreateInput>
  }

  /**
   * MessageRead createMany
   */
  export type MessageReadCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many MessageReads.
     */
    data: MessageReadCreateManyInput | MessageReadCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * MessageRead createManyAndReturn
   */
  export type MessageReadCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * The data used to create many MessageReads.
     */
    data: MessageReadCreateManyInput | MessageReadCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * MessageRead update
   */
  export type MessageReadUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * The data needed to update a MessageRead.
     */
    data: XOR<MessageReadUpdateInput, MessageReadUncheckedUpdateInput>
    /**
     * Choose, which MessageRead to update.
     */
    where: MessageReadWhereUniqueInput
  }

  /**
   * MessageRead updateMany
   */
  export type MessageReadUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update MessageReads.
     */
    data: XOR<MessageReadUpdateManyMutationInput, MessageReadUncheckedUpdateManyInput>
    /**
     * Filter which MessageReads to update
     */
    where?: MessageReadWhereInput
    /**
     * Limit how many MessageReads to update.
     */
    limit?: number
  }

  /**
   * MessageRead updateManyAndReturn
   */
  export type MessageReadUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * The data used to update MessageReads.
     */
    data: XOR<MessageReadUpdateManyMutationInput, MessageReadUncheckedUpdateManyInput>
    /**
     * Filter which MessageReads to update
     */
    where?: MessageReadWhereInput
    /**
     * Limit how many MessageReads to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * MessageRead upsert
   */
  export type MessageReadUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * The filter to search for the MessageRead to update in case it exists.
     */
    where: MessageReadWhereUniqueInput
    /**
     * In case the MessageRead found by the `where` argument doesn't exist, create a new MessageRead with this data.
     */
    create: XOR<MessageReadCreateInput, MessageReadUncheckedCreateInput>
    /**
     * In case the MessageRead was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MessageReadUpdateInput, MessageReadUncheckedUpdateInput>
  }

  /**
   * MessageRead delete
   */
  export type MessageReadDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
    /**
     * Filter which MessageRead to delete.
     */
    where: MessageReadWhereUniqueInput
  }

  /**
   * MessageRead deleteMany
   */
  export type MessageReadDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MessageReads to delete
     */
    where?: MessageReadWhereInput
    /**
     * Limit how many MessageReads to delete.
     */
    limit?: number
  }

  /**
   * MessageRead without action
   */
  export type MessageReadDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MessageRead
     */
    select?: MessageReadSelect<ExtArgs> | null
    /**
     * Omit specific fields from the MessageRead
     */
    omit?: MessageReadOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MessageReadInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const PostScalarFieldEnum: {
    id: 'id',
    user_id: 'user_id',
    title: 'title',
    content: 'content',
    flair: 'flair',
    upload_type: 'upload_type',
    upvotes: 'upvotes',
    downvotes: 'downvotes',
    comment_count: 'comment_count',
    is_pinned: 'is_pinned',
    is_locked: 'is_locked',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type PostScalarFieldEnum = (typeof PostScalarFieldEnum)[keyof typeof PostScalarFieldEnum]


  export const PostAttachmentScalarFieldEnum: {
    id: 'id',
    post_id: 'post_id',
    file_url: 'file_url',
    file_path: 'file_path',
    thumbnail_url: 'thumbnail_url',
    file_name: 'file_name',
    file_size: 'file_size',
    mime_type: 'mime_type',
    file_type: 'file_type',
    width: 'width',
    height: 'height',
    duration: 'duration',
    display_order: 'display_order',
    created_at: 'created_at'
  };

  export type PostAttachmentScalarFieldEnum = (typeof PostAttachmentScalarFieldEnum)[keyof typeof PostAttachmentScalarFieldEnum]


  export const CommentScalarFieldEnum: {
    id: 'id',
    post_id: 'post_id',
    user_id: 'user_id',
    parent_id: 'parent_id',
    content: 'content',
    upvotes: 'upvotes',
    downvotes: 'downvotes',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type CommentScalarFieldEnum = (typeof CommentScalarFieldEnum)[keyof typeof CommentScalarFieldEnum]


  export const CommentAttachmentScalarFieldEnum: {
    id: 'id',
    comment_id: 'comment_id',
    file_url: 'file_url',
    file_path: 'file_path',
    thumbnail_url: 'thumbnail_url',
    file_name: 'file_name',
    file_size: 'file_size',
    mime_type: 'mime_type',
    file_type: 'file_type',
    width: 'width',
    height: 'height',
    duration: 'duration',
    display_order: 'display_order',
    created_at: 'created_at'
  };

  export type CommentAttachmentScalarFieldEnum = (typeof CommentAttachmentScalarFieldEnum)[keyof typeof CommentAttachmentScalarFieldEnum]


  export const PostVoteScalarFieldEnum: {
    id: 'id',
    post_id: 'post_id',
    user_id: 'user_id',
    vote_type: 'vote_type',
    created_at: 'created_at'
  };

  export type PostVoteScalarFieldEnum = (typeof PostVoteScalarFieldEnum)[keyof typeof PostVoteScalarFieldEnum]


  export const CommentVoteScalarFieldEnum: {
    id: 'id',
    comment_id: 'comment_id',
    user_id: 'user_id',
    vote_type: 'vote_type',
    created_at: 'created_at'
  };

  export type CommentVoteScalarFieldEnum = (typeof CommentVoteScalarFieldEnum)[keyof typeof CommentVoteScalarFieldEnum]


  export const GroupScalarFieldEnum: {
    id: 'id',
    name: 'name',
    description: 'description',
    created_by: 'created_by',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type GroupScalarFieldEnum = (typeof GroupScalarFieldEnum)[keyof typeof GroupScalarFieldEnum]


  export const GroupMemberScalarFieldEnum: {
    id: 'id',
    group_id: 'group_id',
    user_id: 'user_id',
    role: 'role',
    joined_at: 'joined_at'
  };

  export type GroupMemberScalarFieldEnum = (typeof GroupMemberScalarFieldEnum)[keyof typeof GroupMemberScalarFieldEnum]


  export const MessageScalarFieldEnum: {
    id: 'id',
    sender_id: 'sender_id',
    recipient_id: 'recipient_id',
    group_id: 'group_id',
    parent_message_id: 'parent_message_id',
    thread_id: 'thread_id',
    message_type: 'message_type',
    subject: 'subject',
    content: 'content',
    is_read: 'is_read',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type MessageScalarFieldEnum = (typeof MessageScalarFieldEnum)[keyof typeof MessageScalarFieldEnum]


  export const MessageAttachmentScalarFieldEnum: {
    id: 'id',
    message_id: 'message_id',
    file_url: 'file_url',
    file_path: 'file_path',
    thumbnail_url: 'thumbnail_url',
    file_name: 'file_name',
    file_size: 'file_size',
    mime_type: 'mime_type',
    file_type: 'file_type',
    width: 'width',
    height: 'height',
    duration: 'duration',
    display_order: 'display_order',
    created_at: 'created_at'
  };

  export type MessageAttachmentScalarFieldEnum = (typeof MessageAttachmentScalarFieldEnum)[keyof typeof MessageAttachmentScalarFieldEnum]


  export const MessageReadScalarFieldEnum: {
    id: 'id',
    message_id: 'message_id',
    user_id: 'user_id',
    read_at: 'read_at',
    read_by_sender: 'read_by_sender'
  };

  export type MessageReadScalarFieldEnum = (typeof MessageReadScalarFieldEnum)[keyof typeof MessageReadScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'BigInt'
   */
  export type BigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt'>
    


  /**
   * Reference to a field of type 'BigInt[]'
   */
  export type ListBigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type PostWhereInput = {
    AND?: PostWhereInput | PostWhereInput[]
    OR?: PostWhereInput[]
    NOT?: PostWhereInput | PostWhereInput[]
    id?: UuidFilter<"Post"> | string
    user_id?: UuidFilter<"Post"> | string
    title?: StringFilter<"Post"> | string
    content?: StringFilter<"Post"> | string
    flair?: StringFilter<"Post"> | string
    upload_type?: StringFilter<"Post"> | string
    upvotes?: IntFilter<"Post"> | number
    downvotes?: IntFilter<"Post"> | number
    comment_count?: IntFilter<"Post"> | number
    is_pinned?: BoolFilter<"Post"> | boolean
    is_locked?: BoolFilter<"Post"> | boolean
    created_at?: DateTimeFilter<"Post"> | Date | string
    updated_at?: DateTimeFilter<"Post"> | Date | string
    comments?: CommentListRelationFilter
    votes?: PostVoteListRelationFilter
    attachments?: PostAttachmentListRelationFilter
  }

  export type PostOrderByWithRelationInput = {
    id?: SortOrder
    user_id?: SortOrder
    title?: SortOrder
    content?: SortOrder
    flair?: SortOrder
    upload_type?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
    is_pinned?: SortOrder
    is_locked?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    comments?: CommentOrderByRelationAggregateInput
    votes?: PostVoteOrderByRelationAggregateInput
    attachments?: PostAttachmentOrderByRelationAggregateInput
  }

  export type PostWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PostWhereInput | PostWhereInput[]
    OR?: PostWhereInput[]
    NOT?: PostWhereInput | PostWhereInput[]
    user_id?: UuidFilter<"Post"> | string
    title?: StringFilter<"Post"> | string
    content?: StringFilter<"Post"> | string
    flair?: StringFilter<"Post"> | string
    upload_type?: StringFilter<"Post"> | string
    upvotes?: IntFilter<"Post"> | number
    downvotes?: IntFilter<"Post"> | number
    comment_count?: IntFilter<"Post"> | number
    is_pinned?: BoolFilter<"Post"> | boolean
    is_locked?: BoolFilter<"Post"> | boolean
    created_at?: DateTimeFilter<"Post"> | Date | string
    updated_at?: DateTimeFilter<"Post"> | Date | string
    comments?: CommentListRelationFilter
    votes?: PostVoteListRelationFilter
    attachments?: PostAttachmentListRelationFilter
  }, "id">

  export type PostOrderByWithAggregationInput = {
    id?: SortOrder
    user_id?: SortOrder
    title?: SortOrder
    content?: SortOrder
    flair?: SortOrder
    upload_type?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
    is_pinned?: SortOrder
    is_locked?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: PostCountOrderByAggregateInput
    _avg?: PostAvgOrderByAggregateInput
    _max?: PostMaxOrderByAggregateInput
    _min?: PostMinOrderByAggregateInput
    _sum?: PostSumOrderByAggregateInput
  }

  export type PostScalarWhereWithAggregatesInput = {
    AND?: PostScalarWhereWithAggregatesInput | PostScalarWhereWithAggregatesInput[]
    OR?: PostScalarWhereWithAggregatesInput[]
    NOT?: PostScalarWhereWithAggregatesInput | PostScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"Post"> | string
    user_id?: UuidWithAggregatesFilter<"Post"> | string
    title?: StringWithAggregatesFilter<"Post"> | string
    content?: StringWithAggregatesFilter<"Post"> | string
    flair?: StringWithAggregatesFilter<"Post"> | string
    upload_type?: StringWithAggregatesFilter<"Post"> | string
    upvotes?: IntWithAggregatesFilter<"Post"> | number
    downvotes?: IntWithAggregatesFilter<"Post"> | number
    comment_count?: IntWithAggregatesFilter<"Post"> | number
    is_pinned?: BoolWithAggregatesFilter<"Post"> | boolean
    is_locked?: BoolWithAggregatesFilter<"Post"> | boolean
    created_at?: DateTimeWithAggregatesFilter<"Post"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"Post"> | Date | string
  }

  export type PostAttachmentWhereInput = {
    AND?: PostAttachmentWhereInput | PostAttachmentWhereInput[]
    OR?: PostAttachmentWhereInput[]
    NOT?: PostAttachmentWhereInput | PostAttachmentWhereInput[]
    id?: UuidFilter<"PostAttachment"> | string
    post_id?: UuidFilter<"PostAttachment"> | string
    file_url?: StringFilter<"PostAttachment"> | string
    file_path?: StringNullableFilter<"PostAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"PostAttachment"> | string | null
    file_name?: StringNullableFilter<"PostAttachment"> | string | null
    file_size?: BigIntNullableFilter<"PostAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"PostAttachment"> | string | null
    file_type?: StringFilter<"PostAttachment"> | string
    width?: IntNullableFilter<"PostAttachment"> | number | null
    height?: IntNullableFilter<"PostAttachment"> | number | null
    duration?: IntNullableFilter<"PostAttachment"> | number | null
    display_order?: IntFilter<"PostAttachment"> | number
    created_at?: DateTimeFilter<"PostAttachment"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
  }

  export type PostAttachmentOrderByWithRelationInput = {
    id?: SortOrder
    post_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    post?: PostOrderByWithRelationInput
  }

  export type PostAttachmentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PostAttachmentWhereInput | PostAttachmentWhereInput[]
    OR?: PostAttachmentWhereInput[]
    NOT?: PostAttachmentWhereInput | PostAttachmentWhereInput[]
    post_id?: UuidFilter<"PostAttachment"> | string
    file_url?: StringFilter<"PostAttachment"> | string
    file_path?: StringNullableFilter<"PostAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"PostAttachment"> | string | null
    file_name?: StringNullableFilter<"PostAttachment"> | string | null
    file_size?: BigIntNullableFilter<"PostAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"PostAttachment"> | string | null
    file_type?: StringFilter<"PostAttachment"> | string
    width?: IntNullableFilter<"PostAttachment"> | number | null
    height?: IntNullableFilter<"PostAttachment"> | number | null
    duration?: IntNullableFilter<"PostAttachment"> | number | null
    display_order?: IntFilter<"PostAttachment"> | number
    created_at?: DateTimeFilter<"PostAttachment"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
  }, "id">

  export type PostAttachmentOrderByWithAggregationInput = {
    id?: SortOrder
    post_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    _count?: PostAttachmentCountOrderByAggregateInput
    _avg?: PostAttachmentAvgOrderByAggregateInput
    _max?: PostAttachmentMaxOrderByAggregateInput
    _min?: PostAttachmentMinOrderByAggregateInput
    _sum?: PostAttachmentSumOrderByAggregateInput
  }

  export type PostAttachmentScalarWhereWithAggregatesInput = {
    AND?: PostAttachmentScalarWhereWithAggregatesInput | PostAttachmentScalarWhereWithAggregatesInput[]
    OR?: PostAttachmentScalarWhereWithAggregatesInput[]
    NOT?: PostAttachmentScalarWhereWithAggregatesInput | PostAttachmentScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"PostAttachment"> | string
    post_id?: UuidWithAggregatesFilter<"PostAttachment"> | string
    file_url?: StringWithAggregatesFilter<"PostAttachment"> | string
    file_path?: StringNullableWithAggregatesFilter<"PostAttachment"> | string | null
    thumbnail_url?: StringNullableWithAggregatesFilter<"PostAttachment"> | string | null
    file_name?: StringNullableWithAggregatesFilter<"PostAttachment"> | string | null
    file_size?: BigIntNullableWithAggregatesFilter<"PostAttachment"> | bigint | number | null
    mime_type?: StringNullableWithAggregatesFilter<"PostAttachment"> | string | null
    file_type?: StringWithAggregatesFilter<"PostAttachment"> | string
    width?: IntNullableWithAggregatesFilter<"PostAttachment"> | number | null
    height?: IntNullableWithAggregatesFilter<"PostAttachment"> | number | null
    duration?: IntNullableWithAggregatesFilter<"PostAttachment"> | number | null
    display_order?: IntWithAggregatesFilter<"PostAttachment"> | number
    created_at?: DateTimeWithAggregatesFilter<"PostAttachment"> | Date | string
  }

  export type CommentWhereInput = {
    AND?: CommentWhereInput | CommentWhereInput[]
    OR?: CommentWhereInput[]
    NOT?: CommentWhereInput | CommentWhereInput[]
    id?: UuidFilter<"Comment"> | string
    post_id?: UuidFilter<"Comment"> | string
    user_id?: UuidFilter<"Comment"> | string
    parent_id?: UuidNullableFilter<"Comment"> | string | null
    content?: StringFilter<"Comment"> | string
    upvotes?: IntFilter<"Comment"> | number
    downvotes?: IntFilter<"Comment"> | number
    created_at?: DateTimeFilter<"Comment"> | Date | string
    updated_at?: DateTimeFilter<"Comment"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
    parent?: XOR<CommentNullableScalarRelationFilter, CommentWhereInput> | null
    replies?: CommentListRelationFilter
    votes?: CommentVoteListRelationFilter
    attachments?: CommentAttachmentListRelationFilter
  }

  export type CommentOrderByWithRelationInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    parent_id?: SortOrderInput | SortOrder
    content?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    post?: PostOrderByWithRelationInput
    parent?: CommentOrderByWithRelationInput
    replies?: CommentOrderByRelationAggregateInput
    votes?: CommentVoteOrderByRelationAggregateInput
    attachments?: CommentAttachmentOrderByRelationAggregateInput
  }

  export type CommentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: CommentWhereInput | CommentWhereInput[]
    OR?: CommentWhereInput[]
    NOT?: CommentWhereInput | CommentWhereInput[]
    post_id?: UuidFilter<"Comment"> | string
    user_id?: UuidFilter<"Comment"> | string
    parent_id?: UuidNullableFilter<"Comment"> | string | null
    content?: StringFilter<"Comment"> | string
    upvotes?: IntFilter<"Comment"> | number
    downvotes?: IntFilter<"Comment"> | number
    created_at?: DateTimeFilter<"Comment"> | Date | string
    updated_at?: DateTimeFilter<"Comment"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
    parent?: XOR<CommentNullableScalarRelationFilter, CommentWhereInput> | null
    replies?: CommentListRelationFilter
    votes?: CommentVoteListRelationFilter
    attachments?: CommentAttachmentListRelationFilter
  }, "id">

  export type CommentOrderByWithAggregationInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    parent_id?: SortOrderInput | SortOrder
    content?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: CommentCountOrderByAggregateInput
    _avg?: CommentAvgOrderByAggregateInput
    _max?: CommentMaxOrderByAggregateInput
    _min?: CommentMinOrderByAggregateInput
    _sum?: CommentSumOrderByAggregateInput
  }

  export type CommentScalarWhereWithAggregatesInput = {
    AND?: CommentScalarWhereWithAggregatesInput | CommentScalarWhereWithAggregatesInput[]
    OR?: CommentScalarWhereWithAggregatesInput[]
    NOT?: CommentScalarWhereWithAggregatesInput | CommentScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"Comment"> | string
    post_id?: UuidWithAggregatesFilter<"Comment"> | string
    user_id?: UuidWithAggregatesFilter<"Comment"> | string
    parent_id?: UuidNullableWithAggregatesFilter<"Comment"> | string | null
    content?: StringWithAggregatesFilter<"Comment"> | string
    upvotes?: IntWithAggregatesFilter<"Comment"> | number
    downvotes?: IntWithAggregatesFilter<"Comment"> | number
    created_at?: DateTimeWithAggregatesFilter<"Comment"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"Comment"> | Date | string
  }

  export type CommentAttachmentWhereInput = {
    AND?: CommentAttachmentWhereInput | CommentAttachmentWhereInput[]
    OR?: CommentAttachmentWhereInput[]
    NOT?: CommentAttachmentWhereInput | CommentAttachmentWhereInput[]
    id?: UuidFilter<"CommentAttachment"> | string
    comment_id?: UuidFilter<"CommentAttachment"> | string
    file_url?: StringFilter<"CommentAttachment"> | string
    file_path?: StringNullableFilter<"CommentAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"CommentAttachment"> | string | null
    file_name?: StringNullableFilter<"CommentAttachment"> | string | null
    file_size?: BigIntNullableFilter<"CommentAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"CommentAttachment"> | string | null
    file_type?: StringFilter<"CommentAttachment"> | string
    width?: IntNullableFilter<"CommentAttachment"> | number | null
    height?: IntNullableFilter<"CommentAttachment"> | number | null
    duration?: IntNullableFilter<"CommentAttachment"> | number | null
    display_order?: IntFilter<"CommentAttachment"> | number
    created_at?: DateTimeFilter<"CommentAttachment"> | Date | string
    comment?: XOR<CommentScalarRelationFilter, CommentWhereInput>
  }

  export type CommentAttachmentOrderByWithRelationInput = {
    id?: SortOrder
    comment_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    comment?: CommentOrderByWithRelationInput
  }

  export type CommentAttachmentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: CommentAttachmentWhereInput | CommentAttachmentWhereInput[]
    OR?: CommentAttachmentWhereInput[]
    NOT?: CommentAttachmentWhereInput | CommentAttachmentWhereInput[]
    comment_id?: UuidFilter<"CommentAttachment"> | string
    file_url?: StringFilter<"CommentAttachment"> | string
    file_path?: StringNullableFilter<"CommentAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"CommentAttachment"> | string | null
    file_name?: StringNullableFilter<"CommentAttachment"> | string | null
    file_size?: BigIntNullableFilter<"CommentAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"CommentAttachment"> | string | null
    file_type?: StringFilter<"CommentAttachment"> | string
    width?: IntNullableFilter<"CommentAttachment"> | number | null
    height?: IntNullableFilter<"CommentAttachment"> | number | null
    duration?: IntNullableFilter<"CommentAttachment"> | number | null
    display_order?: IntFilter<"CommentAttachment"> | number
    created_at?: DateTimeFilter<"CommentAttachment"> | Date | string
    comment?: XOR<CommentScalarRelationFilter, CommentWhereInput>
  }, "id">

  export type CommentAttachmentOrderByWithAggregationInput = {
    id?: SortOrder
    comment_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    _count?: CommentAttachmentCountOrderByAggregateInput
    _avg?: CommentAttachmentAvgOrderByAggregateInput
    _max?: CommentAttachmentMaxOrderByAggregateInput
    _min?: CommentAttachmentMinOrderByAggregateInput
    _sum?: CommentAttachmentSumOrderByAggregateInput
  }

  export type CommentAttachmentScalarWhereWithAggregatesInput = {
    AND?: CommentAttachmentScalarWhereWithAggregatesInput | CommentAttachmentScalarWhereWithAggregatesInput[]
    OR?: CommentAttachmentScalarWhereWithAggregatesInput[]
    NOT?: CommentAttachmentScalarWhereWithAggregatesInput | CommentAttachmentScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"CommentAttachment"> | string
    comment_id?: UuidWithAggregatesFilter<"CommentAttachment"> | string
    file_url?: StringWithAggregatesFilter<"CommentAttachment"> | string
    file_path?: StringNullableWithAggregatesFilter<"CommentAttachment"> | string | null
    thumbnail_url?: StringNullableWithAggregatesFilter<"CommentAttachment"> | string | null
    file_name?: StringNullableWithAggregatesFilter<"CommentAttachment"> | string | null
    file_size?: BigIntNullableWithAggregatesFilter<"CommentAttachment"> | bigint | number | null
    mime_type?: StringNullableWithAggregatesFilter<"CommentAttachment"> | string | null
    file_type?: StringWithAggregatesFilter<"CommentAttachment"> | string
    width?: IntNullableWithAggregatesFilter<"CommentAttachment"> | number | null
    height?: IntNullableWithAggregatesFilter<"CommentAttachment"> | number | null
    duration?: IntNullableWithAggregatesFilter<"CommentAttachment"> | number | null
    display_order?: IntWithAggregatesFilter<"CommentAttachment"> | number
    created_at?: DateTimeWithAggregatesFilter<"CommentAttachment"> | Date | string
  }

  export type PostVoteWhereInput = {
    AND?: PostVoteWhereInput | PostVoteWhereInput[]
    OR?: PostVoteWhereInput[]
    NOT?: PostVoteWhereInput | PostVoteWhereInput[]
    id?: UuidFilter<"PostVote"> | string
    post_id?: UuidFilter<"PostVote"> | string
    user_id?: UuidFilter<"PostVote"> | string
    vote_type?: StringFilter<"PostVote"> | string
    created_at?: DateTimeFilter<"PostVote"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
  }

  export type PostVoteOrderByWithRelationInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
    post?: PostOrderByWithRelationInput
  }

  export type PostVoteWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    post_id_user_id?: PostVotePost_idUser_idCompoundUniqueInput
    AND?: PostVoteWhereInput | PostVoteWhereInput[]
    OR?: PostVoteWhereInput[]
    NOT?: PostVoteWhereInput | PostVoteWhereInput[]
    post_id?: UuidFilter<"PostVote"> | string
    user_id?: UuidFilter<"PostVote"> | string
    vote_type?: StringFilter<"PostVote"> | string
    created_at?: DateTimeFilter<"PostVote"> | Date | string
    post?: XOR<PostScalarRelationFilter, PostWhereInput>
  }, "id" | "post_id_user_id">

  export type PostVoteOrderByWithAggregationInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
    _count?: PostVoteCountOrderByAggregateInput
    _max?: PostVoteMaxOrderByAggregateInput
    _min?: PostVoteMinOrderByAggregateInput
  }

  export type PostVoteScalarWhereWithAggregatesInput = {
    AND?: PostVoteScalarWhereWithAggregatesInput | PostVoteScalarWhereWithAggregatesInput[]
    OR?: PostVoteScalarWhereWithAggregatesInput[]
    NOT?: PostVoteScalarWhereWithAggregatesInput | PostVoteScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"PostVote"> | string
    post_id?: UuidWithAggregatesFilter<"PostVote"> | string
    user_id?: UuidWithAggregatesFilter<"PostVote"> | string
    vote_type?: StringWithAggregatesFilter<"PostVote"> | string
    created_at?: DateTimeWithAggregatesFilter<"PostVote"> | Date | string
  }

  export type CommentVoteWhereInput = {
    AND?: CommentVoteWhereInput | CommentVoteWhereInput[]
    OR?: CommentVoteWhereInput[]
    NOT?: CommentVoteWhereInput | CommentVoteWhereInput[]
    id?: UuidFilter<"CommentVote"> | string
    comment_id?: UuidFilter<"CommentVote"> | string
    user_id?: UuidFilter<"CommentVote"> | string
    vote_type?: StringFilter<"CommentVote"> | string
    created_at?: DateTimeFilter<"CommentVote"> | Date | string
    comment?: XOR<CommentScalarRelationFilter, CommentWhereInput>
  }

  export type CommentVoteOrderByWithRelationInput = {
    id?: SortOrder
    comment_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
    comment?: CommentOrderByWithRelationInput
  }

  export type CommentVoteWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    comment_id_user_id?: CommentVoteComment_idUser_idCompoundUniqueInput
    AND?: CommentVoteWhereInput | CommentVoteWhereInput[]
    OR?: CommentVoteWhereInput[]
    NOT?: CommentVoteWhereInput | CommentVoteWhereInput[]
    comment_id?: UuidFilter<"CommentVote"> | string
    user_id?: UuidFilter<"CommentVote"> | string
    vote_type?: StringFilter<"CommentVote"> | string
    created_at?: DateTimeFilter<"CommentVote"> | Date | string
    comment?: XOR<CommentScalarRelationFilter, CommentWhereInput>
  }, "id" | "comment_id_user_id">

  export type CommentVoteOrderByWithAggregationInput = {
    id?: SortOrder
    comment_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
    _count?: CommentVoteCountOrderByAggregateInput
    _max?: CommentVoteMaxOrderByAggregateInput
    _min?: CommentVoteMinOrderByAggregateInput
  }

  export type CommentVoteScalarWhereWithAggregatesInput = {
    AND?: CommentVoteScalarWhereWithAggregatesInput | CommentVoteScalarWhereWithAggregatesInput[]
    OR?: CommentVoteScalarWhereWithAggregatesInput[]
    NOT?: CommentVoteScalarWhereWithAggregatesInput | CommentVoteScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"CommentVote"> | string
    comment_id?: UuidWithAggregatesFilter<"CommentVote"> | string
    user_id?: UuidWithAggregatesFilter<"CommentVote"> | string
    vote_type?: StringWithAggregatesFilter<"CommentVote"> | string
    created_at?: DateTimeWithAggregatesFilter<"CommentVote"> | Date | string
  }

  export type GroupWhereInput = {
    AND?: GroupWhereInput | GroupWhereInput[]
    OR?: GroupWhereInput[]
    NOT?: GroupWhereInput | GroupWhereInput[]
    id?: UuidFilter<"Group"> | string
    name?: StringFilter<"Group"> | string
    description?: StringNullableFilter<"Group"> | string | null
    created_by?: UuidFilter<"Group"> | string
    created_at?: DateTimeFilter<"Group"> | Date | string
    updated_at?: DateTimeFilter<"Group"> | Date | string
    members?: GroupMemberListRelationFilter
    messages?: MessageListRelationFilter
  }

  export type GroupOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    members?: GroupMemberOrderByRelationAggregateInput
    messages?: MessageOrderByRelationAggregateInput
  }

  export type GroupWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GroupWhereInput | GroupWhereInput[]
    OR?: GroupWhereInput[]
    NOT?: GroupWhereInput | GroupWhereInput[]
    name?: StringFilter<"Group"> | string
    description?: StringNullableFilter<"Group"> | string | null
    created_by?: UuidFilter<"Group"> | string
    created_at?: DateTimeFilter<"Group"> | Date | string
    updated_at?: DateTimeFilter<"Group"> | Date | string
    members?: GroupMemberListRelationFilter
    messages?: MessageListRelationFilter
  }, "id">

  export type GroupOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: GroupCountOrderByAggregateInput
    _max?: GroupMaxOrderByAggregateInput
    _min?: GroupMinOrderByAggregateInput
  }

  export type GroupScalarWhereWithAggregatesInput = {
    AND?: GroupScalarWhereWithAggregatesInput | GroupScalarWhereWithAggregatesInput[]
    OR?: GroupScalarWhereWithAggregatesInput[]
    NOT?: GroupScalarWhereWithAggregatesInput | GroupScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"Group"> | string
    name?: StringWithAggregatesFilter<"Group"> | string
    description?: StringNullableWithAggregatesFilter<"Group"> | string | null
    created_by?: UuidWithAggregatesFilter<"Group"> | string
    created_at?: DateTimeWithAggregatesFilter<"Group"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"Group"> | Date | string
  }

  export type GroupMemberWhereInput = {
    AND?: GroupMemberWhereInput | GroupMemberWhereInput[]
    OR?: GroupMemberWhereInput[]
    NOT?: GroupMemberWhereInput | GroupMemberWhereInput[]
    id?: UuidFilter<"GroupMember"> | string
    group_id?: UuidFilter<"GroupMember"> | string
    user_id?: UuidFilter<"GroupMember"> | string
    role?: StringFilter<"GroupMember"> | string
    joined_at?: DateTimeFilter<"GroupMember"> | Date | string
    group?: XOR<GroupScalarRelationFilter, GroupWhereInput>
  }

  export type GroupMemberOrderByWithRelationInput = {
    id?: SortOrder
    group_id?: SortOrder
    user_id?: SortOrder
    role?: SortOrder
    joined_at?: SortOrder
    group?: GroupOrderByWithRelationInput
  }

  export type GroupMemberWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    group_id_user_id?: GroupMemberGroup_idUser_idCompoundUniqueInput
    AND?: GroupMemberWhereInput | GroupMemberWhereInput[]
    OR?: GroupMemberWhereInput[]
    NOT?: GroupMemberWhereInput | GroupMemberWhereInput[]
    group_id?: UuidFilter<"GroupMember"> | string
    user_id?: UuidFilter<"GroupMember"> | string
    role?: StringFilter<"GroupMember"> | string
    joined_at?: DateTimeFilter<"GroupMember"> | Date | string
    group?: XOR<GroupScalarRelationFilter, GroupWhereInput>
  }, "id" | "group_id_user_id">

  export type GroupMemberOrderByWithAggregationInput = {
    id?: SortOrder
    group_id?: SortOrder
    user_id?: SortOrder
    role?: SortOrder
    joined_at?: SortOrder
    _count?: GroupMemberCountOrderByAggregateInput
    _max?: GroupMemberMaxOrderByAggregateInput
    _min?: GroupMemberMinOrderByAggregateInput
  }

  export type GroupMemberScalarWhereWithAggregatesInput = {
    AND?: GroupMemberScalarWhereWithAggregatesInput | GroupMemberScalarWhereWithAggregatesInput[]
    OR?: GroupMemberScalarWhereWithAggregatesInput[]
    NOT?: GroupMemberScalarWhereWithAggregatesInput | GroupMemberScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"GroupMember"> | string
    group_id?: UuidWithAggregatesFilter<"GroupMember"> | string
    user_id?: UuidWithAggregatesFilter<"GroupMember"> | string
    role?: StringWithAggregatesFilter<"GroupMember"> | string
    joined_at?: DateTimeWithAggregatesFilter<"GroupMember"> | Date | string
  }

  export type MessageWhereInput = {
    AND?: MessageWhereInput | MessageWhereInput[]
    OR?: MessageWhereInput[]
    NOT?: MessageWhereInput | MessageWhereInput[]
    id?: UuidFilter<"Message"> | string
    sender_id?: UuidFilter<"Message"> | string
    recipient_id?: UuidNullableFilter<"Message"> | string | null
    group_id?: UuidNullableFilter<"Message"> | string | null
    parent_message_id?: UuidNullableFilter<"Message"> | string | null
    thread_id?: UuidNullableFilter<"Message"> | string | null
    message_type?: StringFilter<"Message"> | string
    subject?: StringFilter<"Message"> | string
    content?: StringFilter<"Message"> | string
    is_read?: BoolFilter<"Message"> | boolean
    created_at?: DateTimeFilter<"Message"> | Date | string
    updated_at?: DateTimeFilter<"Message"> | Date | string
    group?: XOR<GroupNullableScalarRelationFilter, GroupWhereInput> | null
    parent?: XOR<MessageNullableScalarRelationFilter, MessageWhereInput> | null
    replies?: MessageListRelationFilter
    reads?: MessageReadListRelationFilter
    attachments?: MessageAttachmentListRelationFilter
  }

  export type MessageOrderByWithRelationInput = {
    id?: SortOrder
    sender_id?: SortOrder
    recipient_id?: SortOrderInput | SortOrder
    group_id?: SortOrderInput | SortOrder
    parent_message_id?: SortOrderInput | SortOrder
    thread_id?: SortOrderInput | SortOrder
    message_type?: SortOrder
    subject?: SortOrder
    content?: SortOrder
    is_read?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    group?: GroupOrderByWithRelationInput
    parent?: MessageOrderByWithRelationInput
    replies?: MessageOrderByRelationAggregateInput
    reads?: MessageReadOrderByRelationAggregateInput
    attachments?: MessageAttachmentOrderByRelationAggregateInput
  }

  export type MessageWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: MessageWhereInput | MessageWhereInput[]
    OR?: MessageWhereInput[]
    NOT?: MessageWhereInput | MessageWhereInput[]
    sender_id?: UuidFilter<"Message"> | string
    recipient_id?: UuidNullableFilter<"Message"> | string | null
    group_id?: UuidNullableFilter<"Message"> | string | null
    parent_message_id?: UuidNullableFilter<"Message"> | string | null
    thread_id?: UuidNullableFilter<"Message"> | string | null
    message_type?: StringFilter<"Message"> | string
    subject?: StringFilter<"Message"> | string
    content?: StringFilter<"Message"> | string
    is_read?: BoolFilter<"Message"> | boolean
    created_at?: DateTimeFilter<"Message"> | Date | string
    updated_at?: DateTimeFilter<"Message"> | Date | string
    group?: XOR<GroupNullableScalarRelationFilter, GroupWhereInput> | null
    parent?: XOR<MessageNullableScalarRelationFilter, MessageWhereInput> | null
    replies?: MessageListRelationFilter
    reads?: MessageReadListRelationFilter
    attachments?: MessageAttachmentListRelationFilter
  }, "id">

  export type MessageOrderByWithAggregationInput = {
    id?: SortOrder
    sender_id?: SortOrder
    recipient_id?: SortOrderInput | SortOrder
    group_id?: SortOrderInput | SortOrder
    parent_message_id?: SortOrderInput | SortOrder
    thread_id?: SortOrderInput | SortOrder
    message_type?: SortOrder
    subject?: SortOrder
    content?: SortOrder
    is_read?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: MessageCountOrderByAggregateInput
    _max?: MessageMaxOrderByAggregateInput
    _min?: MessageMinOrderByAggregateInput
  }

  export type MessageScalarWhereWithAggregatesInput = {
    AND?: MessageScalarWhereWithAggregatesInput | MessageScalarWhereWithAggregatesInput[]
    OR?: MessageScalarWhereWithAggregatesInput[]
    NOT?: MessageScalarWhereWithAggregatesInput | MessageScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"Message"> | string
    sender_id?: UuidWithAggregatesFilter<"Message"> | string
    recipient_id?: UuidNullableWithAggregatesFilter<"Message"> | string | null
    group_id?: UuidNullableWithAggregatesFilter<"Message"> | string | null
    parent_message_id?: UuidNullableWithAggregatesFilter<"Message"> | string | null
    thread_id?: UuidNullableWithAggregatesFilter<"Message"> | string | null
    message_type?: StringWithAggregatesFilter<"Message"> | string
    subject?: StringWithAggregatesFilter<"Message"> | string
    content?: StringWithAggregatesFilter<"Message"> | string
    is_read?: BoolWithAggregatesFilter<"Message"> | boolean
    created_at?: DateTimeWithAggregatesFilter<"Message"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"Message"> | Date | string
  }

  export type MessageAttachmentWhereInput = {
    AND?: MessageAttachmentWhereInput | MessageAttachmentWhereInput[]
    OR?: MessageAttachmentWhereInput[]
    NOT?: MessageAttachmentWhereInput | MessageAttachmentWhereInput[]
    id?: UuidFilter<"MessageAttachment"> | string
    message_id?: UuidFilter<"MessageAttachment"> | string
    file_url?: StringFilter<"MessageAttachment"> | string
    file_path?: StringNullableFilter<"MessageAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"MessageAttachment"> | string | null
    file_name?: StringNullableFilter<"MessageAttachment"> | string | null
    file_size?: BigIntNullableFilter<"MessageAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"MessageAttachment"> | string | null
    file_type?: StringFilter<"MessageAttachment"> | string
    width?: IntNullableFilter<"MessageAttachment"> | number | null
    height?: IntNullableFilter<"MessageAttachment"> | number | null
    duration?: IntNullableFilter<"MessageAttachment"> | number | null
    display_order?: IntFilter<"MessageAttachment"> | number
    created_at?: DateTimeFilter<"MessageAttachment"> | Date | string
    message?: XOR<MessageScalarRelationFilter, MessageWhereInput>
  }

  export type MessageAttachmentOrderByWithRelationInput = {
    id?: SortOrder
    message_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    message?: MessageOrderByWithRelationInput
  }

  export type MessageAttachmentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: MessageAttachmentWhereInput | MessageAttachmentWhereInput[]
    OR?: MessageAttachmentWhereInput[]
    NOT?: MessageAttachmentWhereInput | MessageAttachmentWhereInput[]
    message_id?: UuidFilter<"MessageAttachment"> | string
    file_url?: StringFilter<"MessageAttachment"> | string
    file_path?: StringNullableFilter<"MessageAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"MessageAttachment"> | string | null
    file_name?: StringNullableFilter<"MessageAttachment"> | string | null
    file_size?: BigIntNullableFilter<"MessageAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"MessageAttachment"> | string | null
    file_type?: StringFilter<"MessageAttachment"> | string
    width?: IntNullableFilter<"MessageAttachment"> | number | null
    height?: IntNullableFilter<"MessageAttachment"> | number | null
    duration?: IntNullableFilter<"MessageAttachment"> | number | null
    display_order?: IntFilter<"MessageAttachment"> | number
    created_at?: DateTimeFilter<"MessageAttachment"> | Date | string
    message?: XOR<MessageScalarRelationFilter, MessageWhereInput>
  }, "id">

  export type MessageAttachmentOrderByWithAggregationInput = {
    id?: SortOrder
    message_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrderInput | SortOrder
    thumbnail_url?: SortOrderInput | SortOrder
    file_name?: SortOrderInput | SortOrder
    file_size?: SortOrderInput | SortOrder
    mime_type?: SortOrderInput | SortOrder
    file_type?: SortOrder
    width?: SortOrderInput | SortOrder
    height?: SortOrderInput | SortOrder
    duration?: SortOrderInput | SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
    _count?: MessageAttachmentCountOrderByAggregateInput
    _avg?: MessageAttachmentAvgOrderByAggregateInput
    _max?: MessageAttachmentMaxOrderByAggregateInput
    _min?: MessageAttachmentMinOrderByAggregateInput
    _sum?: MessageAttachmentSumOrderByAggregateInput
  }

  export type MessageAttachmentScalarWhereWithAggregatesInput = {
    AND?: MessageAttachmentScalarWhereWithAggregatesInput | MessageAttachmentScalarWhereWithAggregatesInput[]
    OR?: MessageAttachmentScalarWhereWithAggregatesInput[]
    NOT?: MessageAttachmentScalarWhereWithAggregatesInput | MessageAttachmentScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"MessageAttachment"> | string
    message_id?: UuidWithAggregatesFilter<"MessageAttachment"> | string
    file_url?: StringWithAggregatesFilter<"MessageAttachment"> | string
    file_path?: StringNullableWithAggregatesFilter<"MessageAttachment"> | string | null
    thumbnail_url?: StringNullableWithAggregatesFilter<"MessageAttachment"> | string | null
    file_name?: StringNullableWithAggregatesFilter<"MessageAttachment"> | string | null
    file_size?: BigIntNullableWithAggregatesFilter<"MessageAttachment"> | bigint | number | null
    mime_type?: StringNullableWithAggregatesFilter<"MessageAttachment"> | string | null
    file_type?: StringWithAggregatesFilter<"MessageAttachment"> | string
    width?: IntNullableWithAggregatesFilter<"MessageAttachment"> | number | null
    height?: IntNullableWithAggregatesFilter<"MessageAttachment"> | number | null
    duration?: IntNullableWithAggregatesFilter<"MessageAttachment"> | number | null
    display_order?: IntWithAggregatesFilter<"MessageAttachment"> | number
    created_at?: DateTimeWithAggregatesFilter<"MessageAttachment"> | Date | string
  }

  export type MessageReadWhereInput = {
    AND?: MessageReadWhereInput | MessageReadWhereInput[]
    OR?: MessageReadWhereInput[]
    NOT?: MessageReadWhereInput | MessageReadWhereInput[]
    id?: UuidFilter<"MessageRead"> | string
    message_id?: UuidFilter<"MessageRead"> | string
    user_id?: UuidFilter<"MessageRead"> | string
    read_at?: DateTimeFilter<"MessageRead"> | Date | string
    read_by_sender?: BoolFilter<"MessageRead"> | boolean
    message?: XOR<MessageScalarRelationFilter, MessageWhereInput>
  }

  export type MessageReadOrderByWithRelationInput = {
    id?: SortOrder
    message_id?: SortOrder
    user_id?: SortOrder
    read_at?: SortOrder
    read_by_sender?: SortOrder
    message?: MessageOrderByWithRelationInput
  }

  export type MessageReadWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    message_id_user_id?: MessageReadMessage_idUser_idCompoundUniqueInput
    AND?: MessageReadWhereInput | MessageReadWhereInput[]
    OR?: MessageReadWhereInput[]
    NOT?: MessageReadWhereInput | MessageReadWhereInput[]
    message_id?: UuidFilter<"MessageRead"> | string
    user_id?: UuidFilter<"MessageRead"> | string
    read_at?: DateTimeFilter<"MessageRead"> | Date | string
    read_by_sender?: BoolFilter<"MessageRead"> | boolean
    message?: XOR<MessageScalarRelationFilter, MessageWhereInput>
  }, "id" | "message_id_user_id">

  export type MessageReadOrderByWithAggregationInput = {
    id?: SortOrder
    message_id?: SortOrder
    user_id?: SortOrder
    read_at?: SortOrder
    read_by_sender?: SortOrder
    _count?: MessageReadCountOrderByAggregateInput
    _max?: MessageReadMaxOrderByAggregateInput
    _min?: MessageReadMinOrderByAggregateInput
  }

  export type MessageReadScalarWhereWithAggregatesInput = {
    AND?: MessageReadScalarWhereWithAggregatesInput | MessageReadScalarWhereWithAggregatesInput[]
    OR?: MessageReadScalarWhereWithAggregatesInput[]
    NOT?: MessageReadScalarWhereWithAggregatesInput | MessageReadScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"MessageRead"> | string
    message_id?: UuidWithAggregatesFilter<"MessageRead"> | string
    user_id?: UuidWithAggregatesFilter<"MessageRead"> | string
    read_at?: DateTimeWithAggregatesFilter<"MessageRead"> | Date | string
    read_by_sender?: BoolWithAggregatesFilter<"MessageRead"> | boolean
  }

  export type PostCreateInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentCreateNestedManyWithoutPostInput
    votes?: PostVoteCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentCreateNestedManyWithoutPostInput
  }

  export type PostUncheckedCreateInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentUncheckedCreateNestedManyWithoutPostInput
    votes?: PostVoteUncheckedCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentUncheckedCreateNestedManyWithoutPostInput
  }

  export type PostUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUpdateManyWithoutPostNestedInput
    votes?: PostVoteUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUpdateManyWithoutPostNestedInput
  }

  export type PostUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUncheckedUpdateManyWithoutPostNestedInput
    votes?: PostVoteUncheckedUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUncheckedUpdateManyWithoutPostNestedInput
  }

  export type PostCreateManyInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type PostUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentCreateInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
    post: PostCreateNestedOneWithoutAttachmentsInput
  }

  export type PostAttachmentUncheckedCreateInput = {
    id?: string
    post_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type PostAttachmentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutAttachmentsNestedInput
  }

  export type PostAttachmentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentCreateManyInput = {
    id?: string
    post_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type PostAttachmentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentCreateInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    post: PostCreateNestedOneWithoutCommentsInput
    parent?: CommentCreateNestedOneWithoutRepliesInput
    replies?: CommentCreateNestedManyWithoutParentInput
    votes?: CommentVoteCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateInput = {
    id?: string
    post_id: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    replies?: CommentUncheckedCreateNestedManyWithoutParentInput
    votes?: CommentVoteUncheckedCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutCommentsNestedInput
    parent?: CommentUpdateOneWithoutRepliesNestedInput
    replies?: CommentUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: CommentUncheckedUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUncheckedUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type CommentCreateManyInput = {
    id?: string
    post_id: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type CommentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentCreateInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
    comment: CommentCreateNestedOneWithoutAttachmentsInput
  }

  export type CommentAttachmentUncheckedCreateInput = {
    id?: string
    comment_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentAttachmentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comment?: CommentUpdateOneRequiredWithoutAttachmentsNestedInput
  }

  export type CommentAttachmentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentCreateManyInput = {
    id?: string
    comment_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentAttachmentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteCreateInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
    post: PostCreateNestedOneWithoutVotesInput
  }

  export type PostVoteUncheckedCreateInput = {
    id?: string
    post_id: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type PostVoteUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutVotesNestedInput
  }

  export type PostVoteUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteCreateManyInput = {
    id?: string
    post_id: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type PostVoteUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteCreateInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
    comment: CommentCreateNestedOneWithoutVotesInput
  }

  export type CommentVoteUncheckedCreateInput = {
    id?: string
    comment_id: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type CommentVoteUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comment?: CommentUpdateOneRequiredWithoutVotesNestedInput
  }

  export type CommentVoteUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteCreateManyInput = {
    id?: string
    comment_id: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type CommentVoteUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    comment_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupCreateInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    members?: GroupMemberCreateNestedManyWithoutGroupInput
    messages?: MessageCreateNestedManyWithoutGroupInput
  }

  export type GroupUncheckedCreateInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    members?: GroupMemberUncheckedCreateNestedManyWithoutGroupInput
    messages?: MessageUncheckedCreateNestedManyWithoutGroupInput
  }

  export type GroupUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: GroupMemberUpdateManyWithoutGroupNestedInput
    messages?: MessageUpdateManyWithoutGroupNestedInput
  }

  export type GroupUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: GroupMemberUncheckedUpdateManyWithoutGroupNestedInput
    messages?: MessageUncheckedUpdateManyWithoutGroupNestedInput
  }

  export type GroupCreateManyInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type GroupUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberCreateInput = {
    id?: string
    user_id: string
    role?: string
    joined_at?: Date | string
    group: GroupCreateNestedOneWithoutMembersInput
  }

  export type GroupMemberUncheckedCreateInput = {
    id?: string
    group_id: string
    user_id: string
    role?: string
    joined_at?: Date | string
  }

  export type GroupMemberUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneRequiredWithoutMembersNestedInput
  }

  export type GroupMemberUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    group_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberCreateManyInput = {
    id?: string
    group_id: string
    user_id: string
    role?: string
    joined_at?: Date | string
  }

  export type GroupMemberUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    group_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageCreateInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    group?: GroupCreateNestedOneWithoutMessagesInput
    parent?: MessageCreateNestedOneWithoutRepliesInput
    replies?: MessageCreateNestedManyWithoutParentInput
    reads?: MessageReadCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    replies?: MessageUncheckedCreateNestedManyWithoutParentInput
    reads?: MessageReadUncheckedCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneWithoutMessagesNestedInput
    parent?: MessageUpdateOneWithoutRepliesNestedInput
    replies?: MessageUpdateManyWithoutParentNestedInput
    reads?: MessageReadUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: MessageUncheckedUpdateManyWithoutParentNestedInput
    reads?: MessageReadUncheckedUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type MessageCreateManyInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type MessageUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageAttachmentCreateInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
    message: MessageCreateNestedOneWithoutAttachmentsInput
  }

  export type MessageAttachmentUncheckedCreateInput = {
    id?: string
    message_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type MessageAttachmentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    message?: MessageUpdateOneRequiredWithoutAttachmentsNestedInput
  }

  export type MessageAttachmentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    message_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageAttachmentCreateManyInput = {
    id?: string
    message_id: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type MessageAttachmentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageAttachmentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    message_id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageReadCreateInput = {
    id?: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
    message: MessageCreateNestedOneWithoutReadsInput
  }

  export type MessageReadUncheckedCreateInput = {
    id?: string
    message_id: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
  }

  export type MessageReadUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
    message?: MessageUpdateOneRequiredWithoutReadsNestedInput
  }

  export type MessageReadUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    message_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type MessageReadCreateManyInput = {
    id?: string
    message_id: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
  }

  export type MessageReadUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type MessageReadUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    message_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type UuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type CommentListRelationFilter = {
    every?: CommentWhereInput
    some?: CommentWhereInput
    none?: CommentWhereInput
  }

  export type PostVoteListRelationFilter = {
    every?: PostVoteWhereInput
    some?: PostVoteWhereInput
    none?: PostVoteWhereInput
  }

  export type PostAttachmentListRelationFilter = {
    every?: PostAttachmentWhereInput
    some?: PostAttachmentWhereInput
    none?: PostAttachmentWhereInput
  }

  export type CommentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PostVoteOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PostAttachmentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PostCountOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    title?: SortOrder
    content?: SortOrder
    flair?: SortOrder
    upload_type?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
    is_pinned?: SortOrder
    is_locked?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PostAvgOrderByAggregateInput = {
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
  }

  export type PostMaxOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    title?: SortOrder
    content?: SortOrder
    flair?: SortOrder
    upload_type?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
    is_pinned?: SortOrder
    is_locked?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PostMinOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    title?: SortOrder
    content?: SortOrder
    flair?: SortOrder
    upload_type?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
    is_pinned?: SortOrder
    is_locked?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type PostSumOrderByAggregateInput = {
    upvotes?: SortOrder
    downvotes?: SortOrder
    comment_count?: SortOrder
  }

  export type UuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type BigIntNullableFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableFilter<$PrismaModel> | bigint | number | null
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type PostScalarRelationFilter = {
    is?: PostWhereInput
    isNot?: PostWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type PostAttachmentCountOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type PostAttachmentAvgOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type PostAttachmentMaxOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type PostAttachmentMinOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type PostAttachmentSumOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type BigIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableWithAggregatesFilter<$PrismaModel> | bigint | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedBigIntNullableFilter<$PrismaModel>
    _min?: NestedBigIntNullableFilter<$PrismaModel>
    _max?: NestedBigIntNullableFilter<$PrismaModel>
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type UuidNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidNullableFilter<$PrismaModel> | string | null
  }

  export type CommentNullableScalarRelationFilter = {
    is?: CommentWhereInput | null
    isNot?: CommentWhereInput | null
  }

  export type CommentVoteListRelationFilter = {
    every?: CommentVoteWhereInput
    some?: CommentVoteWhereInput
    none?: CommentVoteWhereInput
  }

  export type CommentAttachmentListRelationFilter = {
    every?: CommentAttachmentWhereInput
    some?: CommentAttachmentWhereInput
    none?: CommentAttachmentWhereInput
  }

  export type CommentVoteOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type CommentAttachmentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type CommentCountOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    parent_id?: SortOrder
    content?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type CommentAvgOrderByAggregateInput = {
    upvotes?: SortOrder
    downvotes?: SortOrder
  }

  export type CommentMaxOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    parent_id?: SortOrder
    content?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type CommentMinOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    parent_id?: SortOrder
    content?: SortOrder
    upvotes?: SortOrder
    downvotes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type CommentSumOrderByAggregateInput = {
    upvotes?: SortOrder
    downvotes?: SortOrder
  }

  export type UuidNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type CommentScalarRelationFilter = {
    is?: CommentWhereInput
    isNot?: CommentWhereInput
  }

  export type CommentAttachmentCountOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type CommentAttachmentAvgOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type CommentAttachmentMaxOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type CommentAttachmentMinOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type CommentAttachmentSumOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type PostVotePost_idUser_idCompoundUniqueInput = {
    post_id: string
    user_id: string
  }

  export type PostVoteCountOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type PostVoteMaxOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type PostVoteMinOrderByAggregateInput = {
    id?: SortOrder
    post_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type CommentVoteComment_idUser_idCompoundUniqueInput = {
    comment_id: string
    user_id: string
  }

  export type CommentVoteCountOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type CommentVoteMaxOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type CommentVoteMinOrderByAggregateInput = {
    id?: SortOrder
    comment_id?: SortOrder
    user_id?: SortOrder
    vote_type?: SortOrder
    created_at?: SortOrder
  }

  export type GroupMemberListRelationFilter = {
    every?: GroupMemberWhereInput
    some?: GroupMemberWhereInput
    none?: GroupMemberWhereInput
  }

  export type MessageListRelationFilter = {
    every?: MessageWhereInput
    some?: MessageWhereInput
    none?: MessageWhereInput
  }

  export type GroupMemberOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MessageOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type GroupCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    description?: SortOrder
    created_by?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type GroupScalarRelationFilter = {
    is?: GroupWhereInput
    isNot?: GroupWhereInput
  }

  export type GroupMemberGroup_idUser_idCompoundUniqueInput = {
    group_id: string
    user_id: string
  }

  export type GroupMemberCountOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    user_id?: SortOrder
    role?: SortOrder
    joined_at?: SortOrder
  }

  export type GroupMemberMaxOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    user_id?: SortOrder
    role?: SortOrder
    joined_at?: SortOrder
  }

  export type GroupMemberMinOrderByAggregateInput = {
    id?: SortOrder
    group_id?: SortOrder
    user_id?: SortOrder
    role?: SortOrder
    joined_at?: SortOrder
  }

  export type GroupNullableScalarRelationFilter = {
    is?: GroupWhereInput | null
    isNot?: GroupWhereInput | null
  }

  export type MessageNullableScalarRelationFilter = {
    is?: MessageWhereInput | null
    isNot?: MessageWhereInput | null
  }

  export type MessageReadListRelationFilter = {
    every?: MessageReadWhereInput
    some?: MessageReadWhereInput
    none?: MessageReadWhereInput
  }

  export type MessageAttachmentListRelationFilter = {
    every?: MessageAttachmentWhereInput
    some?: MessageAttachmentWhereInput
    none?: MessageAttachmentWhereInput
  }

  export type MessageReadOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MessageAttachmentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MessageCountOrderByAggregateInput = {
    id?: SortOrder
    sender_id?: SortOrder
    recipient_id?: SortOrder
    group_id?: SortOrder
    parent_message_id?: SortOrder
    thread_id?: SortOrder
    message_type?: SortOrder
    subject?: SortOrder
    content?: SortOrder
    is_read?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type MessageMaxOrderByAggregateInput = {
    id?: SortOrder
    sender_id?: SortOrder
    recipient_id?: SortOrder
    group_id?: SortOrder
    parent_message_id?: SortOrder
    thread_id?: SortOrder
    message_type?: SortOrder
    subject?: SortOrder
    content?: SortOrder
    is_read?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type MessageMinOrderByAggregateInput = {
    id?: SortOrder
    sender_id?: SortOrder
    recipient_id?: SortOrder
    group_id?: SortOrder
    parent_message_id?: SortOrder
    thread_id?: SortOrder
    message_type?: SortOrder
    subject?: SortOrder
    content?: SortOrder
    is_read?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type MessageScalarRelationFilter = {
    is?: MessageWhereInput
    isNot?: MessageWhereInput
  }

  export type MessageAttachmentCountOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type MessageAttachmentAvgOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type MessageAttachmentMaxOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type MessageAttachmentMinOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    file_url?: SortOrder
    file_path?: SortOrder
    thumbnail_url?: SortOrder
    file_name?: SortOrder
    file_size?: SortOrder
    mime_type?: SortOrder
    file_type?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
    created_at?: SortOrder
  }

  export type MessageAttachmentSumOrderByAggregateInput = {
    file_size?: SortOrder
    width?: SortOrder
    height?: SortOrder
    duration?: SortOrder
    display_order?: SortOrder
  }

  export type MessageReadMessage_idUser_idCompoundUniqueInput = {
    message_id: string
    user_id: string
  }

  export type MessageReadCountOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    user_id?: SortOrder
    read_at?: SortOrder
    read_by_sender?: SortOrder
  }

  export type MessageReadMaxOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    user_id?: SortOrder
    read_at?: SortOrder
    read_by_sender?: SortOrder
  }

  export type MessageReadMinOrderByAggregateInput = {
    id?: SortOrder
    message_id?: SortOrder
    user_id?: SortOrder
    read_at?: SortOrder
    read_by_sender?: SortOrder
  }

  export type CommentCreateNestedManyWithoutPostInput = {
    create?: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput> | CommentCreateWithoutPostInput[] | CommentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutPostInput | CommentCreateOrConnectWithoutPostInput[]
    createMany?: CommentCreateManyPostInputEnvelope
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
  }

  export type PostVoteCreateNestedManyWithoutPostInput = {
    create?: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput> | PostVoteCreateWithoutPostInput[] | PostVoteUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostVoteCreateOrConnectWithoutPostInput | PostVoteCreateOrConnectWithoutPostInput[]
    createMany?: PostVoteCreateManyPostInputEnvelope
    connect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
  }

  export type PostAttachmentCreateNestedManyWithoutPostInput = {
    create?: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput> | PostAttachmentCreateWithoutPostInput[] | PostAttachmentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostAttachmentCreateOrConnectWithoutPostInput | PostAttachmentCreateOrConnectWithoutPostInput[]
    createMany?: PostAttachmentCreateManyPostInputEnvelope
    connect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
  }

  export type CommentUncheckedCreateNestedManyWithoutPostInput = {
    create?: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput> | CommentCreateWithoutPostInput[] | CommentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutPostInput | CommentCreateOrConnectWithoutPostInput[]
    createMany?: CommentCreateManyPostInputEnvelope
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
  }

  export type PostVoteUncheckedCreateNestedManyWithoutPostInput = {
    create?: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput> | PostVoteCreateWithoutPostInput[] | PostVoteUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostVoteCreateOrConnectWithoutPostInput | PostVoteCreateOrConnectWithoutPostInput[]
    createMany?: PostVoteCreateManyPostInputEnvelope
    connect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
  }

  export type PostAttachmentUncheckedCreateNestedManyWithoutPostInput = {
    create?: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput> | PostAttachmentCreateWithoutPostInput[] | PostAttachmentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostAttachmentCreateOrConnectWithoutPostInput | PostAttachmentCreateOrConnectWithoutPostInput[]
    createMany?: PostAttachmentCreateManyPostInputEnvelope
    connect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type CommentUpdateManyWithoutPostNestedInput = {
    create?: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput> | CommentCreateWithoutPostInput[] | CommentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutPostInput | CommentCreateOrConnectWithoutPostInput[]
    upsert?: CommentUpsertWithWhereUniqueWithoutPostInput | CommentUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: CommentCreateManyPostInputEnvelope
    set?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    disconnect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    delete?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    update?: CommentUpdateWithWhereUniqueWithoutPostInput | CommentUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: CommentUpdateManyWithWhereWithoutPostInput | CommentUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: CommentScalarWhereInput | CommentScalarWhereInput[]
  }

  export type PostVoteUpdateManyWithoutPostNestedInput = {
    create?: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput> | PostVoteCreateWithoutPostInput[] | PostVoteUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostVoteCreateOrConnectWithoutPostInput | PostVoteCreateOrConnectWithoutPostInput[]
    upsert?: PostVoteUpsertWithWhereUniqueWithoutPostInput | PostVoteUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: PostVoteCreateManyPostInputEnvelope
    set?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    disconnect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    delete?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    connect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    update?: PostVoteUpdateWithWhereUniqueWithoutPostInput | PostVoteUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: PostVoteUpdateManyWithWhereWithoutPostInput | PostVoteUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: PostVoteScalarWhereInput | PostVoteScalarWhereInput[]
  }

  export type PostAttachmentUpdateManyWithoutPostNestedInput = {
    create?: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput> | PostAttachmentCreateWithoutPostInput[] | PostAttachmentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostAttachmentCreateOrConnectWithoutPostInput | PostAttachmentCreateOrConnectWithoutPostInput[]
    upsert?: PostAttachmentUpsertWithWhereUniqueWithoutPostInput | PostAttachmentUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: PostAttachmentCreateManyPostInputEnvelope
    set?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    disconnect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    delete?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    connect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    update?: PostAttachmentUpdateWithWhereUniqueWithoutPostInput | PostAttachmentUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: PostAttachmentUpdateManyWithWhereWithoutPostInput | PostAttachmentUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: PostAttachmentScalarWhereInput | PostAttachmentScalarWhereInput[]
  }

  export type CommentUncheckedUpdateManyWithoutPostNestedInput = {
    create?: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput> | CommentCreateWithoutPostInput[] | CommentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutPostInput | CommentCreateOrConnectWithoutPostInput[]
    upsert?: CommentUpsertWithWhereUniqueWithoutPostInput | CommentUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: CommentCreateManyPostInputEnvelope
    set?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    disconnect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    delete?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    update?: CommentUpdateWithWhereUniqueWithoutPostInput | CommentUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: CommentUpdateManyWithWhereWithoutPostInput | CommentUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: CommentScalarWhereInput | CommentScalarWhereInput[]
  }

  export type PostVoteUncheckedUpdateManyWithoutPostNestedInput = {
    create?: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput> | PostVoteCreateWithoutPostInput[] | PostVoteUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostVoteCreateOrConnectWithoutPostInput | PostVoteCreateOrConnectWithoutPostInput[]
    upsert?: PostVoteUpsertWithWhereUniqueWithoutPostInput | PostVoteUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: PostVoteCreateManyPostInputEnvelope
    set?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    disconnect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    delete?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    connect?: PostVoteWhereUniqueInput | PostVoteWhereUniqueInput[]
    update?: PostVoteUpdateWithWhereUniqueWithoutPostInput | PostVoteUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: PostVoteUpdateManyWithWhereWithoutPostInput | PostVoteUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: PostVoteScalarWhereInput | PostVoteScalarWhereInput[]
  }

  export type PostAttachmentUncheckedUpdateManyWithoutPostNestedInput = {
    create?: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput> | PostAttachmentCreateWithoutPostInput[] | PostAttachmentUncheckedCreateWithoutPostInput[]
    connectOrCreate?: PostAttachmentCreateOrConnectWithoutPostInput | PostAttachmentCreateOrConnectWithoutPostInput[]
    upsert?: PostAttachmentUpsertWithWhereUniqueWithoutPostInput | PostAttachmentUpsertWithWhereUniqueWithoutPostInput[]
    createMany?: PostAttachmentCreateManyPostInputEnvelope
    set?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    disconnect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    delete?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    connect?: PostAttachmentWhereUniqueInput | PostAttachmentWhereUniqueInput[]
    update?: PostAttachmentUpdateWithWhereUniqueWithoutPostInput | PostAttachmentUpdateWithWhereUniqueWithoutPostInput[]
    updateMany?: PostAttachmentUpdateManyWithWhereWithoutPostInput | PostAttachmentUpdateManyWithWhereWithoutPostInput[]
    deleteMany?: PostAttachmentScalarWhereInput | PostAttachmentScalarWhereInput[]
  }

  export type PostCreateNestedOneWithoutAttachmentsInput = {
    create?: XOR<PostCreateWithoutAttachmentsInput, PostUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: PostCreateOrConnectWithoutAttachmentsInput
    connect?: PostWhereUniqueInput
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableBigIntFieldUpdateOperationsInput = {
    set?: bigint | number | null
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type PostUpdateOneRequiredWithoutAttachmentsNestedInput = {
    create?: XOR<PostCreateWithoutAttachmentsInput, PostUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: PostCreateOrConnectWithoutAttachmentsInput
    upsert?: PostUpsertWithoutAttachmentsInput
    connect?: PostWhereUniqueInput
    update?: XOR<XOR<PostUpdateToOneWithWhereWithoutAttachmentsInput, PostUpdateWithoutAttachmentsInput>, PostUncheckedUpdateWithoutAttachmentsInput>
  }

  export type PostCreateNestedOneWithoutCommentsInput = {
    create?: XOR<PostCreateWithoutCommentsInput, PostUncheckedCreateWithoutCommentsInput>
    connectOrCreate?: PostCreateOrConnectWithoutCommentsInput
    connect?: PostWhereUniqueInput
  }

  export type CommentCreateNestedOneWithoutRepliesInput = {
    create?: XOR<CommentCreateWithoutRepliesInput, CommentUncheckedCreateWithoutRepliesInput>
    connectOrCreate?: CommentCreateOrConnectWithoutRepliesInput
    connect?: CommentWhereUniqueInput
  }

  export type CommentCreateNestedManyWithoutParentInput = {
    create?: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput> | CommentCreateWithoutParentInput[] | CommentUncheckedCreateWithoutParentInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutParentInput | CommentCreateOrConnectWithoutParentInput[]
    createMany?: CommentCreateManyParentInputEnvelope
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
  }

  export type CommentVoteCreateNestedManyWithoutCommentInput = {
    create?: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput> | CommentVoteCreateWithoutCommentInput[] | CommentVoteUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentVoteCreateOrConnectWithoutCommentInput | CommentVoteCreateOrConnectWithoutCommentInput[]
    createMany?: CommentVoteCreateManyCommentInputEnvelope
    connect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
  }

  export type CommentAttachmentCreateNestedManyWithoutCommentInput = {
    create?: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput> | CommentAttachmentCreateWithoutCommentInput[] | CommentAttachmentUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentAttachmentCreateOrConnectWithoutCommentInput | CommentAttachmentCreateOrConnectWithoutCommentInput[]
    createMany?: CommentAttachmentCreateManyCommentInputEnvelope
    connect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
  }

  export type CommentUncheckedCreateNestedManyWithoutParentInput = {
    create?: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput> | CommentCreateWithoutParentInput[] | CommentUncheckedCreateWithoutParentInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutParentInput | CommentCreateOrConnectWithoutParentInput[]
    createMany?: CommentCreateManyParentInputEnvelope
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
  }

  export type CommentVoteUncheckedCreateNestedManyWithoutCommentInput = {
    create?: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput> | CommentVoteCreateWithoutCommentInput[] | CommentVoteUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentVoteCreateOrConnectWithoutCommentInput | CommentVoteCreateOrConnectWithoutCommentInput[]
    createMany?: CommentVoteCreateManyCommentInputEnvelope
    connect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
  }

  export type CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput = {
    create?: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput> | CommentAttachmentCreateWithoutCommentInput[] | CommentAttachmentUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentAttachmentCreateOrConnectWithoutCommentInput | CommentAttachmentCreateOrConnectWithoutCommentInput[]
    createMany?: CommentAttachmentCreateManyCommentInputEnvelope
    connect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
  }

  export type PostUpdateOneRequiredWithoutCommentsNestedInput = {
    create?: XOR<PostCreateWithoutCommentsInput, PostUncheckedCreateWithoutCommentsInput>
    connectOrCreate?: PostCreateOrConnectWithoutCommentsInput
    upsert?: PostUpsertWithoutCommentsInput
    connect?: PostWhereUniqueInput
    update?: XOR<XOR<PostUpdateToOneWithWhereWithoutCommentsInput, PostUpdateWithoutCommentsInput>, PostUncheckedUpdateWithoutCommentsInput>
  }

  export type CommentUpdateOneWithoutRepliesNestedInput = {
    create?: XOR<CommentCreateWithoutRepliesInput, CommentUncheckedCreateWithoutRepliesInput>
    connectOrCreate?: CommentCreateOrConnectWithoutRepliesInput
    upsert?: CommentUpsertWithoutRepliesInput
    disconnect?: CommentWhereInput | boolean
    delete?: CommentWhereInput | boolean
    connect?: CommentWhereUniqueInput
    update?: XOR<XOR<CommentUpdateToOneWithWhereWithoutRepliesInput, CommentUpdateWithoutRepliesInput>, CommentUncheckedUpdateWithoutRepliesInput>
  }

  export type CommentUpdateManyWithoutParentNestedInput = {
    create?: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput> | CommentCreateWithoutParentInput[] | CommentUncheckedCreateWithoutParentInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutParentInput | CommentCreateOrConnectWithoutParentInput[]
    upsert?: CommentUpsertWithWhereUniqueWithoutParentInput | CommentUpsertWithWhereUniqueWithoutParentInput[]
    createMany?: CommentCreateManyParentInputEnvelope
    set?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    disconnect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    delete?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    update?: CommentUpdateWithWhereUniqueWithoutParentInput | CommentUpdateWithWhereUniqueWithoutParentInput[]
    updateMany?: CommentUpdateManyWithWhereWithoutParentInput | CommentUpdateManyWithWhereWithoutParentInput[]
    deleteMany?: CommentScalarWhereInput | CommentScalarWhereInput[]
  }

  export type CommentVoteUpdateManyWithoutCommentNestedInput = {
    create?: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput> | CommentVoteCreateWithoutCommentInput[] | CommentVoteUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentVoteCreateOrConnectWithoutCommentInput | CommentVoteCreateOrConnectWithoutCommentInput[]
    upsert?: CommentVoteUpsertWithWhereUniqueWithoutCommentInput | CommentVoteUpsertWithWhereUniqueWithoutCommentInput[]
    createMany?: CommentVoteCreateManyCommentInputEnvelope
    set?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    disconnect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    delete?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    connect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    update?: CommentVoteUpdateWithWhereUniqueWithoutCommentInput | CommentVoteUpdateWithWhereUniqueWithoutCommentInput[]
    updateMany?: CommentVoteUpdateManyWithWhereWithoutCommentInput | CommentVoteUpdateManyWithWhereWithoutCommentInput[]
    deleteMany?: CommentVoteScalarWhereInput | CommentVoteScalarWhereInput[]
  }

  export type CommentAttachmentUpdateManyWithoutCommentNestedInput = {
    create?: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput> | CommentAttachmentCreateWithoutCommentInput[] | CommentAttachmentUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentAttachmentCreateOrConnectWithoutCommentInput | CommentAttachmentCreateOrConnectWithoutCommentInput[]
    upsert?: CommentAttachmentUpsertWithWhereUniqueWithoutCommentInput | CommentAttachmentUpsertWithWhereUniqueWithoutCommentInput[]
    createMany?: CommentAttachmentCreateManyCommentInputEnvelope
    set?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    disconnect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    delete?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    connect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    update?: CommentAttachmentUpdateWithWhereUniqueWithoutCommentInput | CommentAttachmentUpdateWithWhereUniqueWithoutCommentInput[]
    updateMany?: CommentAttachmentUpdateManyWithWhereWithoutCommentInput | CommentAttachmentUpdateManyWithWhereWithoutCommentInput[]
    deleteMany?: CommentAttachmentScalarWhereInput | CommentAttachmentScalarWhereInput[]
  }

  export type CommentUncheckedUpdateManyWithoutParentNestedInput = {
    create?: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput> | CommentCreateWithoutParentInput[] | CommentUncheckedCreateWithoutParentInput[]
    connectOrCreate?: CommentCreateOrConnectWithoutParentInput | CommentCreateOrConnectWithoutParentInput[]
    upsert?: CommentUpsertWithWhereUniqueWithoutParentInput | CommentUpsertWithWhereUniqueWithoutParentInput[]
    createMany?: CommentCreateManyParentInputEnvelope
    set?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    disconnect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    delete?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    connect?: CommentWhereUniqueInput | CommentWhereUniqueInput[]
    update?: CommentUpdateWithWhereUniqueWithoutParentInput | CommentUpdateWithWhereUniqueWithoutParentInput[]
    updateMany?: CommentUpdateManyWithWhereWithoutParentInput | CommentUpdateManyWithWhereWithoutParentInput[]
    deleteMany?: CommentScalarWhereInput | CommentScalarWhereInput[]
  }

  export type CommentVoteUncheckedUpdateManyWithoutCommentNestedInput = {
    create?: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput> | CommentVoteCreateWithoutCommentInput[] | CommentVoteUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentVoteCreateOrConnectWithoutCommentInput | CommentVoteCreateOrConnectWithoutCommentInput[]
    upsert?: CommentVoteUpsertWithWhereUniqueWithoutCommentInput | CommentVoteUpsertWithWhereUniqueWithoutCommentInput[]
    createMany?: CommentVoteCreateManyCommentInputEnvelope
    set?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    disconnect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    delete?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    connect?: CommentVoteWhereUniqueInput | CommentVoteWhereUniqueInput[]
    update?: CommentVoteUpdateWithWhereUniqueWithoutCommentInput | CommentVoteUpdateWithWhereUniqueWithoutCommentInput[]
    updateMany?: CommentVoteUpdateManyWithWhereWithoutCommentInput | CommentVoteUpdateManyWithWhereWithoutCommentInput[]
    deleteMany?: CommentVoteScalarWhereInput | CommentVoteScalarWhereInput[]
  }

  export type CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput = {
    create?: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput> | CommentAttachmentCreateWithoutCommentInput[] | CommentAttachmentUncheckedCreateWithoutCommentInput[]
    connectOrCreate?: CommentAttachmentCreateOrConnectWithoutCommentInput | CommentAttachmentCreateOrConnectWithoutCommentInput[]
    upsert?: CommentAttachmentUpsertWithWhereUniqueWithoutCommentInput | CommentAttachmentUpsertWithWhereUniqueWithoutCommentInput[]
    createMany?: CommentAttachmentCreateManyCommentInputEnvelope
    set?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    disconnect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    delete?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    connect?: CommentAttachmentWhereUniqueInput | CommentAttachmentWhereUniqueInput[]
    update?: CommentAttachmentUpdateWithWhereUniqueWithoutCommentInput | CommentAttachmentUpdateWithWhereUniqueWithoutCommentInput[]
    updateMany?: CommentAttachmentUpdateManyWithWhereWithoutCommentInput | CommentAttachmentUpdateManyWithWhereWithoutCommentInput[]
    deleteMany?: CommentAttachmentScalarWhereInput | CommentAttachmentScalarWhereInput[]
  }

  export type CommentCreateNestedOneWithoutAttachmentsInput = {
    create?: XOR<CommentCreateWithoutAttachmentsInput, CommentUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: CommentCreateOrConnectWithoutAttachmentsInput
    connect?: CommentWhereUniqueInput
  }

  export type CommentUpdateOneRequiredWithoutAttachmentsNestedInput = {
    create?: XOR<CommentCreateWithoutAttachmentsInput, CommentUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: CommentCreateOrConnectWithoutAttachmentsInput
    upsert?: CommentUpsertWithoutAttachmentsInput
    connect?: CommentWhereUniqueInput
    update?: XOR<XOR<CommentUpdateToOneWithWhereWithoutAttachmentsInput, CommentUpdateWithoutAttachmentsInput>, CommentUncheckedUpdateWithoutAttachmentsInput>
  }

  export type PostCreateNestedOneWithoutVotesInput = {
    create?: XOR<PostCreateWithoutVotesInput, PostUncheckedCreateWithoutVotesInput>
    connectOrCreate?: PostCreateOrConnectWithoutVotesInput
    connect?: PostWhereUniqueInput
  }

  export type PostUpdateOneRequiredWithoutVotesNestedInput = {
    create?: XOR<PostCreateWithoutVotesInput, PostUncheckedCreateWithoutVotesInput>
    connectOrCreate?: PostCreateOrConnectWithoutVotesInput
    upsert?: PostUpsertWithoutVotesInput
    connect?: PostWhereUniqueInput
    update?: XOR<XOR<PostUpdateToOneWithWhereWithoutVotesInput, PostUpdateWithoutVotesInput>, PostUncheckedUpdateWithoutVotesInput>
  }

  export type CommentCreateNestedOneWithoutVotesInput = {
    create?: XOR<CommentCreateWithoutVotesInput, CommentUncheckedCreateWithoutVotesInput>
    connectOrCreate?: CommentCreateOrConnectWithoutVotesInput
    connect?: CommentWhereUniqueInput
  }

  export type CommentUpdateOneRequiredWithoutVotesNestedInput = {
    create?: XOR<CommentCreateWithoutVotesInput, CommentUncheckedCreateWithoutVotesInput>
    connectOrCreate?: CommentCreateOrConnectWithoutVotesInput
    upsert?: CommentUpsertWithoutVotesInput
    connect?: CommentWhereUniqueInput
    update?: XOR<XOR<CommentUpdateToOneWithWhereWithoutVotesInput, CommentUpdateWithoutVotesInput>, CommentUncheckedUpdateWithoutVotesInput>
  }

  export type GroupMemberCreateNestedManyWithoutGroupInput = {
    create?: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput> | GroupMemberCreateWithoutGroupInput[] | GroupMemberUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: GroupMemberCreateOrConnectWithoutGroupInput | GroupMemberCreateOrConnectWithoutGroupInput[]
    createMany?: GroupMemberCreateManyGroupInputEnvelope
    connect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
  }

  export type MessageCreateNestedManyWithoutGroupInput = {
    create?: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput> | MessageCreateWithoutGroupInput[] | MessageUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutGroupInput | MessageCreateOrConnectWithoutGroupInput[]
    createMany?: MessageCreateManyGroupInputEnvelope
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
  }

  export type GroupMemberUncheckedCreateNestedManyWithoutGroupInput = {
    create?: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput> | GroupMemberCreateWithoutGroupInput[] | GroupMemberUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: GroupMemberCreateOrConnectWithoutGroupInput | GroupMemberCreateOrConnectWithoutGroupInput[]
    createMany?: GroupMemberCreateManyGroupInputEnvelope
    connect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
  }

  export type MessageUncheckedCreateNestedManyWithoutGroupInput = {
    create?: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput> | MessageCreateWithoutGroupInput[] | MessageUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutGroupInput | MessageCreateOrConnectWithoutGroupInput[]
    createMany?: MessageCreateManyGroupInputEnvelope
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
  }

  export type GroupMemberUpdateManyWithoutGroupNestedInput = {
    create?: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput> | GroupMemberCreateWithoutGroupInput[] | GroupMemberUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: GroupMemberCreateOrConnectWithoutGroupInput | GroupMemberCreateOrConnectWithoutGroupInput[]
    upsert?: GroupMemberUpsertWithWhereUniqueWithoutGroupInput | GroupMemberUpsertWithWhereUniqueWithoutGroupInput[]
    createMany?: GroupMemberCreateManyGroupInputEnvelope
    set?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    disconnect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    delete?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    connect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    update?: GroupMemberUpdateWithWhereUniqueWithoutGroupInput | GroupMemberUpdateWithWhereUniqueWithoutGroupInput[]
    updateMany?: GroupMemberUpdateManyWithWhereWithoutGroupInput | GroupMemberUpdateManyWithWhereWithoutGroupInput[]
    deleteMany?: GroupMemberScalarWhereInput | GroupMemberScalarWhereInput[]
  }

  export type MessageUpdateManyWithoutGroupNestedInput = {
    create?: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput> | MessageCreateWithoutGroupInput[] | MessageUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutGroupInput | MessageCreateOrConnectWithoutGroupInput[]
    upsert?: MessageUpsertWithWhereUniqueWithoutGroupInput | MessageUpsertWithWhereUniqueWithoutGroupInput[]
    createMany?: MessageCreateManyGroupInputEnvelope
    set?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    disconnect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    delete?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    update?: MessageUpdateWithWhereUniqueWithoutGroupInput | MessageUpdateWithWhereUniqueWithoutGroupInput[]
    updateMany?: MessageUpdateManyWithWhereWithoutGroupInput | MessageUpdateManyWithWhereWithoutGroupInput[]
    deleteMany?: MessageScalarWhereInput | MessageScalarWhereInput[]
  }

  export type GroupMemberUncheckedUpdateManyWithoutGroupNestedInput = {
    create?: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput> | GroupMemberCreateWithoutGroupInput[] | GroupMemberUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: GroupMemberCreateOrConnectWithoutGroupInput | GroupMemberCreateOrConnectWithoutGroupInput[]
    upsert?: GroupMemberUpsertWithWhereUniqueWithoutGroupInput | GroupMemberUpsertWithWhereUniqueWithoutGroupInput[]
    createMany?: GroupMemberCreateManyGroupInputEnvelope
    set?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    disconnect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    delete?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    connect?: GroupMemberWhereUniqueInput | GroupMemberWhereUniqueInput[]
    update?: GroupMemberUpdateWithWhereUniqueWithoutGroupInput | GroupMemberUpdateWithWhereUniqueWithoutGroupInput[]
    updateMany?: GroupMemberUpdateManyWithWhereWithoutGroupInput | GroupMemberUpdateManyWithWhereWithoutGroupInput[]
    deleteMany?: GroupMemberScalarWhereInput | GroupMemberScalarWhereInput[]
  }

  export type MessageUncheckedUpdateManyWithoutGroupNestedInput = {
    create?: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput> | MessageCreateWithoutGroupInput[] | MessageUncheckedCreateWithoutGroupInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutGroupInput | MessageCreateOrConnectWithoutGroupInput[]
    upsert?: MessageUpsertWithWhereUniqueWithoutGroupInput | MessageUpsertWithWhereUniqueWithoutGroupInput[]
    createMany?: MessageCreateManyGroupInputEnvelope
    set?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    disconnect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    delete?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    update?: MessageUpdateWithWhereUniqueWithoutGroupInput | MessageUpdateWithWhereUniqueWithoutGroupInput[]
    updateMany?: MessageUpdateManyWithWhereWithoutGroupInput | MessageUpdateManyWithWhereWithoutGroupInput[]
    deleteMany?: MessageScalarWhereInput | MessageScalarWhereInput[]
  }

  export type GroupCreateNestedOneWithoutMembersInput = {
    create?: XOR<GroupCreateWithoutMembersInput, GroupUncheckedCreateWithoutMembersInput>
    connectOrCreate?: GroupCreateOrConnectWithoutMembersInput
    connect?: GroupWhereUniqueInput
  }

  export type GroupUpdateOneRequiredWithoutMembersNestedInput = {
    create?: XOR<GroupCreateWithoutMembersInput, GroupUncheckedCreateWithoutMembersInput>
    connectOrCreate?: GroupCreateOrConnectWithoutMembersInput
    upsert?: GroupUpsertWithoutMembersInput
    connect?: GroupWhereUniqueInput
    update?: XOR<XOR<GroupUpdateToOneWithWhereWithoutMembersInput, GroupUpdateWithoutMembersInput>, GroupUncheckedUpdateWithoutMembersInput>
  }

  export type GroupCreateNestedOneWithoutMessagesInput = {
    create?: XOR<GroupCreateWithoutMessagesInput, GroupUncheckedCreateWithoutMessagesInput>
    connectOrCreate?: GroupCreateOrConnectWithoutMessagesInput
    connect?: GroupWhereUniqueInput
  }

  export type MessageCreateNestedOneWithoutRepliesInput = {
    create?: XOR<MessageCreateWithoutRepliesInput, MessageUncheckedCreateWithoutRepliesInput>
    connectOrCreate?: MessageCreateOrConnectWithoutRepliesInput
    connect?: MessageWhereUniqueInput
  }

  export type MessageCreateNestedManyWithoutParentInput = {
    create?: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput> | MessageCreateWithoutParentInput[] | MessageUncheckedCreateWithoutParentInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutParentInput | MessageCreateOrConnectWithoutParentInput[]
    createMany?: MessageCreateManyParentInputEnvelope
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
  }

  export type MessageReadCreateNestedManyWithoutMessageInput = {
    create?: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput> | MessageReadCreateWithoutMessageInput[] | MessageReadUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageReadCreateOrConnectWithoutMessageInput | MessageReadCreateOrConnectWithoutMessageInput[]
    createMany?: MessageReadCreateManyMessageInputEnvelope
    connect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
  }

  export type MessageAttachmentCreateNestedManyWithoutMessageInput = {
    create?: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput> | MessageAttachmentCreateWithoutMessageInput[] | MessageAttachmentUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageAttachmentCreateOrConnectWithoutMessageInput | MessageAttachmentCreateOrConnectWithoutMessageInput[]
    createMany?: MessageAttachmentCreateManyMessageInputEnvelope
    connect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
  }

  export type MessageUncheckedCreateNestedManyWithoutParentInput = {
    create?: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput> | MessageCreateWithoutParentInput[] | MessageUncheckedCreateWithoutParentInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutParentInput | MessageCreateOrConnectWithoutParentInput[]
    createMany?: MessageCreateManyParentInputEnvelope
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
  }

  export type MessageReadUncheckedCreateNestedManyWithoutMessageInput = {
    create?: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput> | MessageReadCreateWithoutMessageInput[] | MessageReadUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageReadCreateOrConnectWithoutMessageInput | MessageReadCreateOrConnectWithoutMessageInput[]
    createMany?: MessageReadCreateManyMessageInputEnvelope
    connect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
  }

  export type MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput = {
    create?: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput> | MessageAttachmentCreateWithoutMessageInput[] | MessageAttachmentUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageAttachmentCreateOrConnectWithoutMessageInput | MessageAttachmentCreateOrConnectWithoutMessageInput[]
    createMany?: MessageAttachmentCreateManyMessageInputEnvelope
    connect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
  }

  export type GroupUpdateOneWithoutMessagesNestedInput = {
    create?: XOR<GroupCreateWithoutMessagesInput, GroupUncheckedCreateWithoutMessagesInput>
    connectOrCreate?: GroupCreateOrConnectWithoutMessagesInput
    upsert?: GroupUpsertWithoutMessagesInput
    disconnect?: GroupWhereInput | boolean
    delete?: GroupWhereInput | boolean
    connect?: GroupWhereUniqueInput
    update?: XOR<XOR<GroupUpdateToOneWithWhereWithoutMessagesInput, GroupUpdateWithoutMessagesInput>, GroupUncheckedUpdateWithoutMessagesInput>
  }

  export type MessageUpdateOneWithoutRepliesNestedInput = {
    create?: XOR<MessageCreateWithoutRepliesInput, MessageUncheckedCreateWithoutRepliesInput>
    connectOrCreate?: MessageCreateOrConnectWithoutRepliesInput
    upsert?: MessageUpsertWithoutRepliesInput
    disconnect?: MessageWhereInput | boolean
    delete?: MessageWhereInput | boolean
    connect?: MessageWhereUniqueInput
    update?: XOR<XOR<MessageUpdateToOneWithWhereWithoutRepliesInput, MessageUpdateWithoutRepliesInput>, MessageUncheckedUpdateWithoutRepliesInput>
  }

  export type MessageUpdateManyWithoutParentNestedInput = {
    create?: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput> | MessageCreateWithoutParentInput[] | MessageUncheckedCreateWithoutParentInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutParentInput | MessageCreateOrConnectWithoutParentInput[]
    upsert?: MessageUpsertWithWhereUniqueWithoutParentInput | MessageUpsertWithWhereUniqueWithoutParentInput[]
    createMany?: MessageCreateManyParentInputEnvelope
    set?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    disconnect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    delete?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    update?: MessageUpdateWithWhereUniqueWithoutParentInput | MessageUpdateWithWhereUniqueWithoutParentInput[]
    updateMany?: MessageUpdateManyWithWhereWithoutParentInput | MessageUpdateManyWithWhereWithoutParentInput[]
    deleteMany?: MessageScalarWhereInput | MessageScalarWhereInput[]
  }

  export type MessageReadUpdateManyWithoutMessageNestedInput = {
    create?: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput> | MessageReadCreateWithoutMessageInput[] | MessageReadUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageReadCreateOrConnectWithoutMessageInput | MessageReadCreateOrConnectWithoutMessageInput[]
    upsert?: MessageReadUpsertWithWhereUniqueWithoutMessageInput | MessageReadUpsertWithWhereUniqueWithoutMessageInput[]
    createMany?: MessageReadCreateManyMessageInputEnvelope
    set?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    disconnect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    delete?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    connect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    update?: MessageReadUpdateWithWhereUniqueWithoutMessageInput | MessageReadUpdateWithWhereUniqueWithoutMessageInput[]
    updateMany?: MessageReadUpdateManyWithWhereWithoutMessageInput | MessageReadUpdateManyWithWhereWithoutMessageInput[]
    deleteMany?: MessageReadScalarWhereInput | MessageReadScalarWhereInput[]
  }

  export type MessageAttachmentUpdateManyWithoutMessageNestedInput = {
    create?: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput> | MessageAttachmentCreateWithoutMessageInput[] | MessageAttachmentUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageAttachmentCreateOrConnectWithoutMessageInput | MessageAttachmentCreateOrConnectWithoutMessageInput[]
    upsert?: MessageAttachmentUpsertWithWhereUniqueWithoutMessageInput | MessageAttachmentUpsertWithWhereUniqueWithoutMessageInput[]
    createMany?: MessageAttachmentCreateManyMessageInputEnvelope
    set?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    disconnect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    delete?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    connect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    update?: MessageAttachmentUpdateWithWhereUniqueWithoutMessageInput | MessageAttachmentUpdateWithWhereUniqueWithoutMessageInput[]
    updateMany?: MessageAttachmentUpdateManyWithWhereWithoutMessageInput | MessageAttachmentUpdateManyWithWhereWithoutMessageInput[]
    deleteMany?: MessageAttachmentScalarWhereInput | MessageAttachmentScalarWhereInput[]
  }

  export type MessageUncheckedUpdateManyWithoutParentNestedInput = {
    create?: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput> | MessageCreateWithoutParentInput[] | MessageUncheckedCreateWithoutParentInput[]
    connectOrCreate?: MessageCreateOrConnectWithoutParentInput | MessageCreateOrConnectWithoutParentInput[]
    upsert?: MessageUpsertWithWhereUniqueWithoutParentInput | MessageUpsertWithWhereUniqueWithoutParentInput[]
    createMany?: MessageCreateManyParentInputEnvelope
    set?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    disconnect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    delete?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    connect?: MessageWhereUniqueInput | MessageWhereUniqueInput[]
    update?: MessageUpdateWithWhereUniqueWithoutParentInput | MessageUpdateWithWhereUniqueWithoutParentInput[]
    updateMany?: MessageUpdateManyWithWhereWithoutParentInput | MessageUpdateManyWithWhereWithoutParentInput[]
    deleteMany?: MessageScalarWhereInput | MessageScalarWhereInput[]
  }

  export type MessageReadUncheckedUpdateManyWithoutMessageNestedInput = {
    create?: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput> | MessageReadCreateWithoutMessageInput[] | MessageReadUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageReadCreateOrConnectWithoutMessageInput | MessageReadCreateOrConnectWithoutMessageInput[]
    upsert?: MessageReadUpsertWithWhereUniqueWithoutMessageInput | MessageReadUpsertWithWhereUniqueWithoutMessageInput[]
    createMany?: MessageReadCreateManyMessageInputEnvelope
    set?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    disconnect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    delete?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    connect?: MessageReadWhereUniqueInput | MessageReadWhereUniqueInput[]
    update?: MessageReadUpdateWithWhereUniqueWithoutMessageInput | MessageReadUpdateWithWhereUniqueWithoutMessageInput[]
    updateMany?: MessageReadUpdateManyWithWhereWithoutMessageInput | MessageReadUpdateManyWithWhereWithoutMessageInput[]
    deleteMany?: MessageReadScalarWhereInput | MessageReadScalarWhereInput[]
  }

  export type MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput = {
    create?: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput> | MessageAttachmentCreateWithoutMessageInput[] | MessageAttachmentUncheckedCreateWithoutMessageInput[]
    connectOrCreate?: MessageAttachmentCreateOrConnectWithoutMessageInput | MessageAttachmentCreateOrConnectWithoutMessageInput[]
    upsert?: MessageAttachmentUpsertWithWhereUniqueWithoutMessageInput | MessageAttachmentUpsertWithWhereUniqueWithoutMessageInput[]
    createMany?: MessageAttachmentCreateManyMessageInputEnvelope
    set?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    disconnect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    delete?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    connect?: MessageAttachmentWhereUniqueInput | MessageAttachmentWhereUniqueInput[]
    update?: MessageAttachmentUpdateWithWhereUniqueWithoutMessageInput | MessageAttachmentUpdateWithWhereUniqueWithoutMessageInput[]
    updateMany?: MessageAttachmentUpdateManyWithWhereWithoutMessageInput | MessageAttachmentUpdateManyWithWhereWithoutMessageInput[]
    deleteMany?: MessageAttachmentScalarWhereInput | MessageAttachmentScalarWhereInput[]
  }

  export type MessageCreateNestedOneWithoutAttachmentsInput = {
    create?: XOR<MessageCreateWithoutAttachmentsInput, MessageUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: MessageCreateOrConnectWithoutAttachmentsInput
    connect?: MessageWhereUniqueInput
  }

  export type MessageUpdateOneRequiredWithoutAttachmentsNestedInput = {
    create?: XOR<MessageCreateWithoutAttachmentsInput, MessageUncheckedCreateWithoutAttachmentsInput>
    connectOrCreate?: MessageCreateOrConnectWithoutAttachmentsInput
    upsert?: MessageUpsertWithoutAttachmentsInput
    connect?: MessageWhereUniqueInput
    update?: XOR<XOR<MessageUpdateToOneWithWhereWithoutAttachmentsInput, MessageUpdateWithoutAttachmentsInput>, MessageUncheckedUpdateWithoutAttachmentsInput>
  }

  export type MessageCreateNestedOneWithoutReadsInput = {
    create?: XOR<MessageCreateWithoutReadsInput, MessageUncheckedCreateWithoutReadsInput>
    connectOrCreate?: MessageCreateOrConnectWithoutReadsInput
    connect?: MessageWhereUniqueInput
  }

  export type MessageUpdateOneRequiredWithoutReadsNestedInput = {
    create?: XOR<MessageCreateWithoutReadsInput, MessageUncheckedCreateWithoutReadsInput>
    connectOrCreate?: MessageCreateOrConnectWithoutReadsInput
    upsert?: MessageUpsertWithoutReadsInput
    connect?: MessageWhereUniqueInput
    update?: XOR<XOR<MessageUpdateToOneWithWhereWithoutReadsInput, MessageUpdateWithoutReadsInput>, MessageUncheckedUpdateWithoutReadsInput>
  }

  export type NestedUuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedUuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedBigIntNullableFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableFilter<$PrismaModel> | bigint | number | null
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedBigIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel> | null
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel> | null
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntNullableWithAggregatesFilter<$PrismaModel> | bigint | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedBigIntNullableFilter<$PrismaModel>
    _min?: NestedBigIntNullableFilter<$PrismaModel>
    _max?: NestedBigIntNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedUuidNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidNullableFilter<$PrismaModel> | string | null
  }

  export type NestedUuidNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type CommentCreateWithoutPostInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    parent?: CommentCreateNestedOneWithoutRepliesInput
    replies?: CommentCreateNestedManyWithoutParentInput
    votes?: CommentVoteCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateWithoutPostInput = {
    id?: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    replies?: CommentUncheckedCreateNestedManyWithoutParentInput
    votes?: CommentVoteUncheckedCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentCreateOrConnectWithoutPostInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput>
  }

  export type CommentCreateManyPostInputEnvelope = {
    data: CommentCreateManyPostInput | CommentCreateManyPostInput[]
    skipDuplicates?: boolean
  }

  export type PostVoteCreateWithoutPostInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type PostVoteUncheckedCreateWithoutPostInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type PostVoteCreateOrConnectWithoutPostInput = {
    where: PostVoteWhereUniqueInput
    create: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput>
  }

  export type PostVoteCreateManyPostInputEnvelope = {
    data: PostVoteCreateManyPostInput | PostVoteCreateManyPostInput[]
    skipDuplicates?: boolean
  }

  export type PostAttachmentCreateWithoutPostInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type PostAttachmentUncheckedCreateWithoutPostInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type PostAttachmentCreateOrConnectWithoutPostInput = {
    where: PostAttachmentWhereUniqueInput
    create: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput>
  }

  export type PostAttachmentCreateManyPostInputEnvelope = {
    data: PostAttachmentCreateManyPostInput | PostAttachmentCreateManyPostInput[]
    skipDuplicates?: boolean
  }

  export type CommentUpsertWithWhereUniqueWithoutPostInput = {
    where: CommentWhereUniqueInput
    update: XOR<CommentUpdateWithoutPostInput, CommentUncheckedUpdateWithoutPostInput>
    create: XOR<CommentCreateWithoutPostInput, CommentUncheckedCreateWithoutPostInput>
  }

  export type CommentUpdateWithWhereUniqueWithoutPostInput = {
    where: CommentWhereUniqueInput
    data: XOR<CommentUpdateWithoutPostInput, CommentUncheckedUpdateWithoutPostInput>
  }

  export type CommentUpdateManyWithWhereWithoutPostInput = {
    where: CommentScalarWhereInput
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyWithoutPostInput>
  }

  export type CommentScalarWhereInput = {
    AND?: CommentScalarWhereInput | CommentScalarWhereInput[]
    OR?: CommentScalarWhereInput[]
    NOT?: CommentScalarWhereInput | CommentScalarWhereInput[]
    id?: UuidFilter<"Comment"> | string
    post_id?: UuidFilter<"Comment"> | string
    user_id?: UuidFilter<"Comment"> | string
    parent_id?: UuidNullableFilter<"Comment"> | string | null
    content?: StringFilter<"Comment"> | string
    upvotes?: IntFilter<"Comment"> | number
    downvotes?: IntFilter<"Comment"> | number
    created_at?: DateTimeFilter<"Comment"> | Date | string
    updated_at?: DateTimeFilter<"Comment"> | Date | string
  }

  export type PostVoteUpsertWithWhereUniqueWithoutPostInput = {
    where: PostVoteWhereUniqueInput
    update: XOR<PostVoteUpdateWithoutPostInput, PostVoteUncheckedUpdateWithoutPostInput>
    create: XOR<PostVoteCreateWithoutPostInput, PostVoteUncheckedCreateWithoutPostInput>
  }

  export type PostVoteUpdateWithWhereUniqueWithoutPostInput = {
    where: PostVoteWhereUniqueInput
    data: XOR<PostVoteUpdateWithoutPostInput, PostVoteUncheckedUpdateWithoutPostInput>
  }

  export type PostVoteUpdateManyWithWhereWithoutPostInput = {
    where: PostVoteScalarWhereInput
    data: XOR<PostVoteUpdateManyMutationInput, PostVoteUncheckedUpdateManyWithoutPostInput>
  }

  export type PostVoteScalarWhereInput = {
    AND?: PostVoteScalarWhereInput | PostVoteScalarWhereInput[]
    OR?: PostVoteScalarWhereInput[]
    NOT?: PostVoteScalarWhereInput | PostVoteScalarWhereInput[]
    id?: UuidFilter<"PostVote"> | string
    post_id?: UuidFilter<"PostVote"> | string
    user_id?: UuidFilter<"PostVote"> | string
    vote_type?: StringFilter<"PostVote"> | string
    created_at?: DateTimeFilter<"PostVote"> | Date | string
  }

  export type PostAttachmentUpsertWithWhereUniqueWithoutPostInput = {
    where: PostAttachmentWhereUniqueInput
    update: XOR<PostAttachmentUpdateWithoutPostInput, PostAttachmentUncheckedUpdateWithoutPostInput>
    create: XOR<PostAttachmentCreateWithoutPostInput, PostAttachmentUncheckedCreateWithoutPostInput>
  }

  export type PostAttachmentUpdateWithWhereUniqueWithoutPostInput = {
    where: PostAttachmentWhereUniqueInput
    data: XOR<PostAttachmentUpdateWithoutPostInput, PostAttachmentUncheckedUpdateWithoutPostInput>
  }

  export type PostAttachmentUpdateManyWithWhereWithoutPostInput = {
    where: PostAttachmentScalarWhereInput
    data: XOR<PostAttachmentUpdateManyMutationInput, PostAttachmentUncheckedUpdateManyWithoutPostInput>
  }

  export type PostAttachmentScalarWhereInput = {
    AND?: PostAttachmentScalarWhereInput | PostAttachmentScalarWhereInput[]
    OR?: PostAttachmentScalarWhereInput[]
    NOT?: PostAttachmentScalarWhereInput | PostAttachmentScalarWhereInput[]
    id?: UuidFilter<"PostAttachment"> | string
    post_id?: UuidFilter<"PostAttachment"> | string
    file_url?: StringFilter<"PostAttachment"> | string
    file_path?: StringNullableFilter<"PostAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"PostAttachment"> | string | null
    file_name?: StringNullableFilter<"PostAttachment"> | string | null
    file_size?: BigIntNullableFilter<"PostAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"PostAttachment"> | string | null
    file_type?: StringFilter<"PostAttachment"> | string
    width?: IntNullableFilter<"PostAttachment"> | number | null
    height?: IntNullableFilter<"PostAttachment"> | number | null
    duration?: IntNullableFilter<"PostAttachment"> | number | null
    display_order?: IntFilter<"PostAttachment"> | number
    created_at?: DateTimeFilter<"PostAttachment"> | Date | string
  }

  export type PostCreateWithoutAttachmentsInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentCreateNestedManyWithoutPostInput
    votes?: PostVoteCreateNestedManyWithoutPostInput
  }

  export type PostUncheckedCreateWithoutAttachmentsInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentUncheckedCreateNestedManyWithoutPostInput
    votes?: PostVoteUncheckedCreateNestedManyWithoutPostInput
  }

  export type PostCreateOrConnectWithoutAttachmentsInput = {
    where: PostWhereUniqueInput
    create: XOR<PostCreateWithoutAttachmentsInput, PostUncheckedCreateWithoutAttachmentsInput>
  }

  export type PostUpsertWithoutAttachmentsInput = {
    update: XOR<PostUpdateWithoutAttachmentsInput, PostUncheckedUpdateWithoutAttachmentsInput>
    create: XOR<PostCreateWithoutAttachmentsInput, PostUncheckedCreateWithoutAttachmentsInput>
    where?: PostWhereInput
  }

  export type PostUpdateToOneWithWhereWithoutAttachmentsInput = {
    where?: PostWhereInput
    data: XOR<PostUpdateWithoutAttachmentsInput, PostUncheckedUpdateWithoutAttachmentsInput>
  }

  export type PostUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUpdateManyWithoutPostNestedInput
    votes?: PostVoteUpdateManyWithoutPostNestedInput
  }

  export type PostUncheckedUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUncheckedUpdateManyWithoutPostNestedInput
    votes?: PostVoteUncheckedUpdateManyWithoutPostNestedInput
  }

  export type PostCreateWithoutCommentsInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    votes?: PostVoteCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentCreateNestedManyWithoutPostInput
  }

  export type PostUncheckedCreateWithoutCommentsInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    votes?: PostVoteUncheckedCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentUncheckedCreateNestedManyWithoutPostInput
  }

  export type PostCreateOrConnectWithoutCommentsInput = {
    where: PostWhereUniqueInput
    create: XOR<PostCreateWithoutCommentsInput, PostUncheckedCreateWithoutCommentsInput>
  }

  export type CommentCreateWithoutRepliesInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    post: PostCreateNestedOneWithoutCommentsInput
    parent?: CommentCreateNestedOneWithoutRepliesInput
    votes?: CommentVoteCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateWithoutRepliesInput = {
    id?: string
    post_id: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    votes?: CommentVoteUncheckedCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentCreateOrConnectWithoutRepliesInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutRepliesInput, CommentUncheckedCreateWithoutRepliesInput>
  }

  export type CommentCreateWithoutParentInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    post: PostCreateNestedOneWithoutCommentsInput
    replies?: CommentCreateNestedManyWithoutParentInput
    votes?: CommentVoteCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateWithoutParentInput = {
    id?: string
    post_id: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    replies?: CommentUncheckedCreateNestedManyWithoutParentInput
    votes?: CommentVoteUncheckedCreateNestedManyWithoutCommentInput
    attachments?: CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentCreateOrConnectWithoutParentInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput>
  }

  export type CommentCreateManyParentInputEnvelope = {
    data: CommentCreateManyParentInput | CommentCreateManyParentInput[]
    skipDuplicates?: boolean
  }

  export type CommentVoteCreateWithoutCommentInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type CommentVoteUncheckedCreateWithoutCommentInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type CommentVoteCreateOrConnectWithoutCommentInput = {
    where: CommentVoteWhereUniqueInput
    create: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput>
  }

  export type CommentVoteCreateManyCommentInputEnvelope = {
    data: CommentVoteCreateManyCommentInput | CommentVoteCreateManyCommentInput[]
    skipDuplicates?: boolean
  }

  export type CommentAttachmentCreateWithoutCommentInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentAttachmentUncheckedCreateWithoutCommentInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentAttachmentCreateOrConnectWithoutCommentInput = {
    where: CommentAttachmentWhereUniqueInput
    create: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput>
  }

  export type CommentAttachmentCreateManyCommentInputEnvelope = {
    data: CommentAttachmentCreateManyCommentInput | CommentAttachmentCreateManyCommentInput[]
    skipDuplicates?: boolean
  }

  export type PostUpsertWithoutCommentsInput = {
    update: XOR<PostUpdateWithoutCommentsInput, PostUncheckedUpdateWithoutCommentsInput>
    create: XOR<PostCreateWithoutCommentsInput, PostUncheckedCreateWithoutCommentsInput>
    where?: PostWhereInput
  }

  export type PostUpdateToOneWithWhereWithoutCommentsInput = {
    where?: PostWhereInput
    data: XOR<PostUpdateWithoutCommentsInput, PostUncheckedUpdateWithoutCommentsInput>
  }

  export type PostUpdateWithoutCommentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    votes?: PostVoteUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUpdateManyWithoutPostNestedInput
  }

  export type PostUncheckedUpdateWithoutCommentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    votes?: PostVoteUncheckedUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUncheckedUpdateManyWithoutPostNestedInput
  }

  export type CommentUpsertWithoutRepliesInput = {
    update: XOR<CommentUpdateWithoutRepliesInput, CommentUncheckedUpdateWithoutRepliesInput>
    create: XOR<CommentCreateWithoutRepliesInput, CommentUncheckedCreateWithoutRepliesInput>
    where?: CommentWhereInput
  }

  export type CommentUpdateToOneWithWhereWithoutRepliesInput = {
    where?: CommentWhereInput
    data: XOR<CommentUpdateWithoutRepliesInput, CommentUncheckedUpdateWithoutRepliesInput>
  }

  export type CommentUpdateWithoutRepliesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutCommentsNestedInput
    parent?: CommentUpdateOneWithoutRepliesNestedInput
    votes?: CommentVoteUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateWithoutRepliesInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    votes?: CommentVoteUncheckedUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type CommentUpsertWithWhereUniqueWithoutParentInput = {
    where: CommentWhereUniqueInput
    update: XOR<CommentUpdateWithoutParentInput, CommentUncheckedUpdateWithoutParentInput>
    create: XOR<CommentCreateWithoutParentInput, CommentUncheckedCreateWithoutParentInput>
  }

  export type CommentUpdateWithWhereUniqueWithoutParentInput = {
    where: CommentWhereUniqueInput
    data: XOR<CommentUpdateWithoutParentInput, CommentUncheckedUpdateWithoutParentInput>
  }

  export type CommentUpdateManyWithWhereWithoutParentInput = {
    where: CommentScalarWhereInput
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyWithoutParentInput>
  }

  export type CommentVoteUpsertWithWhereUniqueWithoutCommentInput = {
    where: CommentVoteWhereUniqueInput
    update: XOR<CommentVoteUpdateWithoutCommentInput, CommentVoteUncheckedUpdateWithoutCommentInput>
    create: XOR<CommentVoteCreateWithoutCommentInput, CommentVoteUncheckedCreateWithoutCommentInput>
  }

  export type CommentVoteUpdateWithWhereUniqueWithoutCommentInput = {
    where: CommentVoteWhereUniqueInput
    data: XOR<CommentVoteUpdateWithoutCommentInput, CommentVoteUncheckedUpdateWithoutCommentInput>
  }

  export type CommentVoteUpdateManyWithWhereWithoutCommentInput = {
    where: CommentVoteScalarWhereInput
    data: XOR<CommentVoteUpdateManyMutationInput, CommentVoteUncheckedUpdateManyWithoutCommentInput>
  }

  export type CommentVoteScalarWhereInput = {
    AND?: CommentVoteScalarWhereInput | CommentVoteScalarWhereInput[]
    OR?: CommentVoteScalarWhereInput[]
    NOT?: CommentVoteScalarWhereInput | CommentVoteScalarWhereInput[]
    id?: UuidFilter<"CommentVote"> | string
    comment_id?: UuidFilter<"CommentVote"> | string
    user_id?: UuidFilter<"CommentVote"> | string
    vote_type?: StringFilter<"CommentVote"> | string
    created_at?: DateTimeFilter<"CommentVote"> | Date | string
  }

  export type CommentAttachmentUpsertWithWhereUniqueWithoutCommentInput = {
    where: CommentAttachmentWhereUniqueInput
    update: XOR<CommentAttachmentUpdateWithoutCommentInput, CommentAttachmentUncheckedUpdateWithoutCommentInput>
    create: XOR<CommentAttachmentCreateWithoutCommentInput, CommentAttachmentUncheckedCreateWithoutCommentInput>
  }

  export type CommentAttachmentUpdateWithWhereUniqueWithoutCommentInput = {
    where: CommentAttachmentWhereUniqueInput
    data: XOR<CommentAttachmentUpdateWithoutCommentInput, CommentAttachmentUncheckedUpdateWithoutCommentInput>
  }

  export type CommentAttachmentUpdateManyWithWhereWithoutCommentInput = {
    where: CommentAttachmentScalarWhereInput
    data: XOR<CommentAttachmentUpdateManyMutationInput, CommentAttachmentUncheckedUpdateManyWithoutCommentInput>
  }

  export type CommentAttachmentScalarWhereInput = {
    AND?: CommentAttachmentScalarWhereInput | CommentAttachmentScalarWhereInput[]
    OR?: CommentAttachmentScalarWhereInput[]
    NOT?: CommentAttachmentScalarWhereInput | CommentAttachmentScalarWhereInput[]
    id?: UuidFilter<"CommentAttachment"> | string
    comment_id?: UuidFilter<"CommentAttachment"> | string
    file_url?: StringFilter<"CommentAttachment"> | string
    file_path?: StringNullableFilter<"CommentAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"CommentAttachment"> | string | null
    file_name?: StringNullableFilter<"CommentAttachment"> | string | null
    file_size?: BigIntNullableFilter<"CommentAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"CommentAttachment"> | string | null
    file_type?: StringFilter<"CommentAttachment"> | string
    width?: IntNullableFilter<"CommentAttachment"> | number | null
    height?: IntNullableFilter<"CommentAttachment"> | number | null
    duration?: IntNullableFilter<"CommentAttachment"> | number | null
    display_order?: IntFilter<"CommentAttachment"> | number
    created_at?: DateTimeFilter<"CommentAttachment"> | Date | string
  }

  export type CommentCreateWithoutAttachmentsInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    post: PostCreateNestedOneWithoutCommentsInput
    parent?: CommentCreateNestedOneWithoutRepliesInput
    replies?: CommentCreateNestedManyWithoutParentInput
    votes?: CommentVoteCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateWithoutAttachmentsInput = {
    id?: string
    post_id: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    replies?: CommentUncheckedCreateNestedManyWithoutParentInput
    votes?: CommentVoteUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentCreateOrConnectWithoutAttachmentsInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutAttachmentsInput, CommentUncheckedCreateWithoutAttachmentsInput>
  }

  export type CommentUpsertWithoutAttachmentsInput = {
    update: XOR<CommentUpdateWithoutAttachmentsInput, CommentUncheckedUpdateWithoutAttachmentsInput>
    create: XOR<CommentCreateWithoutAttachmentsInput, CommentUncheckedCreateWithoutAttachmentsInput>
    where?: CommentWhereInput
  }

  export type CommentUpdateToOneWithWhereWithoutAttachmentsInput = {
    where?: CommentWhereInput
    data: XOR<CommentUpdateWithoutAttachmentsInput, CommentUncheckedUpdateWithoutAttachmentsInput>
  }

  export type CommentUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutCommentsNestedInput
    parent?: CommentUpdateOneWithoutRepliesNestedInput
    replies?: CommentUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: CommentUncheckedUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type PostCreateWithoutVotesInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentCreateNestedManyWithoutPostInput
  }

  export type PostUncheckedCreateWithoutVotesInput = {
    id?: string
    user_id: string
    title: string
    content: string
    flair?: string
    upload_type?: string
    upvotes?: number
    downvotes?: number
    comment_count?: number
    is_pinned?: boolean
    is_locked?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    comments?: CommentUncheckedCreateNestedManyWithoutPostInput
    attachments?: PostAttachmentUncheckedCreateNestedManyWithoutPostInput
  }

  export type PostCreateOrConnectWithoutVotesInput = {
    where: PostWhereUniqueInput
    create: XOR<PostCreateWithoutVotesInput, PostUncheckedCreateWithoutVotesInput>
  }

  export type PostUpsertWithoutVotesInput = {
    update: XOR<PostUpdateWithoutVotesInput, PostUncheckedUpdateWithoutVotesInput>
    create: XOR<PostCreateWithoutVotesInput, PostUncheckedCreateWithoutVotesInput>
    where?: PostWhereInput
  }

  export type PostUpdateToOneWithWhereWithoutVotesInput = {
    where?: PostWhereInput
    data: XOR<PostUpdateWithoutVotesInput, PostUncheckedUpdateWithoutVotesInput>
  }

  export type PostUpdateWithoutVotesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUpdateManyWithoutPostNestedInput
  }

  export type PostUncheckedUpdateWithoutVotesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    flair?: StringFieldUpdateOperationsInput | string
    upload_type?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    comment_count?: IntFieldUpdateOperationsInput | number
    is_pinned?: BoolFieldUpdateOperationsInput | boolean
    is_locked?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    comments?: CommentUncheckedUpdateManyWithoutPostNestedInput
    attachments?: PostAttachmentUncheckedUpdateManyWithoutPostNestedInput
  }

  export type CommentCreateWithoutVotesInput = {
    id?: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    post: PostCreateNestedOneWithoutCommentsInput
    parent?: CommentCreateNestedOneWithoutRepliesInput
    replies?: CommentCreateNestedManyWithoutParentInput
    attachments?: CommentAttachmentCreateNestedManyWithoutCommentInput
  }

  export type CommentUncheckedCreateWithoutVotesInput = {
    id?: string
    post_id: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
    replies?: CommentUncheckedCreateNestedManyWithoutParentInput
    attachments?: CommentAttachmentUncheckedCreateNestedManyWithoutCommentInput
  }

  export type CommentCreateOrConnectWithoutVotesInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutVotesInput, CommentUncheckedCreateWithoutVotesInput>
  }

  export type CommentUpsertWithoutVotesInput = {
    update: XOR<CommentUpdateWithoutVotesInput, CommentUncheckedUpdateWithoutVotesInput>
    create: XOR<CommentCreateWithoutVotesInput, CommentUncheckedCreateWithoutVotesInput>
    where?: CommentWhereInput
  }

  export type CommentUpdateToOneWithWhereWithoutVotesInput = {
    where?: CommentWhereInput
    data: XOR<CommentUpdateWithoutVotesInput, CommentUncheckedUpdateWithoutVotesInput>
  }

  export type CommentUpdateWithoutVotesInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutCommentsNestedInput
    parent?: CommentUpdateOneWithoutRepliesNestedInput
    replies?: CommentUpdateManyWithoutParentNestedInput
    attachments?: CommentAttachmentUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateWithoutVotesInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: CommentUncheckedUpdateManyWithoutParentNestedInput
    attachments?: CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type GroupMemberCreateWithoutGroupInput = {
    id?: string
    user_id: string
    role?: string
    joined_at?: Date | string
  }

  export type GroupMemberUncheckedCreateWithoutGroupInput = {
    id?: string
    user_id: string
    role?: string
    joined_at?: Date | string
  }

  export type GroupMemberCreateOrConnectWithoutGroupInput = {
    where: GroupMemberWhereUniqueInput
    create: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput>
  }

  export type GroupMemberCreateManyGroupInputEnvelope = {
    data: GroupMemberCreateManyGroupInput | GroupMemberCreateManyGroupInput[]
    skipDuplicates?: boolean
  }

  export type MessageCreateWithoutGroupInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    parent?: MessageCreateNestedOneWithoutRepliesInput
    replies?: MessageCreateNestedManyWithoutParentInput
    reads?: MessageReadCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateWithoutGroupInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    replies?: MessageUncheckedCreateNestedManyWithoutParentInput
    reads?: MessageReadUncheckedCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageCreateOrConnectWithoutGroupInput = {
    where: MessageWhereUniqueInput
    create: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput>
  }

  export type MessageCreateManyGroupInputEnvelope = {
    data: MessageCreateManyGroupInput | MessageCreateManyGroupInput[]
    skipDuplicates?: boolean
  }

  export type GroupMemberUpsertWithWhereUniqueWithoutGroupInput = {
    where: GroupMemberWhereUniqueInput
    update: XOR<GroupMemberUpdateWithoutGroupInput, GroupMemberUncheckedUpdateWithoutGroupInput>
    create: XOR<GroupMemberCreateWithoutGroupInput, GroupMemberUncheckedCreateWithoutGroupInput>
  }

  export type GroupMemberUpdateWithWhereUniqueWithoutGroupInput = {
    where: GroupMemberWhereUniqueInput
    data: XOR<GroupMemberUpdateWithoutGroupInput, GroupMemberUncheckedUpdateWithoutGroupInput>
  }

  export type GroupMemberUpdateManyWithWhereWithoutGroupInput = {
    where: GroupMemberScalarWhereInput
    data: XOR<GroupMemberUpdateManyMutationInput, GroupMemberUncheckedUpdateManyWithoutGroupInput>
  }

  export type GroupMemberScalarWhereInput = {
    AND?: GroupMemberScalarWhereInput | GroupMemberScalarWhereInput[]
    OR?: GroupMemberScalarWhereInput[]
    NOT?: GroupMemberScalarWhereInput | GroupMemberScalarWhereInput[]
    id?: UuidFilter<"GroupMember"> | string
    group_id?: UuidFilter<"GroupMember"> | string
    user_id?: UuidFilter<"GroupMember"> | string
    role?: StringFilter<"GroupMember"> | string
    joined_at?: DateTimeFilter<"GroupMember"> | Date | string
  }

  export type MessageUpsertWithWhereUniqueWithoutGroupInput = {
    where: MessageWhereUniqueInput
    update: XOR<MessageUpdateWithoutGroupInput, MessageUncheckedUpdateWithoutGroupInput>
    create: XOR<MessageCreateWithoutGroupInput, MessageUncheckedCreateWithoutGroupInput>
  }

  export type MessageUpdateWithWhereUniqueWithoutGroupInput = {
    where: MessageWhereUniqueInput
    data: XOR<MessageUpdateWithoutGroupInput, MessageUncheckedUpdateWithoutGroupInput>
  }

  export type MessageUpdateManyWithWhereWithoutGroupInput = {
    where: MessageScalarWhereInput
    data: XOR<MessageUpdateManyMutationInput, MessageUncheckedUpdateManyWithoutGroupInput>
  }

  export type MessageScalarWhereInput = {
    AND?: MessageScalarWhereInput | MessageScalarWhereInput[]
    OR?: MessageScalarWhereInput[]
    NOT?: MessageScalarWhereInput | MessageScalarWhereInput[]
    id?: UuidFilter<"Message"> | string
    sender_id?: UuidFilter<"Message"> | string
    recipient_id?: UuidNullableFilter<"Message"> | string | null
    group_id?: UuidNullableFilter<"Message"> | string | null
    parent_message_id?: UuidNullableFilter<"Message"> | string | null
    thread_id?: UuidNullableFilter<"Message"> | string | null
    message_type?: StringFilter<"Message"> | string
    subject?: StringFilter<"Message"> | string
    content?: StringFilter<"Message"> | string
    is_read?: BoolFilter<"Message"> | boolean
    created_at?: DateTimeFilter<"Message"> | Date | string
    updated_at?: DateTimeFilter<"Message"> | Date | string
  }

  export type GroupCreateWithoutMembersInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    messages?: MessageCreateNestedManyWithoutGroupInput
  }

  export type GroupUncheckedCreateWithoutMembersInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    messages?: MessageUncheckedCreateNestedManyWithoutGroupInput
  }

  export type GroupCreateOrConnectWithoutMembersInput = {
    where: GroupWhereUniqueInput
    create: XOR<GroupCreateWithoutMembersInput, GroupUncheckedCreateWithoutMembersInput>
  }

  export type GroupUpsertWithoutMembersInput = {
    update: XOR<GroupUpdateWithoutMembersInput, GroupUncheckedUpdateWithoutMembersInput>
    create: XOR<GroupCreateWithoutMembersInput, GroupUncheckedCreateWithoutMembersInput>
    where?: GroupWhereInput
  }

  export type GroupUpdateToOneWithWhereWithoutMembersInput = {
    where?: GroupWhereInput
    data: XOR<GroupUpdateWithoutMembersInput, GroupUncheckedUpdateWithoutMembersInput>
  }

  export type GroupUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    messages?: MessageUpdateManyWithoutGroupNestedInput
  }

  export type GroupUncheckedUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    messages?: MessageUncheckedUpdateManyWithoutGroupNestedInput
  }

  export type GroupCreateWithoutMessagesInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    members?: GroupMemberCreateNestedManyWithoutGroupInput
  }

  export type GroupUncheckedCreateWithoutMessagesInput = {
    id?: string
    name: string
    description?: string | null
    created_by: string
    created_at?: Date | string
    updated_at?: Date | string
    members?: GroupMemberUncheckedCreateNestedManyWithoutGroupInput
  }

  export type GroupCreateOrConnectWithoutMessagesInput = {
    where: GroupWhereUniqueInput
    create: XOR<GroupCreateWithoutMessagesInput, GroupUncheckedCreateWithoutMessagesInput>
  }

  export type MessageCreateWithoutRepliesInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    group?: GroupCreateNestedOneWithoutMessagesInput
    parent?: MessageCreateNestedOneWithoutRepliesInput
    reads?: MessageReadCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateWithoutRepliesInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    reads?: MessageReadUncheckedCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageCreateOrConnectWithoutRepliesInput = {
    where: MessageWhereUniqueInput
    create: XOR<MessageCreateWithoutRepliesInput, MessageUncheckedCreateWithoutRepliesInput>
  }

  export type MessageCreateWithoutParentInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    group?: GroupCreateNestedOneWithoutMessagesInput
    replies?: MessageCreateNestedManyWithoutParentInput
    reads?: MessageReadCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateWithoutParentInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    replies?: MessageUncheckedCreateNestedManyWithoutParentInput
    reads?: MessageReadUncheckedCreateNestedManyWithoutMessageInput
    attachments?: MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageCreateOrConnectWithoutParentInput = {
    where: MessageWhereUniqueInput
    create: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput>
  }

  export type MessageCreateManyParentInputEnvelope = {
    data: MessageCreateManyParentInput | MessageCreateManyParentInput[]
    skipDuplicates?: boolean
  }

  export type MessageReadCreateWithoutMessageInput = {
    id?: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
  }

  export type MessageReadUncheckedCreateWithoutMessageInput = {
    id?: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
  }

  export type MessageReadCreateOrConnectWithoutMessageInput = {
    where: MessageReadWhereUniqueInput
    create: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput>
  }

  export type MessageReadCreateManyMessageInputEnvelope = {
    data: MessageReadCreateManyMessageInput | MessageReadCreateManyMessageInput[]
    skipDuplicates?: boolean
  }

  export type MessageAttachmentCreateWithoutMessageInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type MessageAttachmentUncheckedCreateWithoutMessageInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type MessageAttachmentCreateOrConnectWithoutMessageInput = {
    where: MessageAttachmentWhereUniqueInput
    create: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput>
  }

  export type MessageAttachmentCreateManyMessageInputEnvelope = {
    data: MessageAttachmentCreateManyMessageInput | MessageAttachmentCreateManyMessageInput[]
    skipDuplicates?: boolean
  }

  export type GroupUpsertWithoutMessagesInput = {
    update: XOR<GroupUpdateWithoutMessagesInput, GroupUncheckedUpdateWithoutMessagesInput>
    create: XOR<GroupCreateWithoutMessagesInput, GroupUncheckedCreateWithoutMessagesInput>
    where?: GroupWhereInput
  }

  export type GroupUpdateToOneWithWhereWithoutMessagesInput = {
    where?: GroupWhereInput
    data: XOR<GroupUpdateWithoutMessagesInput, GroupUncheckedUpdateWithoutMessagesInput>
  }

  export type GroupUpdateWithoutMessagesInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: GroupMemberUpdateManyWithoutGroupNestedInput
  }

  export type GroupUncheckedUpdateWithoutMessagesInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    created_by?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: GroupMemberUncheckedUpdateManyWithoutGroupNestedInput
  }

  export type MessageUpsertWithoutRepliesInput = {
    update: XOR<MessageUpdateWithoutRepliesInput, MessageUncheckedUpdateWithoutRepliesInput>
    create: XOR<MessageCreateWithoutRepliesInput, MessageUncheckedCreateWithoutRepliesInput>
    where?: MessageWhereInput
  }

  export type MessageUpdateToOneWithWhereWithoutRepliesInput = {
    where?: MessageWhereInput
    data: XOR<MessageUpdateWithoutRepliesInput, MessageUncheckedUpdateWithoutRepliesInput>
  }

  export type MessageUpdateWithoutRepliesInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneWithoutMessagesNestedInput
    parent?: MessageUpdateOneWithoutRepliesNestedInput
    reads?: MessageReadUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateWithoutRepliesInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    reads?: MessageReadUncheckedUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type MessageUpsertWithWhereUniqueWithoutParentInput = {
    where: MessageWhereUniqueInput
    update: XOR<MessageUpdateWithoutParentInput, MessageUncheckedUpdateWithoutParentInput>
    create: XOR<MessageCreateWithoutParentInput, MessageUncheckedCreateWithoutParentInput>
  }

  export type MessageUpdateWithWhereUniqueWithoutParentInput = {
    where: MessageWhereUniqueInput
    data: XOR<MessageUpdateWithoutParentInput, MessageUncheckedUpdateWithoutParentInput>
  }

  export type MessageUpdateManyWithWhereWithoutParentInput = {
    where: MessageScalarWhereInput
    data: XOR<MessageUpdateManyMutationInput, MessageUncheckedUpdateManyWithoutParentInput>
  }

  export type MessageReadUpsertWithWhereUniqueWithoutMessageInput = {
    where: MessageReadWhereUniqueInput
    update: XOR<MessageReadUpdateWithoutMessageInput, MessageReadUncheckedUpdateWithoutMessageInput>
    create: XOR<MessageReadCreateWithoutMessageInput, MessageReadUncheckedCreateWithoutMessageInput>
  }

  export type MessageReadUpdateWithWhereUniqueWithoutMessageInput = {
    where: MessageReadWhereUniqueInput
    data: XOR<MessageReadUpdateWithoutMessageInput, MessageReadUncheckedUpdateWithoutMessageInput>
  }

  export type MessageReadUpdateManyWithWhereWithoutMessageInput = {
    where: MessageReadScalarWhereInput
    data: XOR<MessageReadUpdateManyMutationInput, MessageReadUncheckedUpdateManyWithoutMessageInput>
  }

  export type MessageReadScalarWhereInput = {
    AND?: MessageReadScalarWhereInput | MessageReadScalarWhereInput[]
    OR?: MessageReadScalarWhereInput[]
    NOT?: MessageReadScalarWhereInput | MessageReadScalarWhereInput[]
    id?: UuidFilter<"MessageRead"> | string
    message_id?: UuidFilter<"MessageRead"> | string
    user_id?: UuidFilter<"MessageRead"> | string
    read_at?: DateTimeFilter<"MessageRead"> | Date | string
    read_by_sender?: BoolFilter<"MessageRead"> | boolean
  }

  export type MessageAttachmentUpsertWithWhereUniqueWithoutMessageInput = {
    where: MessageAttachmentWhereUniqueInput
    update: XOR<MessageAttachmentUpdateWithoutMessageInput, MessageAttachmentUncheckedUpdateWithoutMessageInput>
    create: XOR<MessageAttachmentCreateWithoutMessageInput, MessageAttachmentUncheckedCreateWithoutMessageInput>
  }

  export type MessageAttachmentUpdateWithWhereUniqueWithoutMessageInput = {
    where: MessageAttachmentWhereUniqueInput
    data: XOR<MessageAttachmentUpdateWithoutMessageInput, MessageAttachmentUncheckedUpdateWithoutMessageInput>
  }

  export type MessageAttachmentUpdateManyWithWhereWithoutMessageInput = {
    where: MessageAttachmentScalarWhereInput
    data: XOR<MessageAttachmentUpdateManyMutationInput, MessageAttachmentUncheckedUpdateManyWithoutMessageInput>
  }

  export type MessageAttachmentScalarWhereInput = {
    AND?: MessageAttachmentScalarWhereInput | MessageAttachmentScalarWhereInput[]
    OR?: MessageAttachmentScalarWhereInput[]
    NOT?: MessageAttachmentScalarWhereInput | MessageAttachmentScalarWhereInput[]
    id?: UuidFilter<"MessageAttachment"> | string
    message_id?: UuidFilter<"MessageAttachment"> | string
    file_url?: StringFilter<"MessageAttachment"> | string
    file_path?: StringNullableFilter<"MessageAttachment"> | string | null
    thumbnail_url?: StringNullableFilter<"MessageAttachment"> | string | null
    file_name?: StringNullableFilter<"MessageAttachment"> | string | null
    file_size?: BigIntNullableFilter<"MessageAttachment"> | bigint | number | null
    mime_type?: StringNullableFilter<"MessageAttachment"> | string | null
    file_type?: StringFilter<"MessageAttachment"> | string
    width?: IntNullableFilter<"MessageAttachment"> | number | null
    height?: IntNullableFilter<"MessageAttachment"> | number | null
    duration?: IntNullableFilter<"MessageAttachment"> | number | null
    display_order?: IntFilter<"MessageAttachment"> | number
    created_at?: DateTimeFilter<"MessageAttachment"> | Date | string
  }

  export type MessageCreateWithoutAttachmentsInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    group?: GroupCreateNestedOneWithoutMessagesInput
    parent?: MessageCreateNestedOneWithoutRepliesInput
    replies?: MessageCreateNestedManyWithoutParentInput
    reads?: MessageReadCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateWithoutAttachmentsInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    replies?: MessageUncheckedCreateNestedManyWithoutParentInput
    reads?: MessageReadUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageCreateOrConnectWithoutAttachmentsInput = {
    where: MessageWhereUniqueInput
    create: XOR<MessageCreateWithoutAttachmentsInput, MessageUncheckedCreateWithoutAttachmentsInput>
  }

  export type MessageUpsertWithoutAttachmentsInput = {
    update: XOR<MessageUpdateWithoutAttachmentsInput, MessageUncheckedUpdateWithoutAttachmentsInput>
    create: XOR<MessageCreateWithoutAttachmentsInput, MessageUncheckedCreateWithoutAttachmentsInput>
    where?: MessageWhereInput
  }

  export type MessageUpdateToOneWithWhereWithoutAttachmentsInput = {
    where?: MessageWhereInput
    data: XOR<MessageUpdateWithoutAttachmentsInput, MessageUncheckedUpdateWithoutAttachmentsInput>
  }

  export type MessageUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneWithoutMessagesNestedInput
    parent?: MessageUpdateOneWithoutRepliesNestedInput
    replies?: MessageUpdateManyWithoutParentNestedInput
    reads?: MessageReadUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateWithoutAttachmentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: MessageUncheckedUpdateManyWithoutParentNestedInput
    reads?: MessageReadUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type MessageCreateWithoutReadsInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    group?: GroupCreateNestedOneWithoutMessagesInput
    parent?: MessageCreateNestedOneWithoutRepliesInput
    replies?: MessageCreateNestedManyWithoutParentInput
    attachments?: MessageAttachmentCreateNestedManyWithoutMessageInput
  }

  export type MessageUncheckedCreateWithoutReadsInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
    replies?: MessageUncheckedCreateNestedManyWithoutParentInput
    attachments?: MessageAttachmentUncheckedCreateNestedManyWithoutMessageInput
  }

  export type MessageCreateOrConnectWithoutReadsInput = {
    where: MessageWhereUniqueInput
    create: XOR<MessageCreateWithoutReadsInput, MessageUncheckedCreateWithoutReadsInput>
  }

  export type MessageUpsertWithoutReadsInput = {
    update: XOR<MessageUpdateWithoutReadsInput, MessageUncheckedUpdateWithoutReadsInput>
    create: XOR<MessageCreateWithoutReadsInput, MessageUncheckedCreateWithoutReadsInput>
    where?: MessageWhereInput
  }

  export type MessageUpdateToOneWithWhereWithoutReadsInput = {
    where?: MessageWhereInput
    data: XOR<MessageUpdateWithoutReadsInput, MessageUncheckedUpdateWithoutReadsInput>
  }

  export type MessageUpdateWithoutReadsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneWithoutMessagesNestedInput
    parent?: MessageUpdateOneWithoutRepliesNestedInput
    replies?: MessageUpdateManyWithoutParentNestedInput
    attachments?: MessageAttachmentUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateWithoutReadsInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: MessageUncheckedUpdateManyWithoutParentNestedInput
    attachments?: MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type CommentCreateManyPostInput = {
    id?: string
    user_id: string
    parent_id?: string | null
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type PostVoteCreateManyPostInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type PostAttachmentCreateManyPostInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    parent?: CommentUpdateOneWithoutRepliesNestedInput
    replies?: CommentUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: CommentUncheckedUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUncheckedUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateManyWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    parent_id?: NullableStringFieldUpdateOperationsInput | string | null
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteUncheckedUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostVoteUncheckedUpdateManyWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentUncheckedUpdateWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PostAttachmentUncheckedUpdateManyWithoutPostInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentCreateManyParentInput = {
    id?: string
    post_id: string
    user_id: string
    content: string
    upvotes?: number
    downvotes?: number
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type CommentVoteCreateManyCommentInput = {
    id?: string
    user_id: string
    vote_type: string
    created_at?: Date | string
  }

  export type CommentAttachmentCreateManyCommentInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type CommentUpdateWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    post?: PostUpdateOneRequiredWithoutCommentsNestedInput
    replies?: CommentUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: CommentUncheckedUpdateManyWithoutParentNestedInput
    votes?: CommentVoteUncheckedUpdateManyWithoutCommentNestedInput
    attachments?: CommentAttachmentUncheckedUpdateManyWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateManyWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    post_id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    upvotes?: IntFieldUpdateOperationsInput | number
    downvotes?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteUncheckedUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentVoteUncheckedUpdateManyWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    vote_type?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentUncheckedUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CommentAttachmentUncheckedUpdateManyWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberCreateManyGroupInput = {
    id?: string
    user_id: string
    role?: string
    joined_at?: Date | string
  }

  export type MessageCreateManyGroupInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    parent_message_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type GroupMemberUpdateWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberUncheckedUpdateWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GroupMemberUncheckedUpdateManyWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    role?: StringFieldUpdateOperationsInput | string
    joined_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageUpdateWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    parent?: MessageUpdateOneWithoutRepliesNestedInput
    replies?: MessageUpdateManyWithoutParentNestedInput
    reads?: MessageReadUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: MessageUncheckedUpdateManyWithoutParentNestedInput
    reads?: MessageReadUncheckedUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateManyWithoutGroupInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    parent_message_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageCreateManyParentInput = {
    id?: string
    sender_id: string
    recipient_id?: string | null
    group_id?: string | null
    thread_id?: string | null
    message_type?: string
    subject: string
    content: string
    is_read?: boolean
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type MessageReadCreateManyMessageInput = {
    id?: string
    user_id: string
    read_at?: Date | string
    read_by_sender?: boolean
  }

  export type MessageAttachmentCreateManyMessageInput = {
    id?: string
    file_url: string
    file_path?: string | null
    thumbnail_url?: string | null
    file_name?: string | null
    file_size?: bigint | number | null
    mime_type?: string | null
    file_type: string
    width?: number | null
    height?: number | null
    duration?: number | null
    display_order?: number
    created_at?: Date | string
  }

  export type MessageUpdateWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    group?: GroupUpdateOneWithoutMessagesNestedInput
    replies?: MessageUpdateManyWithoutParentNestedInput
    reads?: MessageReadUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
    replies?: MessageUncheckedUpdateManyWithoutParentNestedInput
    reads?: MessageReadUncheckedUpdateManyWithoutMessageNestedInput
    attachments?: MessageAttachmentUncheckedUpdateManyWithoutMessageNestedInput
  }

  export type MessageUncheckedUpdateManyWithoutParentInput = {
    id?: StringFieldUpdateOperationsInput | string
    sender_id?: StringFieldUpdateOperationsInput | string
    recipient_id?: NullableStringFieldUpdateOperationsInput | string | null
    group_id?: NullableStringFieldUpdateOperationsInput | string | null
    thread_id?: NullableStringFieldUpdateOperationsInput | string | null
    message_type?: StringFieldUpdateOperationsInput | string
    subject?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    is_read?: BoolFieldUpdateOperationsInput | boolean
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageReadUpdateWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type MessageReadUncheckedUpdateWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type MessageReadUncheckedUpdateManyWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    read_at?: DateTimeFieldUpdateOperationsInput | Date | string
    read_by_sender?: BoolFieldUpdateOperationsInput | boolean
  }

  export type MessageAttachmentUpdateWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageAttachmentUncheckedUpdateWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MessageAttachmentUncheckedUpdateManyWithoutMessageInput = {
    id?: StringFieldUpdateOperationsInput | string
    file_url?: StringFieldUpdateOperationsInput | string
    file_path?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnail_url?: NullableStringFieldUpdateOperationsInput | string | null
    file_name?: NullableStringFieldUpdateOperationsInput | string | null
    file_size?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
    mime_type?: NullableStringFieldUpdateOperationsInput | string | null
    file_type?: StringFieldUpdateOperationsInput | string
    width?: NullableIntFieldUpdateOperationsInput | number | null
    height?: NullableIntFieldUpdateOperationsInput | number | null
    duration?: NullableIntFieldUpdateOperationsInput | number | null
    display_order?: IntFieldUpdateOperationsInput | number
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}