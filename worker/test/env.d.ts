import type { Env as WorkerEnv } from '../src/config';

// cloudflare:test types its env as an empty Cloudflare.Env until a project declares
// what its bindings are. Without this the tests typecheck against {} and every
// env.DB access is an error.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
