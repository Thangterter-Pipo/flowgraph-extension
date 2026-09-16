import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('run feedback layout isolation', () => {
  it('renders run feedback through a body portal instead of as a Studio grid child', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/studio/main.tsx'), 'utf8');
    expect(source).toContain("import { createPortal } from 'react-dom';");
    expect(source).toContain("runFeedback && typeof document !== 'undefined' ? createPortal(");
    expect(source).toContain('<div className="run-feedback-toast" role="status">{runFeedback}</div>');
    expect(source).toContain('document.body,');
    expect(source).not.toContain('{runFeedback && <div className="run-feedback-toast"');
  });
});
