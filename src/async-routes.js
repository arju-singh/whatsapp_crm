// ---------------------------------------------------------------------------
// Make Express 4 forward async route errors to the error middleware.
//
// Express 4 does not await route handlers, so a handler that `throw`s (or rejects)
// after an `await` produces an unhandledRejection and the HTTP request HANGS until
// the client times out. This patches the single choke point every path handler
// funnels through — Route.prototype[verb] — to wrap handlers so a returned promise
// rejection (or sync throw) is routed to `next(err)` and hits the centralized
// error handler (which returns 500). Also wraps Router.prototype.use middleware.
//
// Require this ONCE, before any routes are defined. No behavior change for sync
// handlers (they don't return a thenable). Fails safe: if Express internals move,
// it logs and no-ops rather than breaking startup.
// ---------------------------------------------------------------------------

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

function wrap(handler) {
  if (typeof handler !== 'function') return handler;
  // Leave error-handling middleware (err, req, res, next) untouched.
  if (handler.length === 4) return handler;
  const wrapped = function (req, res, next) {
    try {
      const out = handler.call(this, req, res, next);
      if (out && typeof out.then === 'function') out.catch(next);
      return out;
    } catch (err) {
      next(err);
    }
  };
  // Preserve arity where relevant (some middleware inspect fn.length).
  Object.defineProperty(wrapped, 'length', { value: handler.length, configurable: true });
  return wrapped;
}

function patchMethods(proto, methods) {
  for (const m of methods) {
    const orig = proto[m];
    if (typeof orig !== 'function') continue;
    proto[m] = function (...args) {
      return orig.apply(this, args.map((a) => (typeof a === 'function' ? wrap(a) : a)));
    };
  }
}

function install() {
  try {
    const Route = require('express/lib/router/route');
    const Router = require('express/lib/router');
    patchMethods(Route.prototype, VERBS);       // router.get(path, handler) and app.get(...)
    patchMethods(Router, ['use', 'all']);       // router.use(mw) / app.use(mw)
  } catch (e) {
    console.warn('[async-routes] could not patch Express (async errors will not auto-forward):', e.message);
  }
}

install();
module.exports = { install };
