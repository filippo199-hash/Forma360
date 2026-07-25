# UX audit — Documents

**Module:** Documents (library, folders, upload, visibility by site/group, PDF/image preview). Routers `documents`, `documentFolders`.
**Investigated:** 2026-07-25 · full code map.
**Surfaces:** `app/[locale]/documents/{page,new,[documentId]}`, `src/components/documents/folder-tree.tsx`, shared `src/components/selectors/group-user-selector.tsx`.

## Fixed (Workflow fan-out, 5 slices + adversarial verify)
- **Detail:** infinite-skeleton on error fixed (reads `error` → DetailNotFound); the archive/restore button no longer mislabels **Restore as "Save"** on archived docs (uses `common.restore`); archive now confirms; dates use the app locale; truncated filenames get tooltips; the signature-recipient raw-ULID fallback removed.
- **Library:** load-error state (was a false "No documents"); mobile card layout; the previously-**unreachable folder Delete** is now wired (with confirm + the existing dependents-guard toasts); folder-visibility labels respect tenant terminology; doc-name tooltip; app-locale date; rename maxLength aligned to 500.
- **Upload:** the swallowed server error detail now surfaces to the user; a hint when more than one file is dropped (one-doc-per-file model).
- **Shared GroupUserSelector** (used platform-wide): all hardcoded English strings ("Select / Search / Nothing found / Clear selections / Done / N selected / Remove", tab labels) routed through i18n.
- **Folder tree:** folder-name tooltip + localised expand/collapse aria-labels.

**Good (left as-is):** the prior PDF-preview fix holds (PDFs render via a content-type-pinned iframe, not a broken `<img>`); the upload form's description is already a `<Textarea>`; the detail Access tab already uses the terminology-aware SiteSelector.

## Deferred (flagged)
- Upload **progress bar** + true multi-file upload (the new-doc form is one-doc-per-file by design).
- Move/upload **folder pickers are flat native `<select>`s** — nested hierarchy not shown (minor).
- Folder-visibility dialogs still use raw checkbox lists rather than the polished SiteSelector/GroupUserSelector (terminology label fixed; the full control swap deferred).
- Non-optimistic folder rename / access-save (round-trip lag).
