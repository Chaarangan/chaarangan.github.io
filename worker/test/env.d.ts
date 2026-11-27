import { Env } from '../src/config';

// cloudflare:test types its env as an empty ProvidedEnv until a project declares
// what its bindings are. Without this the tests typecheck against {} and every
// env.DB access is an error.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
