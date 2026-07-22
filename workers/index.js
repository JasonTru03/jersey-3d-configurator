import { createDesignAssetsHandler } from './designAssets.js';

export default {
  fetch(request, env) {
    return createDesignAssetsHandler(env)(request);
  },
};
