/* SYNTHETIC BROWSER TEST ONLY. Copied into a temporary harness by the verifier. */
import type { BloomIntegration } from '../../src/components/bloom/integration';
import type { JobPhoto } from '../../src/contracts';

type TestWindow = Window & { __bloomTest: { photos: JobPhoto[]; failUpload: boolean } };
export const syntheticIntegration: BloomIntegration = {
  listCities: async () => [{ id: 'synthetic-city', name: 'Test city', active: true }],
  getMyCityRequest: async () => null,
  getInstructions: async () => ({ instructions: 'Synthetic authorized entry instructions.' }),
  uploaderLabel: () => 'Test cleaner',
  prepareUpload: async (jobId, category) => {
    const state = (window as unknown as TestWindow).__bloomTest;
    const photoId = crypto.randomUUID();
    state.photos.push({ id: photoId, jobId, category, uploaderId: 'synthetic-user', state: 'pending', createdAt: new Date().toISOString() });
    return { photoId, upload: async (_file, progress, signal) => { progress(50); await new Promise(resolve => setTimeout(resolve, 100)); if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); if (state.failUpload) { state.failUpload = false; throw new Error('Synthetic upload failure'); } progress(100); } };
  },
};
