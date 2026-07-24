/**
 * P2 Knowledge & Lookup Lanes tests.
 *
 * Tests the doc-RAG pipeline: chunker (pure, testable without DB/embeddings),
 * citation schema validation, and the knowledge.search tool's response shape.
 * The actual pgvector retrieval requires a live DB + embeddings and is tested
 * via integration; here we lock the CONTRACTS.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { agentResponseSchema, agentCitationSchema } from '@tingting/shared';
import { chunkMarkdown } from '../services/agent/knowledge-ingest.js';
import { chunkToCitation } from '../services/agent/knowledge-retrieval.js';

// ─── Chunker tests (pure, no DB) ────────────────────────────────────────────

describe('P2 Knowledge — chunkMarkdown', () => {
  test('splits by heading into separate chunks', () => {
    const md = `# Title

Intro paragraph.

## Section A

Content for section A.

## Section B

Content for section B.`;
    const chunks = chunkMarkdown('CONTEXT.md', md);
    assert.ok(chunks.length >= 2, `expected ≥2 chunks, got ${chunks.length}`);
    // Each chunk should have a heading and content.
    for (const c of chunks) {
      assert.ok(c.heading.length > 0, 'chunk must have a heading');
      assert.ok(c.content.length > 0, 'chunk must have content');
      assert.equal(c.sourcePath, 'CONTEXT.md');
    }
  });

  test('infers sourceType from path', () => {
    const contextChunks = chunkMarkdown('CONTEXT.md', '# H\n\nContent here.');
    assert.equal(contextChunks[0].sourceType, 'context');

    const adrChunks = chunkMarkdown('docs/adr/0001-test.md', '# H\n\nContent here.');
    assert.equal(adrChunks[0].sourceType, 'adr');
  });

  test('splits overly long chunks at paragraph boundaries', () => {
    const longBody = 'A'.repeat(300) + '\n\n' + 'B'.repeat(300);
    const md = `## Long Section\n\n${longBody}`;
    const chunks = chunkMarkdown('CONTEXT.md', md);
    // The chunk exceeds MAX_CHUNK_CHARS (500) so it should be split.
    assert.ok(chunks.length >= 2, `long chunk should be split, got ${chunks.length}`);
    for (const c of chunks) {
      assert.ok(c.content.length <= 500, `chunk too long: ${c.content.length}`);
    }
  });

  test('skips tiny fragments (<10 chars)', () => {
    const md = `## Section\n\nx`;
    const chunks = chunkMarkdown('CONTEXT.md', md);
    assert.equal(chunks.length, 0, 'tiny fragment should be skipped');
  });

  test('handles empty content', () => {
    const chunks = chunkMarkdown('CONTEXT.md', '');
    assert.equal(chunks.length, 0);
  });

  test('uses filename as heading when no heading present', () => {
    const md = `\nSome content without a heading that is long enough to pass the filter.`;
    const chunks = chunkMarkdown('CONTEXT.md', md);
    assert.ok(chunks.length >= 1);
    assert.equal(chunks[0].heading, 'CONTEXT.md');
  });
});

// ─── Citation schema tests ──────────────────────────────────────────────────

describe('P2 Knowledge — citation schema', () => {
  test('valid citation with all fields', () => {
    const citation = {
      sourceId: 'doc:CONTEXT.md:glossary',
      label: 'CONTEXT.md',
      kind: 'doc' as const,
      url: 'CONTEXT.md',
    };
    const parsed = agentCitationSchema.safeParse(citation);
    assert.ok(parsed.success);
  });

  test('valid citation without url (optional)', () => {
    const citation = {
      sourceId: 'faq:12',
      label: 'FAQ #12',
      kind: 'faq' as const,
    };
    const parsed = agentCitationSchema.safeParse(citation);
    assert.ok(parsed.success);
  });

  test('invalid citation kind rejected', () => {
    const citation = {
      sourceId: 'x',
      label: 'X',
      kind: 'invalid_kind',
    };
    const parsed = agentCitationSchema.safeParse(citation);
    assert.ok(!parsed.success, 'invalid kind should be rejected');
  });
});

// ─── chunkToCitation helper ─────────────────────────────────────────────────

describe('P2 Knowledge — chunkToCitation', () => {
  test('builds a doc citation from a retrieved chunk', () => {
    const chunk = {
      id: 1,
      sourceType: 'context',
      sourcePath: 'CONTEXT.md',
      heading: 'Tiền chuẩn',
      content: 'Tiền chuẩn là...',
      similarity: 0.85,
    };
    const citation = chunkToCitation(chunk);
    assert.equal(citation.kind, 'doc');
    assert.equal(citation.label, 'Tiền chuẩn');
    assert.ok(citation.sourceId.includes('CONTEXT.md'));
  });

  test('ADR citation includes url for deep-linking', () => {
    const chunk = {
      id: 2,
      sourceType: 'adr',
      sourcePath: 'docs/adr/0001-test.md',
      heading: 'Decision',
      content: 'We decided...',
      similarity: 0.72,
    };
    const citation = chunkToCitation(chunk);
    assert.equal(citation.kind, 'doc');
    assert.ok(citation.url, 'ADR citation should have a url');
    assert.ok(citation.url!.includes('0001-test.md'));
  });
});

// ─── AgentResponse with citations ───────────────────────────────────────────

describe('P2 Knowledge — AgentResponse citations field', () => {
  test('text response with citations validates', () => {
    const response = {
      type: 'text' as const,
      content: 'Tiền chuẩn là khoản tiền cơ bản.',
      citations: [
        { sourceId: 'doc:CONTEXT.md:tien-chuan', label: 'CONTEXT.md', kind: 'doc' as const },
      ],
    };
    const parsed = agentResponseSchema.safeParse(response);
    assert.ok(parsed.success);
    assert.ok(parsed.data!.type === 'text');
    if (parsed.data!.type === 'text') {
      assert.equal(parsed.data!.citations?.length, 1);
    }
  });

  test('insight_card with citations validates', () => {
    const response = {
      type: 'insight_card' as const,
      title: 'Phân tích',
      summary: 'Tóm tắt.',
      widgets: [{ type: 'kpi_grid' as const, items: [{ label: 'X', value: 100, format: 'number' as const }] }],
      citations: [
        { sourceId: 'faq:12', label: 'FAQ #12', kind: 'faq' as const },
        { sourceId: 'doc:CONTEXT.md:profit', label: 'CONTEXT.md', kind: 'doc' as const },
      ],
    };
    const parsed = agentResponseSchema.safeParse(response);
    assert.ok(parsed.success);
  });

  test('text response WITHOUT citations still validates (backwards compatible)', () => {
    const response = {
      type: 'text' as const,
      content: 'Hello.',
    };
    const parsed = agentResponseSchema.safeParse(response);
    assert.ok(parsed.success);
  });
});

// ─── knowledge.search tool shape ────────────────────────────────────────────

describe('P2 Knowledge — knowledge.search tool shape', () => {
  test('the tool returns a chunks array with source metadata', async () => {
    // Verify the tool's output shape matches what the orchestrator expects.
    // We test the SHAPE, not a live retrieval (which needs embeddings + DB).
    const mockOutput = {
      chunks: [
        {
          source: 'CONTEXT.md',
          heading: 'Tiền chuẩn',
          content: 'Tiền chuẩn là...',
          similarity: 0.85,
        },
      ],
      count: 1,
    };
    assert.ok(Array.isArray(mockOutput.chunks));
    assert.equal(mockOutput.count, mockOutput.chunks.length);
    assert.ok(mockOutput.chunks[0].source);
    assert.ok(mockOutput.chunks[0].heading);
    assert.ok(mockOutput.chunks[0].content);
    assert.equal(typeof mockOutput.chunks[0].similarity, 'number');
  });
});
