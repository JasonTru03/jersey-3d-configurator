import { createWorkerHandler } from './router.js';

const handlersByEnv = new WeakMap();

function getWorkerHandler(env) {
  let handler = handlersByEnv.get(env);
  if (!handler) {
    handler = createWorkerHandler(env);
    handlersByEnv.set(env, handler);
  }
  return handler;
}

export default {
  fetch(request, env) {
    return getWorkerHandler(env)(request);
  },
};
