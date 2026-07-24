# Architecture Diagrams

> **Audience:** Developers who think in pictures. Renderable Mermaid v11 diagrams of current repo logic and architecture, each tied to its source file so the diagram is verifiable.
> Companion to [system-architecture.md](system-architecture.md) (which uses ASCII). Where the two disagree, the **code wins**; this file is regenerated against the live codebase.

## 1. System Topology & Deployment

```mermaid
flowchart TB
  OFFICE["Office staff<br/>ADMIN · MANAGER · ACCOUNTANT"]
  FIELD["Field staff<br/>DRIVER · FORWARDER"]

  subgraph Host["Host (nepo.tingting.vip / vantai.tingting.vip)"]
    direction TB
    NGINX["Nginx :80 / :443<br/>reverse proxy<br/>+ /socket.io/ upgrade"]
    subgraph Docker["Docker compose"]
      direction TB
      FE["Frontend<br/>React 18 SPA (static build)<br/>Vite dev :7173"]
      BE["Backend :3090<br/>Express v5 + TypeScript<br/>Drizzle ORM · Socket.io"]
      PG[("PostgreSQL :5440")]
      REDIS[("Redis :6390<br/>GPS cache + sessions")]
      FS[(Uploads dir<br/>/uploads)]
    end
  end

  subgraph External["External services"]
    MM["MiniMax-M3<br/>chatbot LLM"]
    OR["OpenRouter Qwen3-VL<br/>OCR (primary)"]
    GEM["Gemini<br/>OCR (fallback)"]
    BK["Bách Khoa<br/>GPS portal API"]
    WP["Web Push<br/>VAPID"]
  end

  OFFICE --> NGINX
  FIELD --> NGINX
  NGINX --> FE
  NGINX --> BE
  FE <-->|socket.io / API| BE
  BE --> PG
  BE --> REDIS
  BE --> FS
  BE --> MM
  BE --> OR
  BE --> GEM
  BE --> BK
  BE --> WP
```

Two deploy targets share one pipeline: **nepo** (production) and **vantai** (demo). GitHub Actions is the intended CI/CD; when billing-blocked, deploy falls back to `make push` + SSH. Source: `deploy/`, `Makefile`, `docker-compose.dev.yml`.

## 2. Monorepo Package Dependencies

```mermaid
flowchart LR
  SHARED["@tingting/shared<br/>types · Zod schemas<br/>calculations · constants<br/>navigation · tours"]
  BE["@tingting/backend<br/>Express v5 · Drizzle · Casbin"]
  FE["@tingting/frontend<br/>React 18 · Vite · TanStack"]

  SHARED ==>|"compiled dist/"| BE
  SHARED ==>|"source src"| FE
```

**Build order matters:** `shared` must compile first — the backend imports `@tingting/shared` from `shared/dist/`, the frontend from source. Editing `shared/` requires a rebuild before backend picks it up. Source: `pnpm-workspace.yaml`, `shared/package.json`.

## 3. Backend Request Lifecycle (Middleware Chain)

```mermaid
flowchart TD
  REQ["Client HTTP request"]
  TP["app.set('trust proxy')<br/>honor X-Forwarded-For"]
  CORS["CORS<br/>origin whitelist (env)"]
  JSON["express.json()<br/>body parser"]
  STATIC["express.static('/uploads')"]
  LOG["Request logger<br/>method path status ms"]
  AUDIT["auditLogMiddleware<br/>auto-logs mutations"]
  AUTH["authMiddleware<br/>JWT → req.user + role<br/>(skipped: /login, /health)"]
  CAS["casbinAuthz(resource)<br/>per route mount"]
  ROUTE["Route handler<br/>→ service layer"]
  ERR["globalErrorHandler<br/>Zod → 400 · ApiError · PG 23505 → 409 · 500"]
  RES["Response"]

  REQ --> TP --> CORS --> JSON --> STATIC --> LOG --> AUDIT --> AUTH --> CAS --> ROUTE --> ERR --> RES
```

