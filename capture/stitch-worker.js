// Runs the stitcher off the main thread so the page stays responsive on phones.
import { stitchPanorama } from './stitch.js';

self.onmessage = async ({ data }) => {
  try {
    const res = await stitchPanorama(data.shots, {
      ...data.opts,
      onProgress: (stage, p) => self.postMessage({ type: 'progress', stage, p }),
    });
    self.postMessage({ type: 'done', blob: res.blob, width: res.width, height: res.height, fovDeg: res.fovDeg });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
