# Project content and image persistence

## Save diagnosis

The editor previously serialized only on `input`; saving used React draft state rather than reading the live editable DOM. A native DOM edit without that event therefore saved the previous value (reproduced against the old component). Save now reads the editor directly, waits for the project API, and displays the canonical saved project. Failed saves retain the draft and show an error. Each save patches only its edited stage instead of sending a stale copy of every stage.

Case normalization also truncated arrays with `slice(0, 3)`. It now retains every case. Cases remain the ordered array at `ppssProjects/{projectId}.workspaceContent.data.cases`: stable `id`, `label`, `title`, rich-text `text`, and existing newline-separated `imageUrl`. No new Firestore schema or migration is needed. Existing limited Markdown formatting remains supported. The separate global Data Analysis editor was rendered from `dataDraft.text` above the tabs; it has been removed in favor of selected-case editing. Existing introductory text remains readable inside the cases view.

## Image paths and authorization

| Purpose | New Storage objects | Existing metadata |
| --- | --- | --- |
| Problem Definition images | `projects/{projectId}/background-images/{uuid}` | Problem stage `imageUrl` |
| Case images | `projects/{projectId}/case-images/{uuid}` | Case `imageUrl` |
| Settings / Stage 3 site image | `projects/{projectId}/site-images/{uuid}` | `ppssSiteImages_{projectId}/current` |
| Generated alternatives | `projects/{projectId}/generated-images/{imageId}.png` | `ppssGeneratedImages_{projectId}/{imageId}` |

Existing URLs/files are not migrated. Site-image finalization also accepts already prepared legacy `ppss-site-image/{projectId}/{uuid}` uploads.

Previously the gallery and generated-image persistence used the browser Firebase Storage SDK at `ppss-site-image/...` and `ppss-generated-images/...`. The reported `storage/unauthorized` is a client Storage authorization rejection; the gallery's generic catch hid its code. The deployed rule condition/current authentication state cannot be determined without access to that deployment. Diagnostics now record only sanitized error code, target path, and authenticated boolean, never bearer tokens, resumable session URLs, or credentials.

Generated images now stay on the server: authenticated generation API → Admin SDK bucket save → existing Firestore metadata → URL response. Background/case/site file bytes use an Admin-authorized resumable upload session after server verification of project/system manager permission. Finalization validates project, upload owner, actual size and MIME type. Settings previously used a hardcoded admin email allowlist inconsistent with the UI; it now uses the same server project-manager check. Normal participants cannot prepare/finalize these uploads.

## Deployment configuration

No client-write Firebase Storage Rule is required for these new paths. Do not make the bucket publicly writable or loosen existing Rules. Admin SDK access uses IAM, not client Storage Rules. The configured service account needs object create/read/update permission on these project paths and the existing Firestore access. Ensure the existing server Admin credentials and configured bucket refer to the intended project.

For browser resumable uploads, the bucket must allow the actual application origin. If it is not already configured, merge this entry into the bucket's existing CORS configuration (replace the example origin; preserve other entries):

```json
[
  {
    "origin": ["https://YOUR-APPLICATION-ORIGIN"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "Content-Range", "Range"],
    "maxAgeSeconds": 3600
  }
]
```

Apply the merged file using `gcloud storage buckets update gs://YOUR_BUCKET --cors-file=merged-cors.json` only against the intended deployment bucket. CORS is not write authorization; the server-issued upload session supplies scoped authorization. No wildcard origin or public-write permission is needed.

Live Storage Rules/IAM/CORS could not be inspected in this environment because server Firebase credentials were unavailable. Browser tests use the real project API and Firestore emulator with fixture Storage; generated-image server writes and authorization failures are checked with mocked bucket calls. These checks do not establish live bucket connectivity.
