---
name: "kanban-task-tracking"
description: "STANDING DIRECTIVE: all tasks tracked on the kanban backlog board — created on assignment, dependency-chained, statuses moved live; never chat-only tracking"
folder: "global / conventions"
tags: []
updatedAt: "2026-09-09T16:52:50.169Z"
author: "Project Manager"
---

# Kanban task tracking (STANDING USER DIRECTIVE, 2026-09-10)

**From now on, ALWAYS track tasks on the AgentsRoom kanban backlog board** — user directive, given after work was managed only in chat/notes and a task was missed.

## Rules
1. Every non-trivial task gets a `backlog_create` ticket the moment it is assigned — title, full acceptance criteria, tags, owner lane in the description.
2. Chain dependencies with `backlog_link` (`blocks`) so the board enforces execution order.
3. Move statuses LIVE: `in_progress` when work starts, `done` when verified — the board is the single source of truth, never chat messages or session notes alone.
4. Mult-step work is split into chained tickets (implement → gate → deploy) rather than one opaque card.
5. Sessions resuming mid-work MUST read `backlog_list` first and reconcile the board before acting.

Related: [[testing-and-deploy-environments]]
