/**
 * Built-in shadowing curriculum.
 *
 * Sentence design rationale: each category ramps from short, rhythm-friendly
 * sentences to longer multi-clause ones, because shadowing skill is mostly
 * about sustaining native prosody across clause boundaries. Sentences favor
 * high-frequency vocabulary with deliberately tricky phonetics (th-clusters,
 * linking sounds, weak forms) so the scorer has something real to catch.
 */
import type { LessonCategory } from "../types";

export const LESSON_CATEGORIES: LessonCategory[] = [
  {
    id: "everyday",
    title: "Everyday Essentials",
    description: "High-frequency daily phrases with natural linking and rhythm.",
    sentences: [
      { id: "ev-1", text: "Could you tell me where the nearest coffee shop is?", difficulty: "beginner" },
      { id: "ev-2", text: "I usually wake up around seven and go for a quick run.", difficulty: "beginner" },
      { id: "ev-3", text: "Would you mind turning the music down a little bit?", difficulty: "beginner" },
      { id: "ev-4", text: "I was thinking about grabbing dinner together this weekend.", difficulty: "intermediate" },
      { id: "ev-5", text: "Honestly, I completely forgot we had plans until you texted me.", difficulty: "intermediate" },
      { id: "ev-6", text: "By the time I got home, the whole neighborhood had already lost power.", difficulty: "advanced" },
    ],
  },
  {
    id: "work",
    title: "Business & Work",
    description: "Professional phrasing for meetings, emails, and negotiation.",
    sentences: [
      { id: "wk-1", text: "Let's schedule a follow-up meeting for early next week.", difficulty: "beginner" },
      { id: "wk-2", text: "I'd like to walk you through the main points of the proposal.", difficulty: "intermediate" },
      { id: "wk-3", text: "Could we circle back to the budget question before we wrap up?", difficulty: "intermediate" },
      { id: "wk-4", text: "We should prioritize the features that deliver the most value first.", difficulty: "intermediate" },
      { id: "wk-5", text: "I appreciate your flexibility, but the current deadline simply isn't realistic.", difficulty: "advanced" },
      { id: "wk-6", text: "Unless there are any objections, I'll consider this decision finalized and move forward.", difficulty: "advanced" },
    ],
  },
  {
    id: "travel",
    title: "Travel & Situations",
    description: "Confident phrases for airports, hotels, and getting around.",
    sentences: [
      { id: "tr-1", text: "Is this the right platform for the train to the city center?", difficulty: "beginner" },
      { id: "tr-2", text: "I have a reservation under the name Taylor for two nights.", difficulty: "beginner" },
      { id: "tr-3", text: "Excuse me, I think there's been a mistake with my order.", difficulty: "intermediate" },
      { id: "tr-4", text: "Could you recommend somewhere local that most tourists don't know about?", difficulty: "intermediate" },
      { id: "tr-5", text: "My connecting flight was cancelled, so I need to rebook for tomorrow morning.", difficulty: "advanced" },
      { id: "tr-6", text: "If the weather clears up, we're planning to hike the coastal trail before sunset.", difficulty: "advanced" },
    ],
  },
  {
    id: "fluency",
    title: "Advanced Fluency",
    description: "Long, idiomatic sentences that demand sustained native rhythm.",
    sentences: [
      { id: "fl-1", text: "It's not that I disagree with you; I just think we're missing the bigger picture.", difficulty: "advanced" },
      { id: "fl-2", text: "Looking back, I probably should have handled the situation a little differently.", difficulty: "advanced" },
      { id: "fl-3", text: "The thing is, opportunities like this don't come around very often, so we should seize it.", difficulty: "advanced" },
      { id: "fl-4", text: "Had I known the traffic would be this bad, I would have left an hour earlier.", difficulty: "advanced" },
      { id: "fl-5", text: "There's something incredibly satisfying about finally finishing a project you've been putting off.", difficulty: "advanced" },
      { id: "fl-6", text: "Whether or not we succeed depends largely on how well we communicate under pressure.", difficulty: "advanced" },
    ],
  },
];