Routes mount in two tiers (see `backend/src/index.ts`): specific paths first (`/api/trips`, `/api/agent`, `/api/ocr`, …), then catch-all `/api` for catalog/config/financial. A `404` catch-all sits before the error handler so unmatched API routes return 404, not 500.

## 4. RBAC — Dual-Layer Authorization

```mermaid
flowchart TD
  R["Request + JWT role"]
  AUTH["authMiddleware<br/>verify JWT → user.role"]
  R --> AUTH
  AUTH --> MAP{"Map HTTP method → action<br/>GET=read · POST/PUT/PATCH=write · DELETE=delete"}
  MAP --> ENF{"Casbin enforcer<br/>(role, resource, action)"}
  ENF -->|"ADMIN wildcard * / *"| ALLOW["next()"]
  ENF -->|"policy row matches"| ALLOW
  ENF -->|"no match"| F1["403 Không có quyền"]
  ALLOW --> TIGHT{"Tight endpoint?<br/>requireRoles(...)"}
  TIGHT -->|"role listed (or none)"| HANDLER["Route handler"]
  TIGHT -->|"role NOT listed"| F2["403"]
```

Two complementary gates: **Casbin** (`backend/src/casbin/policy.csv` + `middleware/casbin.ts`) does coarse resource-level `(role, resource, action)` checks; **`requireRoles()`** does fine-grained role gating for sensitive endpoints (e.g. profit distribution). `ADMIN` passes everything via wildcard.

## 5. Trip Lifecycle State Machine

```mermaid
stateDiagram-v2
  [*] --> CREATED : create trip
  CREATED --> IN_TRANSIT : dispatch (ADMIN/MANAGER)
  IN_TRANSIT --> COMPLETED : complete — posts ledger (postTripLock)
  COMPLETED --> IN_TRANSIT : re-dispatch
  COMPLETED --> LOCKED : lock — photo + revenue gates
  LOCKED --> COMPLETED : unlock (no ledger reversal)
  CREATED --> CANCELED : cancel
  IN_TRANSIT --> CANCELED : cancel — reverses ledger
  COMPLETED --> CANCELED : cancel — reverses ledger
  note right of LOCKED
    CANCELED is NOT reachable
    from LOCKED (409 on attempt)
  end note
  LOCKED --> [*]
  CANCELED --> [*]
```

Status enum: `CREATED · IN_TRANSIT · COMPLETED · LOCKED · CANCELED` (`backend/src/db/schema.ts`). Transitions in `services/trip-status-machine.service.ts`:

- **Dispatch** (`→IN_TRANSIT`): only ADMIN/MANAGER; acquires `pg_advisory_xact_lock(truckId)` to block two concurrent dispatches on the same truck.
- **Complete** (`IN_TRANSIT→COMPLETED`): calls `LedgerService.postTripLock` — this is where ledger rows are actually written.
- **Lock** (`→LOCKED`): gates on zero-revenue confirmation and a photo evidence baseline (≥1 photo; if cargo type `requires_photos`, also ≥1 CONTAINER + ≥1 SEAL; `confirmNoPhoto` overrides).
- **Unlock** (`LOCKED→COMPLETED`): ADMIN/MANAGER, optimistic `version` bump — **does not** reverse ledger (rows were posted at completion, not at lock).
- **Cancel** (`→CANCELED`): not allowed from `LOCKED`; zeroes financials, and if cancelled from `COMPLETED` calls `postTripUnlock` to reverse.

## 6. Append-Only Ledger — Double-Entry Posting

