# 0004: Content-based upload validation and generated storage names

## Status
Accepted

## Context
Artists upload images, archives, PDFs, audio and video. Filenames and client-declared MIME types are attacker-controlled, and a stored file named by the client risks path traversal and overwrites.

## Decision
- The file type is decided from magic bytes. Each category lists the formats it accepts (for example Live2D accepts zip and png, Sound accepts wav and mp3).
- Image formats are fully decoded with `sharp` and a pixel limit, so a valid header over garbage is rejected, and a deterministic WebP thumbnail is produced.
- Files are stored as `<32 random hex>.<ext>` where the extension comes from the detected format. The storage class rejects any other name and refuses to overwrite.
- The client filename is sanitized and stored only as display metadata.
- Uploads are sent as a raw `application/octet-stream` body with metadata in the query string, which avoids a multipart parser dependency.
- SVG, HTML and GIF are not accepted: SVG and HTML can carry scripts, and GIF is not needed for the target categories.

## Consequences
- Non-image formats (zip, pdf, audio, video) are validated by signature only, so they are served as attachments and treated as untrusted.
- Request bodies are buffered in memory up to `MAX_UPLOAD_MB`, which suits a single-node SQLite deployment. Streaming uploads would be needed for much larger files.
- Adding a format means adding a signature, a `FORMAT_INFO` entry and the categories that accept it.
