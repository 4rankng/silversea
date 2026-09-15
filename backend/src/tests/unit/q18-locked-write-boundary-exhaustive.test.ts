import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import ts from 'typescript';
import { GOVERNANCE_ACTION_KINDS } from '@tingting/shared';
import {
  LOCKED_ENTITY_BOUNDARIES,
  type ExecutableProofBinding,
  type SourceDeclarationBinding,
} from '../../governance/locked-entity-manifest';

const sourceRoot = path.resolve(process.cwd(), 'src');

const REQUIRED_TERMINAL_ENTITIES = [
  'ADVANCE_REQUEST',
  'ADVANCE_SETTLEMENT',
  'BILLING_DOCUMENT',
  'COMPANY_EXPENSE',
  'CREDIT_OVERRIDE',
  'DEBT_OFFSET',
  'FUEL_INVOICE',
  'PAYMENT_RECEIPT',
  'PENALTY',
  'PERIOD_LOCK',
  'PRICE_CONFIG',
  'PROFIT_DISTRIBUTION',
  'SALARY_CONFIRMATION',
  'SALARY_PERIOD',
  'TRIP',
  'TRIP_EXPENSE',
] as const;

function parseSource(relativeFile: string): ts.SourceFile {
  const absoluteFile = path.join(sourceRoot, relativeFile);
  assert.equal(fs.existsSync(absoluteFile), true, `missing source: ${relativeFile}`);
  return ts.createSourceFile(
    absoluteFile,
    fs.readFileSync(absoluteFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function declarationName(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node))
    && node.name
  ) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return null;
}

function findNamedDeclaration(sourceFile: ts.SourceFile, symbol: string): ts.Node {
  let match: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (match) return;
    if (declarationName(node) === symbol) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(match, `${sourceFile.fileName}: missing declaration ${symbol}`);
  return match;
}

function assertDeclarationBinding(binding: SourceDeclarationBinding, label: string): string {
  assert.ok(binding.requiredFragments.length > 0, `${label}: vacuous source binding`);
  const sourceFile = parseSource(binding.file);
  const declaration = findNamedDeclaration(sourceFile, binding.symbol);
  const declarationText = declaration.getText(sourceFile);
  for (const fragment of binding.requiredFragments) {
    assert.ok(
      declarationText.includes(fragment),
      `${label}: ${binding.file}#${binding.symbol} missing ${JSON.stringify(fragment)}`,
    );
  }
  return declarationText;
}

function findNamedTest(sourceFile: ts.SourceFile, testName: string): ts.CallExpression {
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'test' || node.expression.text === 'it')
      && node.arguments[0]
      && ts.isStringLiteralLike(node.arguments[0])
      && node.arguments[0].text === testName
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(matches.length, 1, `${sourceFile.fileName}: expected one test named "${testName}"`);
  return matches[0]!;
}

function assertExecutableProof(binding: ExecutableProofBinding, label: string): void {
  assert.ok(binding.requiredFragments.length >= 2, `${label}: proof needs specific assertions`);
  const sourceFile = parseSource(binding.file);
  const testCall = findNamedTest(sourceFile, binding.testName);
  const body = testCall.getText(sourceFile);
  assert.match(body, /\b(assert|expect|expectApiError)\b/, `${label}: proof has no assertion`);
  for (const fragment of binding.requiredFragments) {
    assert.ok(
      body.includes(fragment),
      `${label}: ${binding.file} test "${binding.testName}" missing ${JSON.stringify(fragment)}`,
    );
  }
}

