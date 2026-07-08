/**
 * My Sentences — the user's personal training-material library. Paste a
 * script, a vocabulary list, or lines from a favorite show; each non-empty
 * line becomes an individually trackable practice sentence that feeds the
 * Shadowing Studio.
 */
import { useState } from "react";
import { useAppState } from "../state/AppStateContext";

interface MySentencesProps {
  onPractice: (sentenceId: string, text: string) => void;
}

export function MySentences({ onPractice }: MySentencesProps) {
  const { state, dispatch } = useAppState();
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const lines = draft.split(/\r?\n/);
    dispatch({ type: "ADD_SENTENCES", texts: lines });
    setDraft("");
  };

  return (
    <div className="fade-in">
      <h1 className="view-header">My Sentences</h1>
      <p className="view-subtitle">
        Build your own curriculum: every line you save becomes a shadowing exercise with its
        own progress tracking.
      </p>

      <div className="glass" style={{ marginBottom: 16 }}>
        <h2 className="card-title">Add training material</h2>
        <div className="field">
          <textarea
            className="input"
            rows={4}
            placeholder={"Paste one sentence per line, e.g.\nThe early bird catches the worm.\nI'd rather we rescheduled the meeting."}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="hint">
            Each non-empty line is saved as a separate sentence. Duplicates are skipped.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={!draft.trim()}
        >
          ＋ Save sentences
        </button>
      </div>

      <div className="glass">
        <h2 className="card-title">
          Library{" "}
          <span className="pill" style={{ marginLeft: 8 }}>
            {state.sentences.length} sentence{state.sentences.length === 1 ? "" : "s"}
          </span>
        </h2>

        {state.sentences.length === 0 ? (
          <div className="empty-state">
            Nothing here yet. Paste your first practice lines above — movie quotes, work
            phrases, anything you want to master.
          </div>
        ) : (
          state.sentences.map((sentence) => (
            <div key={sentence.id} className="sentence-item">
              <div className="sentence-body">
                <p className="sentence-text">“{sentence.text}”</p>
                <span className="sentence-meta">
                  Practiced {sentence.timesPracticed}×
                  {sentence.bestScore > 0 && <> · best score {sentence.bestScore}%</>}
                </span>
              </div>
              <div className="sentence-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onPractice(sentence.id, sentence.text)}
                >
                  🎙️ Practice
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => dispatch({ type: "DELETE_SENTENCE", id: sentence.id })}
                  title="Delete sentence"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