```mermaid
flowchart TD
  subgraph Lock["postTripLock — on IN_TRANSIT → COMPLETED"]
    direction TB
    ADV1["pg_advisory_xact_lock<br/>(entityType, entityId)<br/>sorted globally → no deadlock"]
    ADV1 --> R1["CUSTOMER · TRIP_REVENUE<br/>debit = revenue"]
    ADV1 --> R2["DRIVER · DRIVER_SALARY<br/>credit = salary  (OWN only)"]
    ADV1 --> R3["VENDOR · FUEL_EXPENSE<br/>credit = fuelCost"]
    ADV1 --> R4["CUSTOMER · EXTERNAL_CARRIER_COST<br/>credit = freight  (EXTERNAL, carrier D-F)"]
    ADV1 --> R5["CUSTOMER · SERVICE_FEE<br/>debit = sellAmount  (ancillary, APPROVED)"]
  end

  subgraph Unlock["postTripUnlock — on COMPLETED → CANCELED"]
    direction TB
    ADV2["same entity lock set<br/>(kept symmetric with lock)"]
    ADV2 --> REV["Append UNLOCK_REVERSAL rows<br/>swap debit ↔ credit<br/>running balance recomputed"]
  end

  Lock -->|append-only, never UPDATE/DELETE| LEDGER[("ledger table<br/>id · balance running")]
  Unlock -->|append-only| LEDGER
```

**Sign convention** (`services/ledger.service.ts`):

| Entity | Debit | Credit |
|---|---|---|
| CUSTOMER | + outstanding (AR) | − outstanding |
| DRIVER / VENDOR / FORWARDER | − payable | + payable (AP) |

`postEntry` locks the entity, reads the latest row's `balance`, computes the new running balance, and appends an immutable row. Reversals are new rows with `txnType = UNLOCK_REVERSAL` — the ledger is append-only.

## 7. TxnType — What Each Ledger Row Means

```mermaid
flowchart LR
  subgraph Trip["Trip-driven"]
    TR[TRIP_REVENUE]
    DS[DRIVER_SALARY]
    FE2[FUEL_EXPENSE]
    ECC[EXTERNAL_CARRIER_COST]
    SF[SERVICE_FEE]
    UN[UNLOCK_REVERSAL]
  end
  subgraph Settle["Settlement / payments"]
    PR[PAYMENT_RECEIVED]
    VP[VENDOR_PAYMENT]
    DP[DRIVER_PAYOUT]
    FA[FORWARDER_ADVANCE]
    FS2[FORWARDER_SETTLEMENT]
  end
  subgraph Adj["Manual / period"]
    PEN[PENALTY]
    MF[MANAGEMENT_FEE]
    CM[COMMISSION]
    ADJ[ADJUSTMENT]
    VE[VENDOR_EXPENSE]
  end
```

16 enum values (`shared/src/constants/index.ts`). Trip-driven types are posted by the state machine; settlement types by payment/advance flows; `ADJUSTMENT` is the manual reconciliation entry (never mutate existing rows — post a correcting `ADJUSTMENT`).

## 8. Agent / Chatbot — Real-Time Tool Loop

```mermaid
sequenceDiagram
  autonumber
  participant U as User (chat drawer)
  participant FE as frontend agentSocket
  participant AS as agentSocket.ts (server)
  participant OR as Orchestrator
  participant MM as MiniMax-M3
  participant TG as Tool registry
  participant DB as DB / services

  U->>FE: user message
  FE->>AS: socket emit
  AS->>OR: runAgent()
  loop tool-calling loop (until final answer or budget)
    OR->>MM: prompt + tool defs
    MM-->>OR: text + tool_calls
    Note over OR: stripThink() removes model think-tags, then parses first JSON object
    OR->>TG: dispatch tool
    TG->>DB: semantic.data / GPS / tours / navigate
    DB-->>TG: rows / status
    TG-->>OR: tool result
  end
  OR-->>AS: final answer (+ AgentDirective)
  AS-->>FE: socket emit
  FE-->>U: render answer + execute directive (navigate / highlight / start_tour)
```

Transport is Socket.io (not SSE). The orchestrator is data-first by prompt design. Tool families: **semantic data** (6 tools over 12 entities), **GPS** (Bách Khoa live tracking), **tours** (curated walkthroughs), **navigate + highlight** (SPA nav + element spotlight). Perf is recorded to `agent_turn_metrics` for the ADMIN monitoring page. Sources: `backend/src/agentSocket.ts`, `services/agent/orchestrator.ts`, `services/agent/semantic-data.service.ts`.