describe('Q18 executable locked-entity boundary inventory', () => {
  test('covers every reviewed terminal financial or operational entity exactly once', () => {
    const entities = LOCKED_ENTITY_BOUNDARIES.map((entry) => entry.entity);
    assert.equal(new Set(entities).size, entities.length, 'duplicate inventory entity');
    assert.deepEqual([...entities].sort(), [...REQUIRED_TERMINAL_ENTITIES].sort());
  });

  test('binds terminal states and direct-write rejection to concrete production declarations', () => {
    for (const boundary of LOCKED_ENTITY_BOUNDARIES) {
      assert.ok(boundary.terminalStates.length > 0, `${boundary.entity}: terminal states`);
      const stateAuthority = assertDeclarationBinding(
        boundary.stateAuthority,
        `${boundary.entity}: state authority`,
      );
      for (const state of boundary.terminalStates) {
        assert.ok(
          stateAuthority.includes(state),
          `${boundary.entity}: state authority does not contain ${state}`,
        );
      }

      const guard = assertDeclarationBinding(
        boundary.directMutationBoundary,
        `${boundary.entity}: direct mutation boundary`,
      );
      if (boundary.createOnly) {
        assert.match(guard, /runInTx/, `${boundary.entity}: creation must be atomic`);
        assert.equal(boundary.governedActions.length, 0, 'Create-only records must not expose review actions');
      } else {
        assert.match(guard, /\b(throw|governance|Governance|assert|originalVersion|beforeSnapshot)\b/,
          `${boundary.entity}: mutation boundary has no rejection guard`);
      }
      assertExecutableProof(
        boundary.directMutationProof,
        `${boundary.entity}: direct mutation proof`,
      );
      if (boundary.draftRecovery) {
        const recovery = assertDeclarationBinding(boundary.draftRecovery.boundary, `${boundary.entity}: unposted draft recovery`);
        assert.match(recovery, /status !== 'DRAFT'/, 'Recovery must reject every non-draft state');
        assert.match(recovery, /expectedVersion/, 'Recovery must compare the current source version');
        assertExecutableProof(boundary.draftRecovery.proof, `${boundary.entity}: draft recovery proof`);
      }
    }
  });

  test('binds each governed action to entity-specific immutable evidence and executable proof', () => {
    const knownActions = new Set<string>(GOVERNANCE_ACTION_KINDS);
    for (const boundary of LOCKED_ENTITY_BOUNDARIES) {
      assert.ok(boundary.createOnly || boundary.governedActions.length > 0, `${boundary.entity}: correction actions or explicit create-only contract`);
      for (const governedAction of boundary.governedActions) {
        assert.ok(
          knownActions.has(governedAction.actionKind),
          `${boundary.entity}: unknown action ${governedAction.actionKind}`,
        );
        const requestBoundary = assertDeclarationBinding(
          governedAction.requestBoundary,
          `${boundary.entity}/${governedAction.actionKind}: request boundary`,
        );
        for (const evidenceField of ['reason', 'beforeSnapshot', 'afterSnapshot', 'makerId']) {
          assert.ok(
            requestBoundary.includes(evidenceField),
            `${boundary.entity}/${governedAction.actionKind}: missing ${evidenceField}`,
          );
        }
        if (!requestBoundary.includes(governedAction.actionKind)) {
          if (governedAction.actionKindAuthority) {
            const authority = assertDeclarationBinding(
              governedAction.actionKindAuthority,
              `${boundary.entity}/${governedAction.actionKind}: action kind authority`,
            );
            assert.ok(
              authority.includes(governedAction.actionKind),
              `${boundary.entity}: action kind authority is not ${governedAction.actionKind}`,
            );
          } else {
            const actionKindSymbol = governedAction.requestBoundary.requiredFragments
              .find((fragment) => fragment.endsWith('ACTION_KIND'));
            assert.ok(
              actionKindSymbol,
              `${boundary.entity}: request boundary not bound to ${governedAction.actionKind}`,
            );
            const actionSource = parseSource(governedAction.requestBoundary.file);
            const actionDeclaration = findNamedDeclaration(actionSource, actionKindSymbol);
            assert.ok(
              actionDeclaration.getText(actionSource).includes(governedAction.actionKind),
              `${boundary.entity}: ${actionKindSymbol} is not ${governedAction.actionKind}`,
            );
          }
        }
        assertExecutableProof(
          governedAction.proof,
          `${boundary.entity}/${governedAction.actionKind}: action proof`,
        );
      }
    }
  });

  test('binds direct financial application to durable evidence and atomic retry proof', () => {
    // Adapter compatibility fields remain transient. The completed operation's
    // durable authority is its in-transaction audit entry, never a review queue.
    const directApply = assertDeclarationBinding(
      {
        file: 'services/governance-action-core.service.ts',
        symbol: 'applyGovernanceActionDirect',
        requiredFragments: [
          'checkerId',
          'checkerRole',
          'checkedAt',
          "status: 'PENDING_APPROVAL'",
          'approverId',
          'approverRole',
          'approvedAt',
          'appliedAt',
          'ledgerEntryId',
          'applicationResult',
          'enqueueDurableEffects',
          'auditLogs',
          'FINANCIAL_ACTION_APPLIED',
          'beforeSnapshot',
          'afterSnapshot',
          'deltaSnapshot',
        ],
      },
      'shared governance checker',
    );
    assert.match(directApply, /throw new ApiError/);
    assert.match(directApply, /FINANCIAL_ACTION_APPLIED/);
    assertExecutableProof({
      file: 'tests/direct-financial-audit.test.ts',
      testName: 'direct financial action atomically persists original evidence and retries once after audit serialization failure',
      requiredFragments: ['assert.rejects(command()', 'audits.length, 1', 'evidence.beforeSnapshot', 'evidence.ledgerEntryId'],
    }, 'direct financial atomic evidence');
  });

  test('never exposes a reopen action for entities whose terminal state is irreversible', () => {
    for (const boundary of LOCKED_ENTITY_BOUNDARIES) {
      if (boundary.reopenPolicy !== 'NEVER') continue;
      assert.equal(
        boundary.governedActions.some(({ actionKind }) => actionKind.includes('REOPEN')),
        false,
        `${boundary.entity}: forbidden reopen action`,
      );
    }
  });
});
