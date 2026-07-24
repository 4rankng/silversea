// Agent tool — knowledge.search (P2 doc-RAG).
//
// Exposes the knowledge retrieval pipeline to the orchestrator's ReAct loop.
// The model calls this when it needs product-doc / domain-glossary context
// (e.g. "tiền chuẩn là gì?", "quy tắc tính tiền phụ trội"). Returns retrieved
// chunks with source metadata so the orchestrator can attach citations.
import { z } from 'zod';
import { OFFICE_ROLES, defineReadTool } from '../tool.types';
import { retrieveKnowledge } from '../knowledge-retrieval';

export const knowledgeTools = [
  defineReadTool({
    name: 'knowledge.search',
    description:
      'Tìm kiếm tài liệu sản phẩm, glossary nghiệp vụ (CONTEXT.md, ADRs) theo ngữ nghĩa. Dùng khi người dùng hỏi ĐỊNH NGHĨA hoặc QUY TẮC (VD: "tiền chuẩn là gì", "quy tắc tính tiền phụ trội", "sổ cái có chỉnh sửa không"). Trả về các đoạn tài liệu liên quan + nguồn trích dẫn.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      query: z.string().min(1).describe('Câu hỏi hoặc từ khoá cần tra cứu tài liệu'),
    }),
    run: async (args) => {
      const chunks = await retrieveKnowledge(args.query);
      return {
        chunks: chunks.map((c) => ({
          source: c.sourcePath,
          heading: c.heading,
          content: c.content,
          similarity: Number(c.similarity.toFixed(3)),
        })),
        count: chunks.length,
      };
    },
    label: (a) => `Tra cứu tài liệu: "${a.query.slice(0, 40)}"`,
  }),
] as const;
