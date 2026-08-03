# SilverSea — Customer Google Drive (read-only reference)

The customer shares source documents (contracts, master data, O2C specs,
questionnaires) in a public "anyone with the link" Google Drive folder. This
file records where it is and how to read it **without auth**, so agents stop
reaching for `gws`/OAuth/Drive-API skills that this public folder does not
need.

## Location

- **Root folder:** SilverSea — https://drive.google.com/drive/folders/1MqvWEvz3gAw8kmKQk481c9dE8S_mzJwE
- **Folder ID:** `1MqvWEvz3gAw8kmKQk481c9dE8S_mzJwE`
- **Subfolder — File Khách hàng (master data):**
  `1z7DXgFBzI5_GQyzfUEq04hz4Fd9dukz_`
  (sample contents: `FILE HỢP ĐỒNG MẪU UP PM`, `29.7 - DATA PM.xlsx`)

## How to read (no auth needed)

The folder is public, so the Drive REST API (`drive/v3/files?q=...`) returns
`403` unauthenticated, but Google's **public export endpoints** work fine.
Prefer these over browser/scrape skills (`firecrawl`, `agent-browser`,
`browser-use`) — Drive's JS shell hides file IDs and breaks naive scraping.

### 1. List a folder's files with their IDs

```sh
curl -sL "https://drive.google.com/embeddedfolderview?id=FOLDER_ID#list" \
  | grep -oE 'entry-[A-Za-z0-9_-]+|flip-entry-title">[^<]+'
```

Pair each `entry-<ID>` with the following `flip-entry-title">` text. The `<ID>`
segment is the Drive file ID — use it directly in the export URLs below.

A heavier alternative (gets more noise — also returns gaia IDs, API keys,
reCAPTCHA site keys) is to fetch the folder HTML and filter:

```sh
curl -sL "https://drive.google.com/drive/folders/FOLDER_ID" \
  | grep -oE '"[A-Za-z0-9_-]{28,}"' | sort -u
```

### 2. Read a Google Doc (plain text)

```sh
curl -sL "https://docs.google.com/document/d/DOC_ID/export?format=txt"
```

### 3. Read a Google Sheet

```sh
# CSV (first sheet / default tab)
curl -sL "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv"

# XLSX (all tabs) — then open with the xlsx skill or pandas/openpyxl
curl -sL "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=xlsx"

# A specific tab by gid (CSV)
curl -sL "https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=GID"
```

### 4. Read a PDF / arbitrary file

```sh
curl -sL "https://drive.google.com/uc?id=FILE_ID&export=download" -o file.ext
```

## Known document inventory (as of 2026-08-03)

| Name | Type | File ID |
|---|---|---|
| File Khách hàng | folder | `1z7DXgFBzI5_GQyzfUEq04hz4Fd9dukz_` |
| Bảng câu hỏi cho KH | doc | `1W9znytQy4nLAiL7xYjZWs8xtsx9ge8U4QocHctWDjDs` |
| Hướng dẫn sử dụng phần mềm | doc | `1hfnNn3ZsBdmyFTs0aiUXuQWR4DZAjrqZw7M1K5zk7Bk` |
| Product Spec | doc | `1ztA8a2yagIfJjAam3rBmTXlDVreCuxk57qxto4qoA2s` |
| TÀI LIỆU GIẢI PHÁP TỔNG THỂ & ĐẶC TẢ NGHIỆP VỤ | doc | `1yHOwcpQPKbP_fda7FMSuUYsglYGNcYiEH8H2Z5mA9VQ` |

Re-run the listing step above to refresh; IDs are stable, names can drift.

## When you DO need auth

Only if a file/folder is **not** public (returns a login wall or HTTP 401/403
on the `export`/`uc` endpoints), or you need to **write**. Then install the
official Google Workspace CLI:

```sh
npm install -g @googleworkspace/cli
mkdir -p ~/.config/gws && mv ~/Downloads/client_secret_*.json ~/.config/gws/client_secret.json
gws auth login -s drive
gws drive files list --q "'FOLDER_ID' in parents and trashed = false"
```

For pure read of this folder, that is unnecessary — use the public endpoints.