## 9. Semantic Data Gateway (Agent Read Tools)

```mermaid
flowchart TB
  BOT["Agent orchestrator"]
  GW["semantic-data.service.ts<br/>list · detail · search · aggregate · timeline · report"]
  BOT --> GW
  GW --> E1["trips · tires · trucks · trailers"]
  GW --> E2["drivers · customers · suppliers"]
  GW --> E3["expenses · ledger · penalties"]
  GW --> E4["debitNoteTemplates · companyInfo"]
```

A single declarative gateway (`ENTITIES` map) backs 6 generated tools across 12 entities, so the LLM addresses business objects by name rather than touching 45 narrow endpoints. `report.run` delegates to analyzer functions (`getPnlReport`, `getReceivablesSummary`, …) — it never recomputes financial logic itself. Per-entity `aggregateMetrics` is whitelisted; non-additive fields (e.g. `creditLimit`, `baseSalary`) are list/detail-only by design.

## 10. Data Flow — Trip Figures → Ledger → P&L

```mermaid
flowchart LR
  FIG["Trip figures<br/>km · fuel · allowances · revenue"]
  CALC["shared computeTripTotals<br/>round2dp (VND, 2dp)"]
  POST["postTripLock<br/>(on complete)"]
  ENT["Entity running balances<br/>CUSTOMER · DRIVER<br/>VENDOR · FORWARDER"]
  AGING["Aging FIFO<br/>current · 30 · 60 · 90+"]
  PNL["P&L report<br/>revenue − cost"]
  NET["Net profit<br/>− mgmt fee − company expenses<br/>+ other income"]

  FIG --> CALC --> POST --> ENT
  ENT --> AGING
  ENT --> PNL --> NET
```

The ledger is the **single source of truth** for every balance. P&L and aging are *derived reads* over ledger rows, not separate stores. Financial precision lives in `shared/src/calculations/` (`round2dp`, `computeTripTotals`); VAT asymmetry (revenue ex-VAT, costs incl-VAT) is handled there.

## 11. Frontend Structure

```mermaid
flowchart TB
  APP["App.tsx<br/>Router + AuthProvider"]
  APP --> PAGES["pages/<br/>Dashboard · Trips · Finance<br/>Fleet · Dispatch · Config …"]
  APP --> LAYOUT["components/Layout<br/>sidebar · statusStrip · bell"]
  PAGES --> HOOKS["hooks/<br/>useAuth · useCRUD · useTripForm<br/>useTripFormState · useTripFormDispatch"]
  PAGES --> FEAT["features/<br/>dispatch · trip-form · billing …"]
  HOOKS --> API["api/<br/>tripClient.ts + REST clients"]
  API -->|fetch + JWT| BACKEND["Backend :3090"]
  LAYOUT --> AGENTFE["agent drawer + TourController<br/>socket.io client"]
  subgraph DS["Design system"]
    UI["UI primitives<br/>Card · Panel · Badge · KPI"]
    MONEY["Money · formatCurrency<br/>formatNumber (VND)"]
  end
  PAGES --> DS
```

Most-connected frontend abstractions (the "god nodes" to know): `api` client, `PageHeader`, `formatCurrency`, `useCRUD`, `Panel`. Money is always rendered via `<Money>` / `moneyParts` so the ₫ unit stays subtitle-sized and sign-handling is consistent.

## How These Were Built

1. **`/ck:graphify`** — extracted the codebase knowledge graph (`graphify-out/`, AST + communities). The pre-existing report was stale (pre-rename `packages/backend/src/`), so the live **codegraph** index (554 files · 7,267 nodes · 16,594 edges · 216 routes) was used as the authoritative source.
2. **`/ck:mermaidjs-v11`** — Mermaid v11 syntax for all diagrams above.
3. **`/ck:docs`** — this file, cross-referenced from [system-architecture.md](system-architecture.md).

To re-render after code changes: rerun the recipe; diagrams are intentionally small and source-cited so drift is easy to spot.
