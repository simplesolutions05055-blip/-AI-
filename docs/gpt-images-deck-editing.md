# GPT Images Deck Editing Flow

## Goal

`מצגת עם GPT Images` supports a full background flow:

1. The user chooses slide indexes and recipient emails on the `/admin/files/:requestId/revise` screen.
2. The browser starts the `deck-email` Supabase Edge Function.
3. The Edge Function generates or reuses one persisted AI image per selected slide.
4. Every generated slide image is saved in `outputs` storage and recorded in `deck_ai_images`.
5. The Edge Function builds the PPTX and emails it to recipients.
6. The email includes a direct edit link back to the exact revise screen:
   `/admin/files/:requestId/revise?gptDeck=1&gptDeckJob=:jobId`
7. The revise screen loads the saved slide images and opens the slide-by-slide editor.

## Data Model

Each AI slide image is stored as:

- Storage bucket: `outputs`
- Path pattern: `deck-ai/:requestId/:timestamp-:slideIndex.png`
- Metadata table: `deck_ai_images`
  - `request_id`
  - `slide_index`
  - `prompt`
  - `caption`
  - `storage_path`
  - `mime_type`

The deck job status is stored as:

- Storage bucket: `outputs`
- Path pattern: `deck-email-jobs/:jobId.json`
- Includes `status`, `message`, `sentTo`, `generated`, `reused`, and `selectedSlideIndexes`.

## Editing UX

The `GptImagesDeck` component now exposes:

- A persistent `צפייה ועריכת מצגת AI שקף־שקף` button when saved deck images exist.
- A slide-by-slide preview list.
- A prompt box per slide.
- `יצירת שקף מחדש`, which regenerates only that slide as a full AI image.
- `הורדת PPTX מעודכן`.
- `שליחת מצגת מעודכנת למייל`, which starts a new `deck-email` job using the latest saved images.

## Email Link

`deck-email` builds an edit URL from `APP_URL`:

```text
{APP_URL}/admin/files/{requestId}/revise?gptDeck=1&gptDeckJob={jobId}
```

The shared email template linkifies URLs, so the edit link is clickable in the email body.

## Important Behavior

- Full-slide/NotebookLM mode must never render design settings as slide content.
- Colors and brand style are prompt context only, not visible slide text.
- PDF is currently best-effort. Full-slide decks are primarily delivered as PPTX because base64-heavy HTML can exceed the render endpoint payload limit.
