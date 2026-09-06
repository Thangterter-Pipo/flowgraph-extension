import { describe, it, expect } from 'vitest';
import { initialNodes, initialEdges } from '../../src/ui/studio/model';
import {
  buildSavedWorkflow,
  persistWorkflow,
  restoreWorkflow,
} from '../../src/ui/studio/workflowPersistence';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

describe('QA-A3: PERSISTENCE MATRIX VERIFICATION (15 CANONICAL + BATCH BOUNDARY CASES)', () => {
  const models = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'];
  const ratios = ['16:9', '4:3', '1:1', '3:4', '9:16'];
  const batchBoundaries = ['1', '2', '3', '4'];
  const testProjectId = 'test-project-persistence-a3';
  const storage = new MemoryStorage();

  // 15 Canonical cases (3 models x 5 ratios x batch x1)
  models.forEach((m) => {
    ratios.forEach((r) => {
      it(`persists canonical config: ${m} | ratio=${r} | batch=x1 across save & restore`, () => {
        const testNodes = initialNodes.map((n) => {
          if (n.id === '2') {
            return {
              ...n,
              data: {
                ...n.data,
                config: {
                  ...n.data.config,
                  model: m,
                  aspectRatio: r,
                  batchCount: '1',
                  signedPreviewUrl: 'https://transient.signed.url/image.png', // Transient URL that must not leak
                },
              },
            };
          }
          return n;
        });

        persistWorkflow(
          testNodes,
          initialEdges,
          'main',
          'Persistence Test',
          { projectId: testProjectId, projectName: 'Persistence Test Project' },
          storage,
        );

        const restored = restoreWorkflow(testProjectId, 'main', storage);

        const restoredT2I = restored.nodes.find((n) => n.id === '2');
        expect(restoredT2I).toBeDefined();
        expect(restoredT2I?.data.config.model).toBe(m);
        expect(restoredT2I?.data.config.aspectRatio).toBe(r);
        expect(restoredT2I?.data.config.batchCount).toBe('1');

        // Security assertion: signed URLs must never be persisted
        expect(restoredT2I?.data.config.signedPreviewUrl).toBeUndefined();
      });
    });
  });

  // Batch boundary cases: x2, x3, x4 on representative model
  batchBoundaries.forEach((b) => {
    it(`persists batch boundary x${b} on representative Nano Banana 2`, () => {
      const testNodes = initialNodes.map((n) => {
        if (n.id === '2') {
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...n.data.config,
                model: '🍌 Nano Banana 2',
                aspectRatio: '16:9',
                batchCount: b,
              },
            },
          };
        }
        return n;
      });

      persistWorkflow(
        testNodes,
        initialEdges,
        'main',
        'Batch Boundary Test',
        { projectId: testProjectId, projectName: 'Persistence Test Project' },
        storage,
      );

      const restored = restoreWorkflow(testProjectId, 'main', storage);
      const restoredT2I = restored.nodes.find((n) => n.id === '2');
      expect(restoredT2I?.data.config.batchCount).toBe(b);
    });
  });
});
