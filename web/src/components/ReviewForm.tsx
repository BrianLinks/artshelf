import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAction } from "../hooks";
import { ErrorNotice } from "./Notice";

export type ReviewTarget = { orderId: number } | { requestId: number };

/** A rating and optional comment for a completed purchase or commission. */
export function ReviewForm({ target, onDone }: { target: ReviewTarget; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const { run, error, busy } = useAction(onDone);
  const handle = (event: FormEvent): void => {
    event.preventDefault();
    void run(() => api.post("/reviews", { ...target, rating, comment }));
  };
  return (
    <form onSubmit={handle}>
      <ErrorNotice error={error} />
      <label>
        Rating
        <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} star{value === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Comment (optional)
        <textarea value={comment} maxLength={2000} rows={3} onChange={(event) => setComment(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Submit review
      </button>
    </form>
  );
}
